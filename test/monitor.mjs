// test/monitor.mjs —— 「监视器」worker。每 5s 轮询 9222 页面状态(up/标签数/URL)，每 ~30s 深读一个 1849 标签账户。
// 状态变化或出现 DANGER(1849 标签显示非捷沅3 / 关键异常) 才记录，避免刷屏。跑到 14:00。
import { connect } from '../lib/cdp.mjs';
import { appendFileSync, mkdirSync } from 'node:fs';
const ROOT = 'I:\\weilai-01', OUT = ROOT + '\\test-out'; mkdirSync(OUT, { recursive: true });
const LOG = OUT + '\\monitor.jsonl';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => new Date(); const ts = () => now().toTimeString().slice(0, 8);
const rec = o => appendFileSync(LOG, JSON.stringify({ t: ts(), ...o }) + '\n');
const A3 = '1849209213181706';
const short = u => (u || '').replace(/&amp;/g, '&').replace('https://qianchuan.jinritemai.com', 'qc').replace('https://', '').slice(0, 38);

async function poll(deep) {
  let tabs;
  try { tabs = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(t => t.type === 'page'); }
  catch (e) { return { up: false }; }
  const s = { up: true, pages: tabs.length, urls: tabs.map(t => short(t.url)) };
  if (deep) {
    const j = tabs.find(t => (t.url || '').replace(/&amp;/g, '&').includes('aavid=' + A3));
    if (j) {
      try {
        const c = await connect({ port: 9222, aavid: A3 });
        s.jie3acc = await c.ev(`(document.body.innerText.match(/聚量TS-(捷沅.)/)||[])[1]||'?'`);
        s.jie3pop = await c.ev(`!!document.querySelector('[class*=vmok][class*=mask]')`);
        c.close();
        if (s.jie3acc !== '?' && s.jie3acc !== '捷沅3') s.DANGER = '1849标签账户=' + s.jie3acc; // 危险: jie3 标签显示非捷沅3
      } catch (e) { s.jie3acc = 'connect-fail'; }
    } else s.jie3acc = 'no-1849-tab';
  }
  return s;
}

const TARGET = now(); TARGET.setHours(14, 0, 0, 0);
rec({ ev: 'START' });
let i = 0, prev = '';
while (now() < TARGET) {
  i++;
  const deep = i % 6 === 0; // 每 6 次(~30s)深读账户
  let s; try { s = await poll(deep); } catch (e) { s = { err: String(e.message || e).slice(0, 40) }; }
  const key = s.up ? (s.pages + '|' + (s.urls || []).join(',') + '|' + (s.jie3acc || '')) : 'DOWN';
  if (key !== prev || s.DANGER) { rec(s); prev = key; }
  if (s.DANGER) rec({ ALERT: s.DANGER });
  await sleep(5000);
}
rec({ ev: 'DONE' });
