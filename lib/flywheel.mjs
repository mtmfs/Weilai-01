// lib/flywheel.mjs —— 异步双通道飞轮：单 Node 进程并发驱动 jie3@9222 + jie6@9223，后台改 MD5。
// 替代 cycle/rounds 的同步阻塞编排（cycle.mjs:51 那个 sleep(12min) 空转被彻底删除）。
//
// 设计（详见 docs 计划文件）：
//   · 每通道一条串行 async 循环（channelLoop），两条循环并发跑、各占各的 Chrome、互不阻塞。
//   · 唯一共享可变资源 = 台账，所有写经 createLedger 的串行化提交器（提交时刻新鲜 load，根治丢失更新）。
//   · 一次 tick：ready(幂等) → harvest(增量 sync) → 周期兜底(全量 sync/delete/reconcile) → release(改MD5+上传)。
//   · 仅当本 tick "啥也没干" 才短睡自适应 poll（floor→ceil 指数退避 + jitter）；有产出立即下一 tick。
//   · 审核延迟不是 sleep，是"被其它活盖住的流水线延迟"——harvest 反复确认在飞件、release 推新件、md5fix 备返工。
//   · jie3 过审 → recomputeStage 自动置 sealed → 进 jie6 的 deliv_toupload；jie6 循环自取，jie3 永不等 jie6。
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { loadConfig, loadSecrets } from './config.mjs';
import { createLedger } from './ledger.mjs';
import { connect } from './cdp.mjs';
import { ready } from './session.mjs';
import { runSync, runSyncIncremental } from './sync.mjs';
import { runDelete } from './delete.mjs';
import { runUpload } from './upload.mjs';
import { runReconcile } from './reconcile.mjs';
import { runMd5fix } from './md5fix.mjs';
import { worklists } from './state.mjs';

export const DAEMON_DEFAULTS = {
  pollFloorSec: 30,    // 空闲轮询下限（有产出即拉回此值）
  pollCeilSec: 180,    // 空闲轮询上限（指数退避封顶；审核~14min，180s 足够灵敏）
  jitterPct: 0.25,     // ±25% 抖动，去相关两通道、避免同刻撞 CDP+台账
  maxBackoffSec: 300,  // 失败退避封顶
  breakerFails: 6,     // 单通道连续失败几次 → 熔断暂停（其它通道继续）
  fullSyncMin: 12,     // 全量 sync 间隔（纠偏/收新本地件/渲 index.md）
  deleteMin: 30,       // jie3 平台清理间隔
  reconcileMin: 30,    // 幻影 un-bump 对账间隔
  md5fixPerChannelDir: true, // 每通道独立 md5 输出子目录（根除同名跨通道撞 .part/dst）
  releaseMax: 10,      // ★每 tick 最多释放（=一次导入）几个；10=平台单次导入上限、避免一会话内多批 NO_CHOOSER（--batch 可覆盖）
};

const rand = () => Math.random();
const sleep = (ms, signal) => new Promise((res) => {
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
});

// 时间戳门控：首次必触发（初始 undefined），之后每 minutes 分钟一次。
function makeDue() {
  const last = {};
  return (key, minutes) => {
    const now = Date.now();
    if (last[key] === undefined || now - last[key] >= minutes * 60000) { last[key] = now; return true; }
    return false;
  };
}

// delete/全量sync 会在抽屉留下搜索过滤等脏态 → 紧接的 openUploadPanel 找不到"添加视频"(ready 见抽屉已开会跳过、不清搜索)。
// 上传前先 Page.reload 清干净，再由 ready 重新 lockPlan+openView，抽屉回到可上传态。
async function reloadPage(cfg) {
  const cdp = await connect({ port: cfg.target.port, aavid: cfg.target.aavid });
  try { await cdp.send('Page.enable'); await cdp.send('Page.reload', { ignoreCache: false }); await sleep(6000); }
  finally { cdp.close(); }
}

// 本通道待传/重传名单：新件(toupload)优先在前，返工(reupload)在后。按 role 分派（投放通道取 deliv_*，否则 test_*）。
function channelWork(role, w) {
  return role === 'delivery'
    ? { toupload: [...w.deliv_toupload], reupload: [...w.deliv_reupload] }
    : { toupload: [...w.test_toupload], reupload: [...w.test_reupload] };
}

