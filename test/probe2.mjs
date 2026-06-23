import { connect } from '../lib/cdp.mjs';
const cdp = await connect({ port: 9222, aavid: '1849209213181706' });
await cdp.send('Runtime.enable');
const out = {
  title: await cdp.ev('document.title'),
  innerText有捷沅: await cdp.ev(`(document.body.innerText.match(/捷沅./g)||[]).join(',')||'NONE'`),
  innerText有聚量: await cdp.ev(`(document.body.innerText.match(/聚量[^ ]{0,10}/g)||[]).join(',')||'NONE'`),
  html有捷沅: await cdp.ev(`(document.documentElement.outerHTML.match(/捷沅./g)||[]).slice(0,6).join(',')||'NONE'`),
  html有聚量TS捷沅: await cdp.ev(`(document.documentElement.outerHTML.match(/聚量TS-捷沅./g)||[]).slice(0,3).join(',')||'NONE'`),
  bodyLen: await cdp.ev(`document.body.innerText.length`),
};
console.log(JSON.stringify(out, null, 1));
cdp.close();
