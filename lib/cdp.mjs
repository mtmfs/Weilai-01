// lib/cdp.mjs —— CDP 原语 + 页内去重助手。
// 继承自 I:\cdp-helper\lib-cdp.mjs（验证过），增强：port/aavid 可配（双实例）、吸收 8 个去重模式中的页内 5 个
// (isVisible/synthClick/setInput/dismissModal/nextPage) + Node 侧 捕签名/重放/网络监听。
// 受信任手势 clickAt 保留（上传拖拽框必须用，属计划②）。
import { CDP_PORT, cdpList, cdpVersion } from './selectors.mjs';

// ── 连接 ──────────────────────────────────────────────────────
// connect('uni-prom') 旧用法仍可；新用法 connect({port, urlSub, aavid})。
export async function connect(opts = {}) {
  if (typeof opts === 'string') opts = { urlSub: opts };
  const PORT = opts.port || Number(process.env.QC_PORT) || CDP_PORT;
  const urlSub = opts.urlSub ?? 'uni-prom'; // 用 ?? 不用 ||：driver 标签传 '' 要保留（'' 匹配任意页）
  const want = opts.aavid || process.env.QC_AAVID;
  const targets = await (await fetch(cdpList(PORT))).json();
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
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      // ★A4: CDP 协议错误（m.error）必须 reject，别静默 resolve 成 undefined 让调用方误判。
      if (m.error) p.rej(Object.assign(new Error(`CDP 错误: ${m.error.message || ''}${m.error.code != null ? ` (code ${m.error.code})` : ''}`), { cdpError: m.error }));
      else p.res(m);
      return;
    }
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
  const ev = expr => send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then(r => {
    const R = r.result || {};
    // ★A4: 页内表达式抛异常时 exceptionDetails 会被填，旧版直接吞成 undefined → 误判"没找到"。改成大声抛出。
    if (R.exceptionDetails) {
      const ex = R.exceptionDetails;
      const msg = (ex.exception && (ex.exception.description || ex.exception.value)) || ex.text || 'in-page exception';
      throw Object.assign(new Error('页内异常: ' + String(msg).slice(0, 200)), { code: 'E_EVAL' });
    }
    return R.result && R.result.value;
  });
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
export async function connectBrowser(port = CDP_PORT) {
  const v = await (await fetch(cdpVersion(port))).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); const handlers = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      // ★A4: CDP 协议错误（m.error）必须 reject，别静默 resolve 成 undefined 让调用方误判。
      if (m.error) p.rej(Object.assign(new Error(`CDP 错误: ${m.error.message || ''}${m.error.code != null ? ` (code ${m.error.code})` : ''}`), { cdpError: m.error }));
      else p.res(m);
      return;
    }
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

// ★视口硬化（Playwright 式·根治 NO_CHOOSER 的环境层）：钉死虚拟视口 1920×1080 + 模拟聚焦 →
//   页面布局与真实窗口大小/位置/前台与否彻底解耦、坐标恒定（窗口被拖小/后台/换显示器都不再让目标跑屏外）。
//   凡随后按 getBoundingClientRect 坐标做 clickAt/Input.dispatchMouseEvent 的 page-level 连接（upload/delete/ready）都应先调它。
//   两调用裹 try/catch（非致命）；override 随该连接关闭即失效，无需 clearDeviceMetricsOverride。connectBrowser 是浏览器级、不适用。
// viewport={width,height} 由 system.chrome.viewport 传入（派生自 --window-size flag，单一真源）；缺省回退 1920×1080。
export async function hardenViewport(cdp, viewport) {
  const width = (viewport && viewport.width) || 1920;
  const height = (viewport && viewport.height) || 1080;
  try { await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); } catch (e) {}
  try { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) {}
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
`;

// ★三-3: 归一更多 unicode 连字符/破折号变体（‐‑‒–—―、减号 −、全角 －、小型连字符）+ 折叠空白。
// 注意：刻意不合并 `_2` / `(2)` / `-2` 这类后缀风格（语义可能不同，合并会误并不同文件）。
export const norm = s => s.replace(/[‐-―−﹘﹣－-]/g, '-').replace(/\s+/g, '').toLowerCase();

// ── Node 侧便捷封装 ────────────────────────────────────────────
export const clickText = (cdp, re, sel) => cdp.j(`return __clickText(${re instanceof RegExp ? re.toString() : JSON.stringify(re)}, ${sel ? JSON.stringify(sel) : 'null'});`);
export const dismissModals = (cdp) => cdp.j(`return __dismissModal();`);

// ★窗口化多请求收集器（泛化 delete.mjs::uiDeleteCapture 的 onEvent 抓签名模式）：缓冲 URL 命中 urlRe 的请求，
//   记 postData，并在 loadingFinished 时抓 response body（getResponseBody 需 requestId 关联）。只缓冲命中项 → 内存极小。
//   返回 { events, stop }；events 实时增长，用完必须 stop()（解绑 handler）。需 Network.enable（内部幂等调）。
export async function openRequestCollector(cdp, { urlRe, withBody = true, maxEntries = 200 } = {}) {
  await cdp.send('Network.enable');
  const events = [];
  const byId = new Map();
  const off = cdp.onEvent(async (m) => {
    try {
      if (m.method === 'Network.requestWillBeSent') {
        const u = (m.params.request && m.params.request.url) || '';
        if (urlRe && urlRe.test(u) && events.length < maxEntries) {
          const entry = { url: u, requestId: m.params.requestId, method: m.params.request.method, reqBody: m.params.request.postData || null, status: null, mimeType: null, respBody: null };
          byId.set(m.params.requestId, entry);
          events.push(entry);
        }
      } else if (m.method === 'Network.responseReceived') {
        const entry = byId.get(m.params.requestId);
        if (entry) { entry.status = m.params.response && m.params.response.status; entry.mimeType = m.params.response && m.params.response.mimeType; }
      } else if (m.method === 'Network.loadingFinished') {
        const entry = byId.get(m.params.requestId);
        if (entry && withBody && entry.respBody == null) {
          try {
            const r = await cdp.send('Network.getResponseBody', { requestId: m.params.requestId });
            const res = r && r.result;
            entry.respBody = res ? (res.base64Encoded ? Buffer.from(res.body, 'base64').toString('utf8') : res.body) : null;
          } catch (e) { /* body 已驱逐/取不到 → 留 null，靠 reqBody 兜底 */ }
        }
      }
    } catch (e) { /* 收集器绝不因单条事件异常影响主流程 */ }
  });
  return { events, stop: () => { try { off(); } catch (e) {} } };
}
