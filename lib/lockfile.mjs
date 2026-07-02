// lib/lockfile.mjs —— 纯 Node（零依赖）跨进程互斥原语：台账临界区文件锁 + 飞轮 pidfile 单例。
//
// 为何需要：ledger.mjs 的 actor 只在【单进程内】串行化台账提交；saveState 的 tmp→rename 只防"读到半截文件"，
//   不防两个进程各自 loadState→(慢活)→saveState 之间的丢失更新。两条防线：
//   ① 台账 commit 临界区套 withFileLock（跨进程互斥，根治 lost-update）；
//   ② 飞轮 run 套 pidfile 单例（同一台账最多一个写入型飞轮）。
//
// Windows 要点（无 flock/fcntl 咨询锁，只能自造）：
//   · openSync(lockPath,'wx') = CREATE_NEW 原子建锁，EEXIST 表示已被持有；
//   · 建锁后立即 closeSync、不跨临界区持 fd（Node 默认不带 FILE_SHARE_DELETE，持 fd 时 unlink 会 EPERM）——所有权用"文件存在"表示；
//   · 崩溃残留锁靠 stale 检测抢占（持锁进程已死 或 超 staleMs）——这是必需件，不是可选（OS 不会自动释放）。
import { openSync, writeFileSync, closeSync, readFileSync, unlinkSync, statSync } from 'node:fs';
import { hostname } from 'node:os';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// process.kill(pid,0) 探活：ESRCH=死、EPERM=活但无权（判活）。非法 pid 判死。
export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

// 读锁文件内容 {pid,ts,host,label}；不存在/坏档返回 null（坏档在 acquire 里被当 stale 抢占）。
export function readLockInfo(lockPath) {
  try { return JSON.parse(readFileSync(lockPath, 'utf8')); }
  catch (e) { return null; }
}

// 幂等释放：unlink，ENOENT 吞。（临界区极短，不校验持有者；被 stale-steal 属极罕见崩溃恢复路径。）
export function releaseFileLock(lockPath) {
  try { unlinkSync(lockPath); } catch (e) { /* ENOENT 或已被抢占者删除，忽略 */ }
}

