// lib/log.mjs —— 双发：人看 → stderr，机器 JSON → stdout。
// 这样 `weilai status --json | jq` 干净（stdout 只有 JSON），人看进度仍可见（stderr）。
// 可选文件镜像（enableFileLog）：把 stderr 日志去色 + 加时间戳追加到文件，供飞轮 run 长跑/无人值守事后诊断。
import { appendFileSync } from 'node:fs';
import { createRotatingLineWriter, DEFAULT_LOG_ROTATION } from './artifacts.mjs';
const C = { dim: '\x1b[2m', red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m', cyan: '\x1b[36m', rst: '\x1b[0m' };
const tty = process.stderr.isTTY;
const paint = (c, s) => (tty ? c + s + C.rst : s);

let fileSink = null; // 文件日志路径（enableFileLog 设；null=仅控制台）
let fileWriter = null;
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };

const w = s => {
  process.stderr.write(s + '\n');
  if (fileWriter) { try { fileWriter.writeLine(`${stamp()} ${stripAnsi(s)}`); } catch (e) {} } // 文件写失败不影响控制台/不抛
};

// 开启文件日志镜像：后续所有 stderr 日志（去色 + 本地时间戳）追加到 path。建文件失败则退回仅控制台（warn 一次、不抛）。
// 控制台输出不变（保留颜色、不加时间戳）；stdout 的 out() 不进文件（机器 JSON 与运行日志分离）。
export function enableFileLog(path, opts = {}) {
  try {
    fileWriter = createRotatingLineWriter(path, { ...DEFAULT_LOG_ROTATION, ...opts });
    appendFileSync(path, '', 'utf8');
    fileSink = path;
    return path;
  }
  catch (e) { process.stderr.write(`⚠ 无法开启文件日志 ${path}：${e.message}（仅控制台）\n`); fileSink = null; fileWriter = null; return null; }
}
export function logFile() { return fileSink; }

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

// 普通文本输出边界：stdout 给人读/help/脚本裸值；stderr 给错误文本。
export function writeText(value = '') { process.stdout.write(String(value) + '\n'); }
export function writeErr(value = '') { w(String(value)); }
