// lib/sysrepair.mjs —— `doctor --fix` 的修补逻辑：探测可执行 + 补缺省 + 标"不可自动定"的数据路径。
// 仿 reconcile.computeReconcile 惯例：核心为纯函数（探测器注入，便于离线单测），命令壳在 bin/cmds/doctor.mjs。
// computeSystemRepairs 不写盘——返回 {patch, fixed[], unfixable[]}，交命令壳决定是否 saveJson（原子写 + .bak）。
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pickChrome } from './config.mjs';

// 从绝对路径取盘符（'I:\\md5fix' → 'I:'）。无盘符返回 null。
function driveOf(p) { const m = /^([A-Za-z]:)[\\/]/.exec(String(p || '')); return m ? m[1] : null; }

// ── 默认探测器（真实 fs；测试可整体注入替换，使 computeSystemRepairs 纯）──
const defaultExists = (p) => { try { return existsSync(p); } catch (e) { return false; } };
const defaultDetectChrome = () => pickChrome();
// ffmpeg：先试 system.json 现有候选，再试 PATH 里的 `ffmpeg`（换机最常见的可用兜底）。命中返回路径，否则 null。
const FFMPEG_FALLBACK = ['ffmpeg'];
const defaultDetectFfmpeg = (cands) => {
  for (const f of [...(cands || []), ...FFMPEG_FALLBACK]) {
    try { execFileSync(f, ['-version'], { stdio: 'ignore' }); return f; } catch (e) {}
  }
  return null;
};

// rawSys = 原始 system.json 对象（未经 loadSystem 派生）；probes = {exists, detectChrome, detectFfmpeg}（缺省走真实 fs）。
// 返回：patch（要并入 rawSys 的顶层键增量，每键已是合并后的完整子对象）、fixed（已修人看清单）、unfixable（需手动 config set 项）。
export function computeSystemRepairs(rawSys, probes = {}) {
  const exists = probes.exists || defaultExists;
  const detectChrome = probes.detectChrome || defaultDetectChrome;
  const detectFfmpeg = probes.detectFfmpeg || defaultDetectFfmpeg;
  const sys = rawSys || {};
  const patch = {}, fixed = [], unfixable = [];

  // ── chrome.path：不存在 → 探测标准安装位 ──
  const chromePath = sys.chrome && sys.chrome.path;
  if (!chromePath || !exists(chromePath)) {
    const alt = detectChrome();
    if (alt) { patch.chrome = { ...(sys.chrome || {}), path: alt }; fixed.push(`chrome.path → ${alt}`); }
    else unfixable.push({ key: 'chrome.path', why: 'Chrome 未在标准安装位找到', hint: 'weilai config set system chrome.path "C:\\\\...\\\\chrome.exe" --apply' });
  }

  // ── ffmpeg.candidates：现有候选全失效 → 探测 + 命中则前插（不删旧候选，保留可移植列表）──
  const ffCands = (sys.ffmpeg && sys.ffmpeg.candidates) || [];
  const ffOk = detectFfmpeg(ffCands);
  if (!ffOk) unfixable.push({ key: 'ffmpeg.candidates', why: '候选均不可用且 PATH 无 ffmpeg', hint: '装 ffmpeg 入 PATH，或 system.json 的 ffmpeg.candidates 手加绝对路径' });
  else if (!ffCands.includes(ffOk)) { patch.ffmpeg = { ...(sys.ffmpeg || {}), candidates: [ffOk, ...ffCands] }; fixed.push(`ffmpeg.candidates 前插 → ${ffOk}`); }

  // ── md5fix：缺段/缺 outDir → 按 profileBase（次选 flatRoot）同盘派生（这是 loadSystem 现行硬必填，补它消除 latent crash）──
  const md5out = sys.md5fix && sys.md5fix.outDir;
  if (!md5out) {
    const drv = driveOf(sys.chrome && sys.chrome.profileBase) || driveOf(sys.project && sys.project.flatRoot);
    if (drv) { const v = `${drv}\\md5fix`; patch.md5fix = { ...(sys.md5fix || {}), outDir: v }; fixed.push(`md5fix.outDir → ${v}（按同盘派生·可 config set 改）`); }
    else unfixable.push({ key: 'md5fix.outDir', why: '无可派生盘符（profileBase/flatRoot 也缺）', hint: 'weilai config set system md5fix.outDir "I:\\\\md5fix" --apply' });
  }

  // ── 数据路径（机器私有，绝不猜）：仅校验盘符存在；盘符没了（典型换盘符）→ 报精确 config set 命令 ──
  for (const [key, val] of [
    ['project.flatRoot', sys.project && sys.project.flatRoot],
    ['project.ledgerPath', sys.project && sys.project.ledgerPath],
    ['chrome.profileBase', sys.chrome && sys.chrome.profileBase],
  ]) {
    if (!val) { unfixable.push({ key, why: '缺路径', hint: `weilai config set system ${key} "X:\\\\..." --apply` }); continue; }
    const drv = driveOf(val);
    if (drv && !exists(drv + '\\')) unfixable.push({ key, why: `盘符 ${drv} 不存在（本机无此盘）`, hint: `weilai config set system ${key} "X:\\\\..." --apply` });
  }

  return { patch, fixed, unfixable };
}
