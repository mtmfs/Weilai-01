// test/manual/interferer.mjs —— 「不定期干扰」worker。随机间隔(7-23s)随机扰动 jie3：乱跳转/顶登录/乱点/弹窗/诱饵标签。
// 跑到 14:00。安全：乱点排除破坏性文案；只动 jie3(免费/暂停)，不碰 jie6。
import { connect, connectBrowser } from '../../lib/cdp.mjs';
import { appendFileSync, mkdirSync } from 'node:fs';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const ROOT = 'I:\\weilai-01', OUT = ROOT + `\\test-out\\manual-${runId}-interferer`; mkdirSync(OUT, { recursive: true });
const LOG = OUT + '\\interferer.jsonl';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date(); const ts = () => now().toTimeString().slice(0, 8);
const rec = o => appendFileSync(LOG, JSON.stringify({ t: ts(), ...o }) + '\n');
const A3 = '1849209213181706', A6 = '1862076853297476';
const J6 = `https://qianchuan.jinritemai.com/uni-prom?aavid=${A6}`;
async function onJie3(fn) {
  let cdp; try { cdp = await connect({ port: 9222, aavid: A3 }); } catch (e) { return 'no-jie3-tab'; }
  try { await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); return await fn(cdp); }
  catch (e) { return 'err:' + String(e.message || e).slice(0, 40); }
  finally { cdp.close(); }
}
const actions = {
  navBlank: () => onJie3(async c => { await c.send('Page.navigate', { url: 'about:blank' }); return 'navd-blank'; }),
  nav1862: () => onJie3(async c => { await c.send('Page.navigate', { url: J6 }); return 'navd-1862'; }),
  topLogin: () => onJie3(async c => { await c.send('Page.navigate', { url: 'https://business.oceanengine.com/login' }); return 'navd-login'; }),
  click: () => onJie3(c => c.j(`const cand=[...document.querySelectorAll('button,a,[role=tab],.tab-label,span')].filter(e=>__vis(e)&&!/删除|移除|确定|确认|解除|停用|删|提交|开启|启用|关闭/.test(e.innerText||'')&&(e.innerText||'').trim().length>0&&(e.innerText||'').length<12);const el=cand[Math.floor(Math.random()*cand.length)];if(!el)return 'no-target';__synthClick(el);return 'clicked:'+(el.innerText||'').trim().slice(0,8);`)),
  popup: () => onJie3(c => c.ev(`(function(){const d=document.createElement('div');d.className='tools-vmok-plugin-modal__mask chaos-fake';d.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.4)';const x=document.createElement('span');x.className='tools-vmok-plugin-modal__close-icon';x.style.cssText='position:fixed;top:20px;right:20px;width:24px;height:24px;background:#fff';x.onclick=()=>d.remove();d.appendChild(x);document.body.appendChild(d);return 'popup-injected';})()`)),
  decoy: async () => { try { const b = await connectBrowser(9222); await b.send('Target.createTarget', { url: J6 }); b.close(); return 'decoy-1862'; } catch (e) { return 'decoy-err(' + String(e.message || e).slice(0, 20) + ')'; } },
};
const keys = Object.keys(actions);
const TARGET = now(); TARGET.setHours(14, 0, 0, 0);
rec({ ev: 'START' });
let n = 0;
while (now() < TARGET) {
  await sleep(15000 + Math.floor(Math.random() * 90000)); // 15-105s 真·不定期(留平静窗口让 ready 有机会收敛, 看阈值)
  if (now() >= TARGET) break;
  const k = keys[Math.floor(Math.random() * keys.length)];
  let res; try { res = await actions[k](); } catch (e) { res = 'throw:' + String(e.message || e).slice(0, 40); }
  n++; rec({ n, action: k, res });
}
rec({ ev: 'DONE', count: n });
