// lib/cdp.mjs —— CDP 原语 + 页内去重助手。
// 继承自 I:\cdp-helper\lib-cdp.mjs（验证过），增强：port/aavid 可配（双实例）、吸收 8 个去重模式中的页内 5 个
// (isVisible/synthClick/setInput/dismissModal/nextPage) + Node 侧 捕签名/重放/网络监听。
// 受信任手势 clickAt 保留（上传拖拽框必须用，属计划②）。

// ── 连接 ──────────────────────────────────────────────────────
// connect('uni-prom') 旧用法仍可；新用法 connect({port, urlSub, aavid})。
export async function connect(opts = {}) {
  if (typeof opts === 'string') opts = { urlSub: opts };
  const PORT = opts.port || Number(process.env.QC_PORT) || 9222;
  const urlSub = opts.urlSub ?? 'uni-prom'; // 用 ?? 不用 ||：driver 标签传 '' 要保留（'' 匹配任意页）
  const want = opts.aavid || process.env.QC_AAVID;
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  let page;
  if (want) {
    page = targets.find(t => t.type === 'page' && (t.url || '').replace(/&amp;/g, '&').includes('aavid=' + want));
    if (!page) throw new Error(`no page for aavid=${want} on :${PORT}`);
  } else {
    page = targets.find(t => t.type === 'page' && (t.url || '').includes(urlSub))
        || targets.find(t => t.type === 'page' && (t.url || '').includes('qianchuan'));
  }
  if (!page) throw new Error(`no page for ${urlSub} on :${PORT}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const handlers = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m); pending.delete(m.id); return; }
    if (m.method) handlers.forEach(h => h(m));
  });
  await new Promise((res, rej) => {
    const to = setTimeout(() => { try { ws.close(); } catch (e) {} rej(new Error(`ws open timeout :${PORT}`)); }, opts.openTimeoutMs || 8000); // ★P1: 不再无限挂死
    ws.addEventListener('open', () => { clearTimeout(to); res(); });
    ws.addEventListener('error', () => { clearTimeout(to); rej(new Error(`ws error :${PORT}`)); });
  });
  // ★P1: ws 断开(浏览器被杀/卡)时拒绝所有在途请求，别让调用方挂死
  ws.addEventListener('close', () => { for (const [, p] of pending) { try { p.rej(new Error('ws closed')); } catch (e) {} } pending.clear(); });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    const to = setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(`CDP timeout: ${method}`)); } }, opts.sendTimeoutMs || 30000); // ★P1: 单条命令也有超时
    pending.set(i, { res: v => { clearTimeout(to); res(v); }, rej: e => { clearTimeout(to); rej(e); } });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => r.result && r.result.result && r.result.result.value);
  const onEvent = fn => { handlers.push(fn); return () => { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); }; };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clickAt = async (x, y) => { // 受信任手势（仅上传拖拽框需要）
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  // 在页内执行 body（自动前置 PAGE_HELPERS，可用 __vis/__synthClick/...），返回值经 JSON 透传。
  const j = body => ev(`(function(){${PAGE_HELPERS}\n${body}\n})()`);
  return { ws, send, ev, j, onEvent, sleep, clickAt, port: PORT, url: page.url, close: () => ws.close() };
}

// ── 浏览器级连接（telemetry 旁挂用，可与页面级并存） ───────────────
export async function connectBrowser(port = 9222) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const handlers = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id).res(m); pending.delete(m.id); return; }
    if (m.method) handlers.forEach(h => h(m));
  });
  await new Promise((res, rej) => {
    const to = setTimeout(() => { try { ws.close(); } catch (e) {} rej(new Error(`browser ws open timeout :${port}`)); }, 8000);
    ws.addEventListener('open', () => { clearTimeout(to); res(); });
    ws.addEventListener('error', () => { clearTimeout(to); rej(new Error(`browser ws error :${port}`)); });
  });
  ws.addEventListener('close', () => { for (const [, p] of pending) { try { p.rej(new Error('ws closed')); } catch (e) {} } pending.clear(); });
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id;
    const to = setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(`CDP timeout: ${method}`)); } }, 30000);
    pending.set(i, { res: v => { clearTimeout(to); res(v); }, rej: e => { clearTimeout(to); rej(e); } });
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const onEvent = fn => { handlers.push(fn); return () => { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); }; };
  return { ws, send, onEvent, close: () => ws.close() };
}

// ── 页内去重助手（注入字符串；含 __vis/__synthClick/__setInput/__byText/__dismissModal/__nextPage） ──
export const PAGE_HELPERS = `
function __vis(el){ if(!el) return false; const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0 && r.height>0 && s.display!=='none' && s.visibility!=='hidden'; }
function __synthClick(el){ if(!el) return false; try{el.scrollIntoView({block:'center'});}catch(e){} ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>{ try{ el.dispatchEvent(new (t.indexOf('pointer')===0?PointerEvent:MouseEvent)(t,{bubbles:true,cancelable:true,view:window})); }catch(e){} }); try{ if(el.click) el.click(); }catch(e){} return true; }
function __setInput(el,val){ if(!el) return false; const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(el,val); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true; }
function __byText(re,sel){ const rx=(re instanceof RegExp)?re:new RegExp(re); return [...document.querySelectorAll(sel||'button,span,div,a,[role=tab],[role=button]')].filter(e=>__vis(e)&&rx.test((e.innerText||'').trim())&&e.querySelectorAll('*').length<=2); }
function __clickText(re,sel){ const m=__byText(re,sel)[0]; if(!m) return false; return __synthClick(m); }
function __dismissModal(){ let acted=0;
  const closers=[...document.querySelectorAll('[class*="vmok"][class*="close"],[class*="modal"][class*="close"],[class*="popup"][class*="close"]')]
    .filter(e=>__vis(e) && !/oc-promotion-product-adinfo-close-icon/.test(e.className||'')); // 黑名单破坏性叉
  for(const c of closers){ const r=c.getBoundingClientRect(); if(r.width<56&&r.height<56){ __synthClick(c); acted++; } }
  const safe=__byText(/^(我知道了|知道了|跳过|忽略|好的)$/).filter(e=>{ let p=e,d=0; while(p&&d<8){ if(/modal|popup|dialog|mask|vmok/i.test(p.className||'')) return true; p=p.parentElement; d++; } return false; });
  for(const b of safe){ __synthClick(b); acted++; }
  return acted; }
function __nextPage(){ let c=[...document.querySelectorAll('[class*=pagination] *,[class*=pager] *,li,button,a,span')].filter(e=>__vis(e)&&/^(下一页|>|»)$/.test((e.innerText||'').trim())&&e.querySelectorAll('*').length<=1); c.sort((a,b)=>b.getBoundingClientRect().y-a.getBoundingClientRect().y); const el=c[0]; if(!el) return false; return __synthClick(el); }
`;

export const norm = s => s.replace(/[–—-]/g, '-').replace(/\s+/g, '').toLowerCase();

// ── Node 侧便捷封装 ────────────────────────────────────────────
export const clickText = (cdp, re, sel) => cdp.j(`return __clickText(${re instanceof RegExp ? re.toString() : JSON.stringify(re)}, ${sel ? JSON.stringify(sel) : 'null'});`);
export const dismissModals = (cdp) => cdp.j(`return __dismissModal();`);
export const nextPage = (cdp) => cdp.j(`return __nextPage();`);
export async function setInputByPlaceholder(cdp, placeholderRe, val) {
  return cdp.j(`const rx=${placeholderRe.toString()}; const inp=[...document.querySelectorAll('input,textarea')].filter(__vis).find(i=>rx.test(i.getAttribute('placeholder')||'')); if(!inp) return false; __setInput(inp,${JSON.stringify(val)}); return true;`);
}

// 监听并捕获下一条 URL 含 substr 的请求（{url,method,postData,headers}）。需先 Network.enable。
export async function captureRequest(cdp, substr, { timeoutMs = 12000 } = {}) {
  await cdp.send('Network.enable');
  return new Promise((resolve) => {
    let done = false;
    const off = cdp.onEvent(m => {
      if (done) return;
      if (m.method === 'Network.requestWillBeSent' && (m.params.request.url || '').includes(substr)) {
        done = true; off();
        const r = m.params.request;
        resolve({ url: r.url, method: r.method, postData: r.postData || null, headers: r.headers || {} });
      }
    });
    setTimeout(() => { if (!done) { done = true; off(); resolve(null); } }, timeoutMs);
  });
}

// 在页内重放 fetch（带 cookie），返回 {status, text}。签名在 url/headers 里，不绑 body 的接口可改 body 重放。
export async function replayFetch(cdp, url, { method = 'POST', body = null, headers = {} } = {}) {
  const expr = `(async function(){ try{
    const res=await fetch(${JSON.stringify(url)},{method:${JSON.stringify(method)},credentials:'include',
      headers:Object.assign({'content-type':'application/json'},${JSON.stringify(headers)}),
      body:${body == null ? 'undefined' : JSON.stringify(typeof body === 'string' ? body : JSON.stringify(body))}});
    const t=await res.text(); return JSON.stringify({status:res.status,text:t.slice(0,2000)});
  }catch(e){return JSON.stringify({status:-1,text:String(e)});} })()`;
  const raw = await cdp.ev(expr);
  try { return JSON.parse(raw); } catch (e) { return { status: -1, text: raw }; }
}