// 单通道一条串行循环。ledger=共享串行化提交器；signal=AbortSignal；daemon=运行参数。
async function channelLoop(id, ledger, { signal, log, daemon }) {
  const cfg = loadConfig(id);
  const base = cfg.system.md5fix.outDir;
  const md5dir = daemon.md5fixPerChannelDir ? join(base, id) : base;
  const flatRoot = cfg.system.project.flatRoot;
  const due = makeDue();
  let pollMs = daemon.pollFloorSec * 1000;
  let fails = 0;

  log.step(`[${id}] 飞轮循环启动（md5dir=${md5dir}）`);
  while (!signal.aborted) {
    let didWork = false;
    try {
      // ── 收敛：每 tick 幂等 ready（冷态自启 Chrome、热态 ~1s、漂移自愈） ──
      await ready(cfg, { secrets: loadSecrets(), log });

      // ── 1) HARVEST：增量查在飞件审核（签名缓存命中~1s）→ observe → recompute ──
      const h = await runSyncIncremental(cfg, { log, ledger });
      // ★不据"观察到审核值"判 didWork：在飞件每 tick 都会被重观察(audit=3)，据此判进展会永不退避、紧密空转刷平台。
      //   真进展只看 release 是否真上传（见下）；在飞件的最终 resolve 会在某个 tick 转成 reupload→被 release 接住。
      if (h.observed > 0) log.info(`[${id}] 收割：${h.observed} 件查得审核值（含在飞重确认）`);

      // ── 4) 周期兜底：全量 sync（纠偏/收新件/渲 index）；其下复用 platform 快照跑 delete/reconcile ──
      let navigated = false;
      if (due('fullsync', daemon.fullSyncMin)) {
        const s = await runSync(cfg, { log, ledger });
        navigated = true;
        if (due('delete', daemon.deleteMin)) {
          // delete 支持 drawer / creative-tab；失败只告警，飞轮继续靠后续 sync/reconcile 纠偏。
          await runDelete(cfg, { apply: true, platform: s.platform, log, ledger }).catch(e => log.warn(`[${id}] delete: ${e.code || e.message}`));
        }
        if (due('reconcile', daemon.reconcileMin)) {
          await runReconcile(cfg, { apply: true, platform: s.platform, log, ledger }).catch(e => log.warn(`[${id}] reconcile: ${e.code || e.message}`));
        }
      }

      // ── 3) RELEASE：有 md5-ready 的活就上传（新件优先；返工件强制新哈希 M3；releaseMax 截断模拟多批次） ──
      const w = await ledger.read((st) => worklists(st));
      const { toupload, reupload } = channelWork(cfg.target.role, w);
      // ★只取本地有源文件的：防 reconcile 复活的"无本地文件陈旧条目"堵满 release 槽、每 tick md5fix 失败空转。
      const hasLocal = n => existsSync(join(flatRoot, n));
      const toup = toupload.filter(hasLocal), reup = reupload.filter(hasLocal);
      const cap = daemon.releaseMax || Infinity; // 每 tick 最多释放几个（--batch N，模拟"5个5个"的多批次飞轮）
      const names = [...toup, ...reup].slice(0, cap); // 新件优先在前，按 cap 截断
      if (names.length) {
        const isNew = new Set(toup);
        const pickToup = names.filter(n => isNew.has(n));
        const pickReup = names.filter(n => !isNew.has(n));
        if (pickToup.length) await runMd5fix(cfg, pickToup, { outDir: md5dir, skipExisting: true, log });   // 新件：有副本则复用
        if (pickReup.length) await runMd5fix(cfg, pickReup, { outDir: md5dir, skipExisting: false, log });  // ★M3 返工件：强制新哈希
        if (navigated) { await reloadPage(cfg); await ready(cfg, { secrets: loadSecrets(), log }); } // delete/sync 导航过(留抽屉搜索脏态)→ reload 清干净 + 重新收敛到可上传
        const up = await runUpload(cfg, { names, md5dir, log, ledger });
        if (up.injected > 0) { didWork = true; log.ok(`[${id}] 释放：注入 ${up.injected}/平台确认 ${up.submitted}${up.dedup ? '(dedup)' : ''}（本tick上限 ${cap === Infinity ? '∞' : cap}）`); }
      }

      fails = 0;
    } catch (e) {
      fails++;
      log.warn(`[${id}] tick 异常 ${e.code || ''}: ${String(e.message || e).slice(0, 90)}（连续失败 ${fails}）`);
      if (fails >= daemon.breakerFails) { log.err(`[${id}] 连续失败 ${fails} 次 → 熔断暂停该通道（其它通道继续运转）`); break; }
      // 失败也走退避（用 maxBackoff 而非 pollCeil，给恢复更长喘息）
      const backoff = Math.min(pollMs * 2, daemon.maxBackoffSec * 1000);
      await sleep(Math.round(backoff * (1 + (rand() * 2 - 1) * daemon.jitterPct)), signal);
      pollMs = backoff;
      continue;
    }

    // ── 5) 自适应退避：有产出立即下一 tick；空闲才短睡（指数退避至 ceil + jitter） ──
    if (didWork) { pollMs = daemon.pollFloorSec * 1000; continue; }
    await sleep(Math.round(pollMs * (1 + (rand() * 2 - 1) * daemon.jitterPct)), signal);
    pollMs = Math.min(pollMs * 2, daemon.pollCeilSec * 1000);
  }
  log.info(`[${id}] 飞轮循环退出`);
}

// 飞轮主入口：建共享提交器 → 并发起各通道循环 → allSettled（单通道崩溃不拖垮其它）。
export async function runFlywheel({ channels, log, daemon = {}, signal }) {
  const cfg0 = loadConfig(channels[0]);
  const ledger = createLedger(cfg0.system.project.ledgerPath);
  const cfg = { ...DAEMON_DEFAULTS, ...(cfg0.system.daemon || {}), ...daemon };
  log.step(`飞轮启动：通道=[${channels.join(', ')}] poll=${cfg.pollFloorSec}-${cfg.pollCeilSec}s fullSync=${cfg.fullSyncMin}min`);
  const loops = channels.map((id) => channelLoop(id, ledger, { signal, log, daemon: cfg }));
  const results = await Promise.allSettled(loops);
  results.forEach((r, i) => { if (r.status === 'rejected') log.err(`[${channels[i]}] 致命退出: ${r.reason && r.reason.message || r.reason}`); });
  log.ok('飞轮已停止');
}
