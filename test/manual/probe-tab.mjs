// 一次性诊断：当前 9222 上 1849 标签到底显示什么（账户/开通页/加载态）。
import { connect } from '../../lib/cdp.mjs';
const cdp = await connect({ port: 9222, aavid: '1849209213181706' });
await cdp.send('Runtime.enable');
const out = {
  url: await cdp.ev('location.href'),
  readyState: await cdp.ev('document.readyState'),
  account: await cdp.ev(`(document.body.innerText.match(/聚量TS-(捷沅.)/)||[])[1]||'NONE'`),
  kaitong: await cdp.ev(`/开通|未开通|立即开通|账户开通|去开通/.test(document.body.innerText)`),
  hasAddVideo: await cdp.ev(`[...document.querySelectorAll('button,span,div')].some(e=>/^添加视频$/.test((e.innerText||'').trim()))`),
  bodyLen: await cdp.ev(`(document.body.innerText||'').length`),
  bodyHead: await cdp.ev(`(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,260)`),
};
console.log(JSON.stringify(out, null, 2));
cdp.close();
