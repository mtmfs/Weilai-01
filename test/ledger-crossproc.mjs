// test/ledger-crossproc.mjs —— 跨进程台账并发安全：spawn 多进程并发 commit，验证文件锁根治 lost-update。
// 跑：node test/ledger-crossproc.mjs （非 0 退出 = 失败）。self-spawn：argv 含 --worker 时扮 worker，否则 parent。
// 两组：① 对照(naive 裸写)应丢失更新/损坏（证明能侦测跨进程竞态）② ledger(文件锁)应无丢失、落盘未损、有 .bak。
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync, existsSync } from 'node:fs';
import { loadState, ensureVideo, bumpUpload } from '../lib/state.mjs';
import { createLedger } from '../lib/ledger.mjs';

const __filename = fileURLToPath(import.meta.url);
const NAME = 'vid-A';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── worker：对同一台账狂打 count 次 bump（mode: ledger=经锁提交 / naive=裸写模拟现状） ──
async function runWorker() {
  const [path, channel, countStr, mode] = process.argv.slice(3);
  const count = Number(countStr);
  if (mode === 'ledger') {
    const led = createLedger(path);
    for (let i = 0; i < count; i++) {
      await led.read(() => null);            // 动作前读快照（决策），锁内瞬时
      await sleep(Math.random() * 8);        // 慢活在锁外
      await led.commit('bump:' + channel, (s) => bumpUpload(ensureVideo(s, NAME, NAME), channel, { ts: 1 }));
    }
  } else {
    for (let i = 0; i < count; i++) {
      let s;
      try { s = loadState(path); }           // 陈旧快照
      catch (e) { continue; }                // ★naive 无锁无 .bak：并发裸写产生半截档→读崩→跳过（这正是"无保护"的丢失/损坏恶果，对照组要的就是 < N*K）
      await sleep(Math.random() * 8);
      bumpUpload(ensureVideo(s, NAME, NAME), channel, { ts: 1 });
      try { writeFileSync(path, JSON.stringify(s, null, 1)); } catch (e) { /* 写撞并发→跳过 */ } // 裸直写（无锁、无原子）— 模拟现状
    }
  }
}

function spawnAll(n, args) {
  return Promise.all(Array.from({ length: n }, () => new Promise((res, rej) => {
    const c = spawn(process.execPath, [__filename, '--worker', ...args.map(String)], { stdio: ['ignore', 'ignore', 'inherit'] });
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error('worker 退出码 ' + code))));
    c.on('error', rej);
  })));
}

async function runParent() {
  const PATH = join(tmpdir(), `weilai-crossproc-${process.pid}.json`);
  const clean = () => { for (const s of ['', '.tmp', '.bak', '.lock']) { try { rmSync(PATH + s, { force: true }); } catch (e) {} } };
  const N = 4, K = 30;

  // ── 组1 对照：无锁跨进程裸写应丢失更新（或损坏）——证明本测试能侦测跨进程竞态（用 spawn 真并发，非 spawnSync 串行） ──
  clean();
  await spawnAll(N, [PATH, 'jie3', K, 'naive']);
  let lost;
  try { lost = loadState(PATH).videos[NAME]?.ch.jie3.uploads ?? 0; }
  catch (e) { lost = -1; } // 裸并发写损坏文件也算竞态证据
  assert.ok(lost < N * K, `对照组应丢失更新/损坏(<${N * K})，却=${lost}（没并发/没侦测到竞态？）`);
  console.log(`[contrast] 跨进程无锁丢失更新（预期）: ${lost} < ${N * K}`);

  // ── 组2 加锁：ledger 文件锁跨进程应无丢失 ──
  clean();
  await spawnAll(N, [PATH, 'jie3', K, 'ledger']);
  const s = loadState(PATH);                          // loadState 不抛 = 落盘 JSON 未损坏
  assert.strictEqual(s.videos[NAME].ch.jie3.uploads, N * K, `加锁后应无丢失: 期望 ${N * K} 实际 ${s.videos[NAME].ch.jie3.uploads}`);
  assert.ok(existsSync(PATH + '.bak'), '并发写后应有 .bak（原子写路径生效）');
  console.log(`[ok] ledger 文件锁跨进程无丢失: ${s.videos[NAME].ch.jie3.uploads} == ${N * K}`);
  clean();
  console.log('ledger-crossproc: ALL PASS');
}

if (process.argv.includes('--worker')) runWorker().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
else runParent().catch((e) => { console.error(e); process.exit(1); });
