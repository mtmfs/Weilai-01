// test/manual/chaos.mjs —— 生产环境故障模拟·混沌测试。循环跑到 14:00，记录 bug 不修。
// 安全：随机点击只在 jie3(免费/暂停)且排除破坏性文案；jie6 只做导航扰动，不乱点。
import { spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { connect, connectBrowser } from '../../lib/cdp.mjs';
import { probeUrl, probeView, listTabs } from '../../lib/session.mjs';
import { guard } from '../../lib/guard.mjs';
import { loadConfig } from '../../lib/config.mjs';

const ROOT = 'I:\\weilai-01';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = ROOT + `\\test-out\\manual-${runId}-chaos`;
mkdirSync(OUT, { recursive: true });
const LOG = OUT + '\\chaos-log.jsonl';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date();
const stamp = () => now().toTimeString().slice(0, 8);
function rec(o) { const line = JSON.stringify({ t: stamp(), ...o }); appendFileSync(LOG, line + '\n'); console.log(line); }

// 跑 weilai CLI，返回 {code, out}
function cli(args) {
  const r = spawnSync('node', [ROOT + '\\bin\\weilai.mjs', ...args], { encoding: 'utf8', timeout: 160000 });
  return { code: r.status == null ? 1 : r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// 连标签干点事（驱动/扰动）
async function drive(port, opts, fn) {
  let cdp;
  try { cdp = await connect({ port, ...opts }); } catch (e) { return { err: String(e.message || e) }; }
  try { await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); return await fn(cdp); }
  finally { cdp.close(); }
}
async function nav(port, opts, url, waitMs = 6000) {
  return drive(port, opts, async cdp => { await cdp.send('Page.navigate', { url }); await sleep(waitMs); return await probeUrl(cdp); });
}
async function openDecoy(port, url) {
  const b = await connectBrowser(port); await b.send('Target.createTarget', { url }); b.close(); await sleep(6000);
}
// 每轮清理：关掉 blank/newtab/1862诱饵/login 残留标签，防多轮累积让 connect 抓瞎。
async function cleanupTabs(port) {
  try {
    const tabs = await listTabs(port);
    if (tabs.length <= 4) return 0;
    const b = await connectBrowser(port); let closed = 0;
    for (const t of tabs) {
      const u = (t.url || '').replace(/&amp;/g, '&');
      if (u === 'about:blank' || u === 'chrome://newtab/' || u.includes('aavid=' + A6) || /\/login|site\/index|passport/.test(u)) {
        try { await b.send('Target.closeTarget', { targetId: t.id }); closed++; } catch (e) {}
      }
    }
    b.close(); return closed;
  } catch (e) { return -1; }
}
const A3 = '1849209213181706', A6 = '1862076853297476';
const J3 = `https://qianchuan.jinritemai.com/uni-prom?aavid=${A3}`;
const J6 = `https://qianchuan.jinritemai.com/uni-prom?aavid=${A6}`;

// ── 场景 ──────────────────────────────────────────────
async function S0_baseline() {
  const r = cli(['ready', '--as', 'free']);
  rec({ scenario: 'S0_baseline', code: r.code, ok: r.code === 0, tail: r.out.trim().split('\n').pop() });
}
async function S1_multiWindow() {
  await openDecoy(9222, J6); // 捷沅6 诱饵标签
  const r = cli(['ready', '--as', 'free']);
  // 验诱饵 1862 标签未被 jie3 操作导航搞乱（账户名探针已退役，改用 URL 判据：标签仍含 aavid=A6）
  const decoyUrl = await drive(9222, { aavid: A6 }, async cdp => probeUrl(cdp).catch(() => ''));
  const touchedWrong = r.code === 0 && decoyUrl && !String(decoyUrl).replace(/&amp;/g, '&').includes('aavid=' + A6);
  rec({ scenario: 'S1_multiWindow', code: r.code, decoyUrl, BUG: touchedWrong ? 'jie3 操作疑似动到诱饵 1862' : null, ok: r.code === 0 && !touchedWrong });
}
async function S2_navDisrupt() {
  const before = await nav(9222, { aavid: A3 }, 'about:blank', 3000);
  const r = cli(['ready', '--as', 'free']);
  rec({ scenario: 'S2_navDisrupt', disruptedTo: before, code: r.code, ok: r.code === 0, note: r.code === 0 ? '自愈重收敛' : '未自愈' });
}
async function S3_clickChaos() {
  const clicked = await drive(9222, { aavid: A3 }, async cdp => {
    return cdp.j(`let done=[];const cand=[...document.querySelectorAll('button,a,[role=tab],.tab-label,span')].filter(e=>__vis(e)&&!/删除|移除|确定|确认|解除|停用|删|提交|开启/.test((e.innerText||''))&&(e.innerText||'').trim().length>0&&(e.innerText||'').length<12);for(let i=0;i<2&&cand.length;i++){const el=cand[Math.floor(cand.length*((i+1)/3))];if(el){done.push((el.innerText||'').trim().slice(0,8));__synthClick(el);}}return JSON.stringify(done);`).then(s => JSON.parse(s || '[]')).catch(() => []);
  });
  await sleep(2500);
  const r = cli(['ready', '--as', 'free']);
  rec({ scenario: 'S3_clickChaos', clicked, code: r.code, ok: r.code === 0, note: r.code === 0 ? '乱点后恢复' : '乱点后未恢复' });
}
async function S4_topLogin() {
  // 顶登录：把 jie3 标签导到登录页（模拟被顶）
  const u = await nav(9222, { aavid: A3 }, 'https://business.oceanengine.com/login', 7000);
  // guard-op：期望 guard 检测掉登录、拒操作（不应静默成功）
  let guardOut;
  try {
    const cfg = loadConfig('jie3');
    guardOut = await drive(9222, { urlSub: '' }, async cdp => guard(cdp, cfg, async () => 'op', { allowRecover: false }).then(() => 'PASSED(疑漏检)').catch(e => e.code || String(e.message)));
  } catch (e) { guardOut = { err: String(e.message || e) }; }
  const r = cli(['ready', '--as', 'free']); // ready 应正确停(无凭据→E_LOGIN) 或自愈
  const safe = guardOut === 'E_LOGIN' || guardOut === 'E_SIG' || guardOut === 'E_DRIFT' || (guardOut && guardOut.err);
  rec({ scenario: 'S4_topLogin', drivenTo: (u || '').slice(0, 50), guard: guardOut, readyCode: r.code, BUG: (guardOut === 'PASSED(疑漏检)') ? 'guard 漏检掉登录' : null, ok: !!safe });
}
async function S5_driftAccount() {
  await nav(9222, { aavid: A3 }, J6, 7000); // 把"jie3 标签"导到 1862（模拟漂移）
  const r = cli(['ready', '--as', 'free']);
  // ready 后应有干净的 1849 标签（账户名探针已退役，改用 URL 判据：标签在位且含 aavid=A3）
  const j3Url = await drive(9222, { aavid: A3 }, async cdp => probeUrl(cdp).catch(() => ''));
  const drifted = r.code === 0 && j3Url && !String(j3Url).replace(/&amp;/g, '&').includes('aavid=' + A3);
  rec({ scenario: 'S5_driftAccount', readyCode: r.code, jie3Url: j3Url, BUG: drifted ? '1849 标签疑似漂移' : null, ok: r.code === 0 && !drifted });
}
async function S6_popup() {
  await drive(9222, { aavid: A3 }, async cdp => cdp.ev(`(function(){const d=document.createElement('div');d.className='tools-vmok-plugin-modal__mask chaos-fake';d.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.4)';const x=document.createElement('span');x.className='tools-vmok-plugin-modal__close-icon';x.style.cssText='position:fixed;top:20px;right:20px;width:24px;height:24px;background:#fff';d.appendChild(x);document.body.appendChild(d);return 'injected';})()`));
  const r = cli(['ready', '--as', 'free']);
  const gone = await drive(9222, { aavid: A3 }, async cdp => cdp.ev(`!document.querySelector('.chaos-fake')`));
  rec({ scenario: 'S6_popup', readyCode: r.code, popupGone: gone, BUG: gone === false ? 'closePopup 没清掉假弹窗' : null, ok: r.code === 0 });
}
async function S7_twoInstance() {
  const r = cli(['ready', '--as', 'paid']); // paid 配置 port=9223，新 profile 大概率未登录
  rec({ scenario: 'S7_twoInstance', code: r.code, tail: r.out.trim().split('\n').slice(-2).join(' | '), note: r.code === 11 ? 'jie6 新实例需登录(E_LOGIN) — 预期/待报告' : ('code=' + r.code) });
}

const SCENARIOS = [S0_baseline, S1_multiWindow, S2_navDisrupt, S3_clickChaos, S4_topLogin, S5_driftAccount, S6_popup];

// ── 主循环：跑到 14:00 ──────────────────────────────────
const ONCE = process.argv.includes('--once');
const TARGET = now(); TARGET.setHours(14, 0, 0, 0);
rec({ ev: 'START', until: '14:00', once: ONCE });
let cycle = 0;
do {
  cycle++;
  rec({ ev: 'cycle', cycle, cleaned: await cleanupTabs(9222) });
  for (const s of SCENARIOS) {
    if (!ONCE && now() >= TARGET) break;
    try { await s(); } catch (e) { rec({ scenario: s.name, ev: 'HARNESS_ERROR', err: String(e && e.message || e) }); }
    await sleep(2500);
  }
  // S7 双实例只在第1轮跑(避免反复起 9223 堆进程；jie6 新 profile 未登录的结论一次即够)
  if (cycle === 1) { try { await S7_twoInstance(); } catch (e) { rec({ scenario: 'S7_twoInstance', ev: 'HARNESS_ERROR', err: String(e && e.message || e) }); } }
  if (ONCE) break;
  await sleep(12000);
} while (now() < TARGET);
rec({ ev: 'DONE', cycles: cycle });
