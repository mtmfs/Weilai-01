// 试恢复 jie3：新开 tab 直接 nav uni-prom?aavid=1849，等 18s，看是落 捷沅3 还是被弹回 捷沅6。
import { connectBrowser, connect } from '../lib/cdp.mjs';
const b = await connectBrowser(9222);
await b.send('Target.createTarget', { url: 'https://qianchuan.jinritemai.com/uni-prom?aavid=1849209213181706' });
b.close();
await new Promise(r => setTimeout(r, 18000));
try {
  const cdp = await connect({ port: 9222, aavid: '1849209213181706' });
  await cdp.send('Runtime.enable');
  console.log(JSON.stringify({
    found1849tab: true,
    url: (await cdp.ev('location.href')).slice(0, 78),
    account: await cdp.ev(`(document.documentElement.outerHTML.match(/聚量TS-(捷沅.)/)||[])[1]||'?'`),
  }, null, 1));
  cdp.close();
} catch (e) {
  console.log(JSON.stringify({ found1849tab: false, note: e.message }));
  const tabs = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(t => t.type === 'page').map(t => (t.url || '').slice(0, 60));
  console.log('当前tabs:', JSON.stringify(tabs, null, 1));
}
