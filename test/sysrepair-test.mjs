// 离线单测：computeSystemRepairs 纯逻辑（注入桩探测器，不碰真实 fs）。run: node test/sysrepair-test.mjs
import assert from 'node:assert';
import { computeSystemRepairs } from '../lib/sysrepair.mjs';

// 场景1：chrome.path 坏 + 缺 md5fix + ffmpeg 候选全失效但 PATH 有 ffmpeg + flatRoot/ledger 盘符没了（典型换机）。
{
  const raw = {
    project: { flatRoot: 'Z:\\vids', ledgerPath: 'Z:\\vids\\_video_state.json' },
    chrome: { path: 'C:\\nope\\chrome.exe', profileBase: 'I:\\chrome-debug-profile', flags: ['--window-size=1920,1080'] },
    ffmpeg: { candidates: ['D:\\old\\ffmpeg.exe'] },
  };
  const probes = {
    exists: (p) => p === 'I:\\',                 // 只有 I:\ 盘在；Z:\ 不在；chrome.path 不在
    detectChrome: () => 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    detectFfmpeg: () => 'ffmpeg',                // PATH 命中
  };
  const { patch, fixed, unfixable } = computeSystemRepairs(raw, probes);
  assert.strictEqual(patch.chrome.path, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'chrome.path 修补');
  assert.strictEqual(patch.chrome.profileBase, 'I:\\chrome-debug-profile', 'chrome 其余字段保留');
  assert.deepStrictEqual(patch.chrome.flags, ['--window-size=1920,1080'], 'chrome.flags 保留');
  assert.deepStrictEqual(patch.ffmpeg.candidates, ['ffmpeg', 'D:\\old\\ffmpeg.exe'], 'ffmpeg 命中前插、旧候选保留');
  assert.strictEqual(patch.md5fix.outDir, 'I:\\md5fix', 'md5fix.outDir 按 profileBase 同盘派生');
  const keys = unfixable.map((u) => u.key);
  assert.ok(keys.includes('project.flatRoot'), 'flatRoot 盘符没了 → unfixable');
  assert.ok(keys.includes('project.ledgerPath'), 'ledgerPath 盘符没了 → unfixable');
  assert.ok(!keys.includes('chrome.profileBase'), 'profileBase 在 I: 盘 → 不报');
  assert.strictEqual(fixed.length, 3, '3 项已自动修补');
  console.log('✓ 场景1：chrome/ffmpeg/md5fix 自动修补 + 失踪盘符报 unfixable');
}

// 场景2：全部健康 → 无 patch、无 fixed、无 unfixable（健康配置零改动）。
{
  const raw = {
    project: { flatRoot: 'H:\\DD', ledgerPath: 'H:\\DD\\_video_state.json' },
    chrome: { path: 'C:\\chrome.exe', profileBase: 'I:\\p' },
    ffmpeg: { candidates: ['D:\\ffmpeg.exe'] },
    md5fix: { outDir: 'I:\\md5fix' },
  };
  const probes = { exists: () => true, detectChrome: () => 'X', detectFfmpeg: (c) => c[0] };
  const { patch, fixed, unfixable } = computeSystemRepairs(raw, probes);
  assert.deepStrictEqual(patch, {}, '健康配置无 patch');
  assert.strictEqual(fixed.length, 0, '无修补项');
  assert.strictEqual(unfixable.length, 0, '无 unfixable');
  console.log('✓ 场景2：健康配置零改动');
}

// 场景3：chrome + ffmpeg 都探测不到 → 不杜撰，进 unfixable。
{
  const raw = { project: { flatRoot: 'I:\\v', ledgerPath: 'I:\\v\\s.json' }, chrome: { path: 'C:\\nope.exe', profileBase: 'I:\\p' }, ffmpeg: { candidates: [] }, md5fix: { outDir: 'I:\\m' } };
  const probes = { exists: (p) => p === 'I:\\', detectChrome: () => null, detectFfmpeg: () => null };
  const { patch, fixed, unfixable } = computeSystemRepairs(raw, probes);
  assert.deepStrictEqual(patch, {}, '探测不到 → 无 patch');
  assert.strictEqual(fixed.length, 0, '无可自动修补');
  const keys = unfixable.map((u) => u.key);
  assert.ok(keys.includes('chrome.path') && keys.includes('ffmpeg.candidates'), 'chrome+ffmpeg 均报 unfixable');
  console.log('✓ 场景3：探测不到不杜撰，进 unfixable');
}

console.log('\nsysrepair 全部通过 ✓');
