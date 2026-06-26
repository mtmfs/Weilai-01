// test/ledger-concurrency.mjs —— 验证 lib/ledger.mjs 串行化提交器根治"陈旧快照丢失更新"。
// 跑：node test/ledger-concurrency.mjs   （非 0 退出码 = 失败）
// 两段：
//   1) 对照组：朴素 load→await→mutate→save 两通道并发 → 应丢失更新（证明本测试能侦测竞态）。
//   2) ledger 组：read→await→commit 两通道并发 → 应无丢失（commit 提交时新鲜 load + 串行化）。
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { loadState, ensureVideo, bumpUpload } from '../lib/state.mjs';
import { createLedger } from '../lib/ledger.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PATH = join(tmpdir(), `weilai-ledger-test-${process.pid}.json`);
const NAME = 'vid-A';
const cleanup = () => { for (const s of ['', '.tmp', '.bak']) { try { rmSync(PATH + s, { force: true }); } catch (e) {} } };

cleanup();

// ── 1) 对照组：朴素并发写应丢失更新 ───────────────────────────────
async function naiveWriter(channel, delay) {
  const s = loadState(PATH);                              // 各自 load 陈旧快照（文件初始不存在 → 各得空 base）
  await sleep(delay);                                     // 模拟 CDP 慢活，期间对方插入
  bumpUpload(ensureVideo(s, NAME, NAME), channel, { ts: 1 });
  writeFileSync(PATH, JSON.stringify(s, null, 1), 'utf8');// 朴素直写（不重读）— 模拟现状 load→(await)→save
}
await Promise.all([naiveWriter('jie3', 60), naiveWriter('jie6', 10)]);
{
  const s = loadState(PATH);
  const j3 = s.videos[NAME].ch.jie3.uploads, j6 = s.videos[NAME].ch.jie6.uploads;
  assert.ok(!(j3 === 1 && j6 === 1), `对照组应丢失更新，却 jie3=${j3} jie6=${j6}（测试侦测不到竞态？）`);
  console.log(`[contrast] 朴素并发写丢失更新（符合预期）: jie3=${j3} jie6=${j6}`);
}
cleanup();

// ── 2) ledger 组：串行化提交应无丢失 ─────────────────────────────
const ledger = createLedger(PATH);
async function ledgerWriter(channel, delay) {
  await ledger.read(() => null);                          // 动作前读快照（决策），锁内瞬时
  await sleep(delay);                                     // 慢活在锁外并发
  await ledger.commit('bump:' + channel, (s) => bumpUpload(ensureVideo(s, NAME, NAME), channel, { ts: 1 }));
}
await Promise.all([ledgerWriter('jie3', 60), ledgerWriter('jie6', 10)]);
{
  const s = loadState(PATH);
  const j3 = s.videos[NAME].ch.jie3.uploads, j6 = s.videos[NAME].ch.jie6.uploads;
  assert.strictEqual(j3, 1, `ledger 后 jie3.uploads 应=1，实际 ${j3}`);
  assert.strictEqual(j6, 1, `ledger 后 jie6.uploads 应=1，实际 ${j6}`);
  console.log(`[ok] ledger 串行化无丢失更新: jie3=${j3} jie6=${j6}`);
}

// ── 3) ledger 组（加压）：多笔并发交错提交同一视频两通道 ──────────────
cleanup();
const led2 = createLedger(PATH);
const tasks = [];
for (let i = 0; i < 8; i++) {
  const ch = i % 2 === 0 ? 'jie3' : 'jie6';
  tasks.push((async () => {
    await led2.read(() => null);
    await sleep((i * 7) % 25);
    await led2.commit('bump:' + ch, (s) => bumpUpload(ensureVideo(s, NAME, NAME), ch, { ts: 1 }));
  })());
}
await Promise.all(tasks);
{
  const s = loadState(PATH);
  const j3 = s.videos[NAME].ch.jie3.uploads, j6 = s.videos[NAME].ch.jie6.uploads;
  assert.strictEqual(j3, 4, `加压后 jie3.uploads 应=4，实际 ${j3}`);
  assert.strictEqual(j6, 4, `加压后 jie6.uploads 应=4，实际 ${j6}`);
  console.log(`[ok] 8 笔交错提交无丢失: jie3=${j3} jie6=${j6}`);
}
cleanup();

console.log('ledger-concurrency: ALL PASS');
