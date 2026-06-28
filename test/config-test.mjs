// 离线单测：loadSystem 对真实 system.json 仍通过（md5fix 已纳入必填→回归保护）+ pickChrome 兜底。run: node test/config-test.mjs
import assert from 'node:assert';
import { execPath } from 'node:process';
import { loadSystem, pickChrome } from '../lib/config.mjs';

// 1) 真实 system.json：应含 md5fix.outDir（新必填）+ 派生 viewport；本机若缺 md5fix 会在此早暴露。
const sys = loadSystem();
assert.ok(sys.md5fix && sys.md5fix.outDir, 'system.json 应有 md5fix.outDir（新必填）');
assert.ok(sys.chrome.viewport && sys.chrome.viewport.width > 0, 'chrome.viewport 已派生');
console.log('✓ loadSystem：md5fix 必填回归通过（md5fix.outDir =', sys.md5fix.outDir + '）');

// 2) pickChrome：候选含一个真实存在的可执行（用 node 自身）→ 取首个存在者；全不存在 → null。
assert.strictEqual(pickChrome(['Z:\\nope\\a.exe', execPath]), execPath, 'pickChrome 取首个存在者');
assert.strictEqual(pickChrome(['Z:\\nope\\a.exe', 'Q:\\nope\\b.exe']), null, '全不存在 → null');
console.log('✓ pickChrome：兜底命中/落空正确');

console.log('\nconfig 全部通过 ✓');
