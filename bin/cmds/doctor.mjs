// doctor：环境自检——磁盘(C/H/I)/ffmpeg/chrome/端口/台账/通道不变量。纯只读，直击"硬环境前提·缺一即停"。
import { existsSync, statfsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadSystem, channelRegistry, loadTarget } from '../../lib/config.mjs';
import { loadState, ledgerExists } from '../../lib/state.mjs';
import { probeChromePort } from '../../lib/session.mjs';
import { log, out } from '../../lib/log.mjs';

function freeGB(p) { try { const s = statfsSync(p); return (s.bavail * s.bsize) / 1e9; } catch (e) { return null; } }
function pickFfmpeg(cands) { for (const f of cands || []) { try { execFileSync(f, ['-version'], { stdio: 'ignore' }); return f; } catch (e) {} } return null; }

export async function runDoctor({ flags }) {
  const checks = [];
  const ok = (name, pass, note) => { checks.push({ name, pass, note }); log.info(`${pass ? '✓' : '✗'} ${name}: ${note}`); };

  let sys;
  try { sys = loadSystem(); ok('system.json', true, '可读'); }
  catch (e) { ok('system.json', false, e.message); if (flags.json) out({ command: 'doctor', checks, ok: false }); return; }

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
}
