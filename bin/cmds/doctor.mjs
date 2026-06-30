// doctor：环境自检——磁盘(C/H/I)/ffmpeg/chrome/端口/台账/通道不变量。纯只读，直击"硬环境前提·缺一即停"。
// --fix：探测·修补 system.json（自动定 chrome/ffmpeg、补 md5fix 缺省；机器私有数据路径报 config set 提示）。
import { existsSync, statfsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, loadSystem, channelRegistry, loadTarget, pickChrome } from '../../lib/config.mjs';
import { saveJson } from '../../lib/config-write.mjs';
import { computeSystemRepairs } from '../../lib/sysrepair.mjs';
import { loadState, ledgerExists } from '../../lib/state.mjs';
import { probeChromePort } from '../../lib/session.mjs';
import { log, out } from '../../lib/log.mjs';

function freeGB(p) { try { const s = statfsSync(p); return (s.bavail * s.bsize) / 1e9; } catch (e) { return null; } }
function pickFfmpeg(cands) { for (const f of cands || []) { try { execFileSync(f, ['-version'], { stdio: 'ignore' }); return f; } catch (e) {} } return null; }

// --fix：读原始 system.json（不过 loadSystem，故坏档/缺 md5fix 也能修）→ 计算修补 → 原子写 + .bak。返回是否动过盘。
function doFix() {
  const p = join(ROOT, 'system.json');
  let raw;
  try { raw = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { log.err(`--fix: 读取/解析 ${p} 失败：${e.message}（system.json 本体损坏，需手工修）`); return false; }
  const { patch, fixed, unfixable } = computeSystemRepairs(raw, {
    exists: existsSync,
    detectChrome: () => pickChrome(),
    detectFfmpeg: (cands) => pickFfmpeg([...(cands || []), 'ffmpeg']),
  });
  if (fixed.length) {
    saveJson(p, { ...raw, ...patch }); // patch 各顶层键已是合并后完整子对象 → 浅合并即可
    log.ok('--fix 已修补 system.json（旧值已备份 .bak）：');
    fixed.forEach((f) => log.info('   ✓ ' + f));
  } else log.ok('--fix：无可自动修补项');
  if (unfixable.length) {
    log.warn('以下为机器私有路径，不自动猜——请按提示手动确认：');
    unfixable.forEach((u) => { log.warn(`   ✗ ${u.key}：${u.why}`); log.diag(u.hint); });
  }
  return fixed.length > 0;
}

export async function runDoctor({ flags }) {
  if (flags.fix) doFix(); // 先修补，再走下面的只读体检看修补后实况

  const checks = [];
  const ok = (name, pass, note) => { checks.push({ name, pass, note }); log.info(`${pass ? '✓' : '✗'} ${name}: ${note}`); };

  let sys;
  try { sys = loadSystem(); ok('system.json', true, '可读'); }
  catch (e) {
    ok('system.json', false, e.message);
    if (flags.json) out({ command: 'doctor', checks, ok: false });
    const x = new Error('doctor 发现配置不可用：' + e.message);
    x.code = 'E_CONFIG';
    throw x;
  }

  for (const [name, p] of [['C:', 'C:\\'], ['台账盘 flatRoot', sys.project.flatRoot], ['md5fix 盘', sys.md5fix.outDir]]) {
    const g = freeGB(p); ok(`磁盘 ${name}`, g != null && g > 2, g == null ? `测不到 ${p}` : `${g.toFixed(1)} GB 可用`);
  }
  const ff = pickFfmpeg(sys.ffmpeg && sys.ffmpeg.candidates); ok('ffmpeg', !!ff, ff || '候选都不可用（system.json ffmpeg.candidates）');
  ok('chrome.exe', existsSync(sys.chrome.path), sys.chrome.path);
  ok('台账文件', ledgerExists(sys.project.ledgerPath), sys.project.ledgerPath);
  try { loadState(sys.project.ledgerPath); ok('台账解析', true, 'OK'); } catch (e) { ok('台账解析', false, e.message); }
  try {
    const reg = channelRegistry(); ok('通道不变量', true, `free=${reg.testId} / paid=${reg.delivId}`);
    for (const id of reg.ids) { const t = loadTarget(id); const up = await probeChromePort(t.port); log.info(`  端口 ${id} :${t.port} ${up ? '在跑' : '未运行'}`); checks.push({ name: `port-${id}`, pass: true, note: `:${t.port} ${up ? 'up' : 'down'}` }); }
  } catch (e) { ok('通道不变量', false, e.message); }

  const fails = checks.filter(c => !c.pass);
  log[fails.length ? 'warn' : 'ok'](`体检完：${checks.length - fails.length}/${checks.length} 通过${fails.length ? '；注意上面 ✗' : '，环境就绪'}`);
  if (flags.json) out({ command: 'doctor', checks, ok: !fails.length });
  if (fails.length) {
    const e = new Error(`doctor 发现 ${fails.length} 项失败：${fails.map(f => f.name).join(', ')}`);
    e.code = 'E_CONFIG';
    throw e;
  }
}
