import { connect } from '../lib/cdp.mjs';
const port = +(process.argv[2] || 9223), aavid = process.argv[3] || '1862076853297476';
const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'page');
console.log('tabs on ' + port + ':'); list.forEach(t => console.log('  -', (t.url || '').replace(/&amp;/g, '&').slice(0, 85)));
const cdp = await connect({ port, aavid });
await cdp.send('Runtime.enable');
const out = {
  url: (await cdp.ev('location.href')).slice(0, 90),
  title: await cdp.ev('document.title'),
  readyState: await cdp.ev('document.readyState'),
  isLoginPage: await cdp.ev(`/\\/login|passport|account\\/login/.test(location.href) || !!document.querySelector('input[type=password]')`),
  聚量TS: await cdp.ev(`(document.documentElement.outerHTML.match(/聚量TS-捷沅./g)||[]).slice(0,3).join(',')||'NONE'`),
  bodyHead: await cdp.ev(`(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,220)`),
};
console.log(JSON.stringify(out, null, 1));
cdp.close();
