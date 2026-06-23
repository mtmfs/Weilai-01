// lib/log.mjs —— 双发：人看 → stderr，机器 JSON → stdout。
// 这样 `weilai status --json | jq` 干净（stdout 只有 JSON），人看进度仍可见（stderr）。
const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyan: '\x1b[36m', rst: '\x1b[0m' };
const tty = process.stderr.isTTY;
const paint = (c, s) => (tty ? c + s + C.rst : s);
const w = s => process.stderr.write(s + '\n');

export const log = {
  info: (...a) => w(a.join(' ')),
  step: (...a) => w(paint(C.cyan, '▶ ') + a.join(' ')),
  ok: (...a) => w(paint(C.grn, '✓ ') + a.join(' ')),
  warn: (...a) => w(paint(C.yel, '⚠ ') + a.join(' ')),
  err: (...a) => w(paint(C.red, '✗ ') + a.join(' ')),
  diag: (...a) => w(paint(C.dim, '  ↳ ' + a.join(' '))), // 诊断提示（如选择器漂移给的线索）
};

// 机器可读结果 → stdout。命令的"返回值"走这里。
export function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
