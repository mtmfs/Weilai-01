// test/manual/operator.mjs —— 「不断从0启动」worker。循环：关浏览器(冷) → ready jie3(重启+收敛) → 记录。跑到 14:00。
// 与 interferer/monitor 并发：扰动会落在收敛进行中，才是真实压测。
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { connectBrowser } from '../../lib/cdp.mjs';
const ROOT = 'I:\\weilai-01', OUT = ROOT + '\\test-out'; mkdirSync(OUT, { recursive: true });
const LOG = OUT + '\\operator.jsonl';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date(); const ts = () => now().toTimeString().slice(0, 8);
const rec = o => appendFileSync(LOG, JSON.stringify({ t: ts(), ...o }) + '\n');
const cli = args => { const r = spawnSync('node', [ROOT + '\\bin\\weilai.mjs', ...args], { encoding: 'utf8', timeout: 160000 }); return { code: r.status == null ? 1 : r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() }; };
async function closeBrowser(port) { try { const b = await connectBrowser(port); await b.send('Browser.close'); b.close(); } catch (e) {} await sleep(2500); }

const TARGET = now(); TARGET.setHours(14, 0, 0, 0);
rec({ ev: 'START' });
let i = 0;
while (now() < TARGET) {
  i++;
  const cold = i % 3 !== 0; // 2/3 冷启动(关浏览器再 ready), 1/3 热(直接 ready 测幂等)
  const t0 = Date.now();
  if (cold) await closeBrowser(9222);
  const r = cli(['ready', '--as', 'free']);
  const sec = Math.round((Date.now() - t0) / 1000);
  const tail = (r.out.split('\n').filter(Boolean).pop() || '').slice(0, 90);
  rec({ i, mode: cold ? 'cold' : 'warm', code: r.code, sec, tail });
  if (now() >= TARGET) break;
  await sleep(15000 + Math.floor(Math.random() * 20000)); // 15-35s 给 interferer 留窗口
}
rec({ ev: 'DONE', iters: i });