// 异步自旋获取锁（不阻塞事件循环）。成功后锁文件已建、fd 已关。失败超时抛 E_LOCK。
// stale 双保险：!isPidAlive(持锁pid) 或 age>staleMs（持锁者崩在临界区）。verify-then-steal 缩小 TOCTOU。
export async function acquireFileLock(lockPath, { timeoutMs = 20000, staleMs = 10000, minDelayMs = 8, maxDelayMs = 50, label = '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let delay = minDelayMs;
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx'); // 原子建锁（O_EXCL / CREATE_NEW）
      try { writeFileSync(fd, JSON.stringify({ pid: process.pid, ts: Date.now(), host: hostname(), label })); }
      finally { closeSync(fd); } // ★立即关 fd，不跨临界区持有
      return;
    } catch (e) {
      if (e.code !== 'EEXIST') {
        // 杀软/索引器瞬时占用 → 短重试；其它错误直接抛
        if ((e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY') && Date.now() < deadline) { await sleep(delay); delay = Math.min(delay * 2, maxDelayMs); continue; }
        throw e;
      }
      // 已被持有：判 stale
      const info = readLockInfo(lockPath);
      let stale;
      if (!info) {
        // 空/坏锁档：区分"建锁中微秒窗口（openSync→writeFileSync 之间，文件已建未写）"与"崩溃残留"。
        // ★把建锁中的空文件当 stale 去 steal，会让两进程同时进临界区、互踩 .tmp（实测 rename ENOENT）——故 mtime 新则不抢、等待。
        try { stale = (Date.now() - statSync(lockPath).mtimeMs) > staleMs; } catch (e) { stale = false; /* 文件刚消失 → 回 openSync 抢 */ }
      } else {
        stale = (Number.isInteger(info.pid) && !isPidAlive(info.pid)) /* 持锁进程已死 */
          || (Date.now() - (info.ts || 0) > staleMs); /* 超 TTL（崩在临界区） */
      }
      if (stale) {
        const again = readLockInfo(lockPath); // verify-then-steal：内容未变才抢，避免删掉别人刚建的新锁
        if (JSON.stringify(again) === JSON.stringify(info)) { try { unlinkSync(lockPath); } catch (e2) { /* 已被别人抢先删 */ } }
        continue; // 回到 openSync('wx') 抢；O_EXCL 保证只一个赢，输家继续等
      }
      if (Date.now() >= deadline) throw Object.assign(new Error(`台账锁获取超时(${label})：持有者 pid=${info && info.pid} age=${Date.now() - ((info && info.ts) || 0)}ms`), { code: 'E_LOCK' });
      await sleep(delay); delay = Math.min(delay * 2, maxDelayMs);
    }
  }
}

// acquire → fn()（可同步，临界区靠 JS run-to-completion 原子）→ finally release。返回 fn 结果。
export async function withFileLock(lockPath, fn, opts = {}) {
  await acquireFileLock(lockPath, opts);
  try { return await fn(); }
  finally { releaseFileLock(lockPath); }
}

// ════════════════ 飞轮 pidfile 单例 ════════════════
// pidfile 内容 {pid,startedAt(ISO),channels,host,heartbeatAt(ms)}。存活判定 = pid 活 且 心跳新鲜（双闸，根治 Windows pid 复用）。
export const HEARTBEAT_STALE_MS = 120000; // 独立 30s 心跳的 4×：稳定区分"活着但空闲(tick 退避可达 180-300s)"与"真死"

// 读飞轮状态 {alive,pid,channels,startedAt,host}|null。alive=pid 活 且 heartbeat 未陈旧。
export function readFlywheelStatus(pidfile) {
  let info;
  try { info = JSON.parse(readFileSync(pidfile, 'utf8')); }
  catch (e) { return null; }
  if (!info || !Number.isInteger(info.pid)) return null;
  const hb = typeof info.heartbeatAt === 'number' ? info.heartbeatAt : 0;
  const alive = isPidAlive(info.pid) && (Date.now() - hb <= HEARTBEAT_STALE_MS);
  return { alive, pid: info.pid, channels: info.channels || [], startedAt: info.startedAt || null, host: info.host || null };
}

// 起飞轮前调：已有存活飞轮 → 抛 E_SINGLETON；无/stale（pid 死或心跳陈旧）→ 覆写抢占。
export function acquireFlywheelSingleton(pidfile, { channels = [] } = {}) {
  const st = readFlywheelStatus(pidfile);
  if (st && st.alive) {
    throw Object.assign(
      new Error(`已有飞轮在跑（pid=${st.pid}, 通道=${(st.channels || []).join('+') || '?'}, 启动=${st.startedAt || '?'}），拒绝启动第二个（同一台账最多一个写入型飞轮）`),
      { code: 'E_SINGLETON' }
    );
  }
  const now = Date.now();
  writeFileSync(pidfile, JSON.stringify({ pid: process.pid, startedAt: new Date(now).toISOString(), channels, host: hostname(), heartbeatAt: now }, null, 2));
  return { pid: process.pid, channels };
}

// 刷心跳（独立 30s 定时调用）。只刷属于本进程的 pidfile（防抢占后误刷别人的）。
export function touchHeartbeat(pidfile) {
  let info;
  try { info = JSON.parse(readFileSync(pidfile, 'utf8')); }
  catch (e) { return false; }
  if (!info || info.pid !== process.pid) return false;
  info.heartbeatAt = Date.now();
  try { writeFileSync(pidfile, JSON.stringify(info, null, 2)); return true; }
  catch (e) { return false; }
}

// 优雅停/退出时释放：仅当 pidfile 属本进程才删（绝不删掉 stale 抢占者写的新 pidfile）。
export function releaseFlywheelSingleton(pidfile) {
  let info;
  try { info = JSON.parse(readFileSync(pidfile, 'utf8')); }
  catch (e) { return; }
  if (info && info.pid === process.pid) { try { unlinkSync(pidfile); } catch (e2) { /* 忽略 */ } }
}
