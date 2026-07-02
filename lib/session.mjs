// lib/session.mjs —— 横切层·上下文就绪（可自启动）。
// 7 探针（只读判"我在哪一步"） + 8 动作（先探针、已达成即跳过） + ready 收敛调度器（6 种起始态）。
// 重构自 I:\cdp-helper\ 的 enter-1868 / enter-jie6-panel / login / qc-setup / nav-check / open-sucai / doctor。
import { spawn } from 'node:child_process';
import { connect, connectBrowser, clickText, dismissModals, hardenViewport } from './cdp.mjs';
import { cdpList, cdpVersion, URLS, URL_RE } from './selectors.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ════════════════ 7 探针（只读） ════════════════
export async function probeChromePort(port) {
  try { await fetch(cdpVersion(port)); return true; } catch (e) { return false; }
}
export async function listTabs(port) {
  return (await (await fetch(cdpList(port))).json()).filter(t => t.type === 'page');
}
export async function probeTab(port, aavid) {
  const tabs = await listTabs(port);
  return tabs.find(t => (t.url || '').replace(/&amp;/g, '&').includes('aavid=' + aavid)) || null;
}
// ★C1: 轮询页内判据到真即返回（替代 navigate/点击后盲等固定 N 秒）。predExpr 经 cdp.j 注入（可用 __vis/__byText）；
// 判据出错只当未就绪继续轮询；超时返回 false（调用方仍按原逻辑走）。timeoutMs=总预算（含 floor）→ 最坏==原固定 sleep。
async function waitFor(cdp, predExpr, { timeoutMs = 8000, intervalMs = 500, floorMs = 0 } = {}) {
  const t0 = Date.now();
  if (floorMs) await sleep(floorMs);
  while (Date.now() - t0 < timeoutMs) {
    let ok = false;
    try { ok = await cdp.j(`try{return !!(${predExpr});}catch(e){return false;}`); } catch (e) { ok = false; }
    if (ok) return true;
    await sleep(intervalMs);
  }
  return false;
}
export async function probeUrl(cdp) { return cdp.ev('location.href'); }
export async function probeLoginStatus(cdp) {
  const s = await cdp.j(`return JSON.stringify({url:location.href,hasPwd:!!document.querySelector('input[type=password]'),looksLogin:/\\/login|passport|account\\/login/.test(location.href)});`);
  return JSON.parse(s);
}
// session-cookie 新鲜度：能直连 uni-prom 且不被弹回 login，即视为热。（_x_ac_ts 在 HttpOnly cookie，JS 读不到，用行为判据。）
export async function probeSessionWarm(cdp) {
  const u = await probeUrl(cdp);
  return !URL_RE.sessionCold.test(u || '');
}
export async function probePlan(cdp, ui, planId) {
  if (ui === 'drawer') {
    return cdp.j(`return [...document.querySelectorAll('.ovui-tr,tr')].filter(r=>__vis(r)&&(r.innerText||'').includes(${JSON.stringify(planId)})).length;`);
  }
  return cdp.ev(`/adId=${planId}(?!\\d)/.test(location.href)?1:0`);
}
// 统一就绪信号：「添加视频」按钮可见（jie3 抽屉内 / jie6 素材tab内 都有）。
export async function probeView(cdp) {
  return cdp.j(`return __byText(/^添加视频$/).length>0;`);
}
// ★S8: 一次往返拿 url/view/plan，替代热路径多次顺序探针往返。
export async function probeSnapshot(cdp, { planId, ui } = {}) {
  const planExpr = ui === 'drawer'
    ? `[...document.querySelectorAll('.ovui-tr,tr')].filter(r=>__vis(r)&&(r.innerText||'').includes(${JSON.stringify(planId)})).length`
    : `(/adId=${planId}(?!\\d)/.test(location.href)?1:0)`;
  try {
    const s = await cdp.j(`return JSON.stringify({url:location.href,view:__byText(/^添加视频$/).length>0,plan:${planExpr}});`);
    return JSON.parse(s);
  } catch (e) { return { url: '', view: false, plan: 0 }; }
}

// ════════════════ 8 动作（幂等） ════════════════
// 1. launch-chrome：起调试 Chrome（已在则跳过），等端口监听。
export async function launchChrome(system, profile, port) {
  if (await probeChromePort(port)) return true;
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...(system.chrome.flags || [])];
  const child = spawn(system.chrome.path, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {}); // ★A8: chrome.path 错误时 spawn 会异步发 'error'，无监听则未捕获异常崩进程；吞掉后由下面探端口失败给干净的 E_CONFIG
  child.unref();
  for (let i = 0; i < 30; i++) { await sleep(1000); if (await probeChromePort(port)) return true; }
  return false;
}
// 2. login：母账号密码登录（协议框 + 合成提交）。重构自 login.mjs。
export async function login(cdp, email, pwd) {
  let u = await probeUrl(cdp);
  if (!URL_RE.loginExact.test(u)) {
    await cdp.send('Page.navigate', { url: URLS.login }); await sleep(8000);
  }
  await cdp.ev(`(function(){function set(sel,val){const i=document.querySelector(sel);if(!i)return false;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,val);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return true;}set('input[name=email]',${JSON.stringify(email)});set('input[name=password]',${JSON.stringify(pwd)});})()`);
  await sleep(400);
  // 协议复选框
  const agree = await cdp.ev(`(function(){function vis(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}let cb=[...document.querySelectorAll('input[type=checkbox]')][0];if(cb){if(!cb.checked)cb.click();return 'cb '+cb.checked;}const line=[...document.querySelectorAll('*')].find(e=>vis(e)&&/我已阅读并同意/.test(e.innerText||'')&&(e.innerText||'').length<40);if(line){const r=line.getBoundingClientRect();return JSON.stringify({clickAt:{x:Math.round(r.x+7),y:Math.round(r.y+r.height/2)}});}return 'none';})()`);
  if (agree && agree.includes('clickAt')) { const c = JSON.parse(agree).clickAt; await cdp.clickAt(c.x, c.y); await sleep(500); }
  // 登录按钮（坐标点，受信任）
  const btn = await cdp.ev(`(function(){function vis(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}const b=[...document.querySelectorAll('button,[class*=btn],div,span')].filter(e=>vis(e)&&/^登\\s*录$/.test((e.innerText||'').trim())).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];if(!b)return null;const r=b.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
  if (!btn) throw Object.assign(new Error('未找到登录按钮'), { code: 'E_LOGIN' });
  const c = JSON.parse(btn); await cdp.clickAt(c.x, c.y); await sleep(7000);
  return true;
}
// 3. sso-handshake：nav redirect/ad?advId 种千川会话（覆盖名下所有账户，~12h）。
export async function ssoHandshake(cdp, advId) {
  await cdp.send('Page.navigate', { url: URLS.ssoRedirect(advId) });
  await waitFor(cdp, "document.readyState==='complete'", { timeoutMs: 9000, floorMs: 2500 }); // ★C1（重定向种会话，留 2.5s 地板）
  return true;
}
// 4. ensure-tab：锁定 aavid 标签；无则浏览器级 Target.createTarget 新建并等出现（带重试，修旧 10s 硬等无重试）。
export async function ensureTab(port, aavid) {
  let tab = await probeTab(port, aavid);
  if (tab) return tab;
  const b = await connectBrowser(port);
  await b.send('Target.createTarget', { url: URLS.uniProm(aavid) });
  b.close();
  for (let i = 0; i < 8; i++) { await sleep(2000); tab = await probeTab(port, aavid); if (tab) return tab; }
  return null;
}
// 5. set-mode：jie3 推商品（点 tab）；jie6 推直播间靠 detail URL 锁，无需点。
export async function setMode(cdp, mode, ui) {
  if (ui !== 'drawer') return true; // jie6 走 detail URL
  await clickText(cdp, /^推商品$/, '.tab-label,span,div,a,[role=tab]');
  await waitFor(cdp, "[...document.querySelectorAll('input')].some(x=>__vis(x)&&((x.getAttribute('placeholder')||'').includes('计划')))", { timeoutMs: 5000, floorMs: 500 }); // ★C1: 等计划搜索框出现
  return true;
}
// 6. lock-plan：jie3 搜计划ID过滤（断言唯一行）；jie6 nav detail?adId 锁（绕 4 同名计划）。
export async function lockPlan(cdp, ui, aavid, planId) {
  if (ui === 'drawer') {
    const box = await cdp.ev(`(function(){function vis(el){const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}const i=[...document.querySelectorAll('input')].filter(x=>/计划名称\\/ID/.test(x.getAttribute('placeholder')||'')&&vis(x))[0];if(!i)return 'NOBOX';const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));const r=i.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
    if (box === 'NOBOX') return false;
    const c = JSON.parse(box); await cdp.clickAt(c.x, c.y); await sleep(200);
    await cdp.send('Input.insertText', { text: planId });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
    await waitFor(cdp, `[...document.querySelectorAll('.ovui-tr,tr')].some(r=>__vis(r)&&(r.innerText||'').includes(${JSON.stringify(planId)}))`, { timeoutMs: 4500, floorMs: 300 }); // ★C1: 等计划行渲染
    const rc = await probePlan(cdp, ui, planId);
    return rc === 1;
  }
  const cur = await probeUrl(cdp);
  if (!URL_RE.detailPage.test(cur) || !cur.includes('adId=' + planId)) {
    await cdp.send('Page.navigate', { url: URLS.uniPromDetail(aavid, planId) });
    await sleep(9000);
  }
  return (await probePlan(cdp, ui, planId)) === 1;
}
// 7. open-view：jie3 点计划行「素材」开抽屉；jie6 点「素材」tab。完成后「添加视频」可见。
export async function openView(cdp, ui, planId) {
  if (ui === 'drawer') {
    const clk = await cdp.ev(`(function(){function vis(el){const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}const row=[...document.querySelectorAll('.ovui-tr,tr')].filter(r=>vis(r)&&(r.innerText||'').includes('${planId}'))[0];if(!row)return 'NO_ROW';let e=[...row.querySelectorAll('.oc-promotion-product-adinfo-material')].filter(vis)[0]||[...row.querySelectorAll('*')].filter(x=>vis(x)&&(x.innerText||'').trim()==='素材')[0];if(!e)return 'NO_SUCAI';e.scrollIntoView({block:'center'});['pointerdown','mousedown','pointerup','mouseup','click'].forEach(tp=>e.dispatchEvent(new (tp.indexOf('pointer')===0?PointerEvent:MouseEvent)(tp,{bubbles:true,cancelable:true,view:window})));if(e.click)e.click();return 'CLICKED';})()`);
    await waitFor(cdp, "__byText(/^添加视频$/).length>0", { timeoutMs: 6000, floorMs: 300 }); // ★C1: 等「添加视频」出现（冷渲染放宽到 6s）
    return clk === 'CLICKED';
  }
  await clickText(cdp, /^素材$/, 'button,span,a,div,[role=tab],.tab-label');
  await waitFor(cdp, "__byText(/^添加视频$/).length>0", { timeoutMs: 4000, floorMs: 300 }); // ★C1: 等「添加视频」出现
  return true;
}
// 8. close-popup：扫弹窗/遮罩（合成 click + 黑名单破坏性叉，见 cdp PAGE_HELPERS）。
export async function closePopup(cdp) { try { return await dismissModals(cdp); } catch (e) { return 0; } }

// ════════════════ ready：收敛调度器 ════════════════
// 按当前状态只跑缺的步。返回 {ready, account, plan, view, steps[]}。失败抛带 code 的错（E_DRIFT/E_LOGIN/...）。
// ★P5: 清理残留标签 —— 1862-home / blank / login / redirect 落地件 + 多余的同号标签（留一个工作标签）。
async function cleanupStrayTabs(port, keepAavid) {
  try {
    const tabs = await listTabs(port);
    if (tabs.length <= 1) return 0;
    const b = await connectBrowser(port); let closed = 0, kept = false;
    for (const t of tabs) {
      const u = (t.url || '').replace(/&amp;/g, '&');
      const isWork = u.includes('aavid=' + keepAavid);
      if (isWork && !kept) { kept = true; continue; } // 留一个工作标签
      if (isWork || u === 'about:blank' || u === 'chrome://newtab/' || /\/home\?|\/login|site\/index|passport|redirect\/ad/.test(u)) {
        try { await b.send('Target.closeTarget', { targetId: t.id }); closed++; } catch (e) {}
      }
    }
    b.close(); return closed;
  } catch (e) { return -1; }
}
// 握手种会话（用驱动标签 nav redirect/ad）。retry 时单独重握手用。
async function handshakeViaDriver(port, advId) {
  let driver = (await listTabs(port))[0];
  if (!driver) { const b = await connectBrowser(port); await b.send('Target.createTarget', { url: 'about:blank' }); b.close(); await sleep(2500); driver = (await listTabs(port))[0]; }
  const dcdp = await connect({ port, urlSub: driver && driver.url ? '' : 'uni-prom' });
  try { await dcdp.send('Page.enable'); await ssoHandshake(dcdp, advId); } finally { dcdp.close(); }
}

export async function ready(cfg, { secrets, log, attempts = 3 } = {}) {
  const { system, target } = cfg;
  const profile = cfg.profile;
  const { port, aavid, ui, planId, account, advId } = target;
  const steps = [];
  const L = log || { step() {}, ok() {}, warn() {} };

  // [探针] chrome-port → [动作] launch（一次）
  if (!await probeChromePort(port)) {
    L.step(`Chrome :${port} 未起 → launch`);
    if (!await launchChrome(system, profile, port)) throw Object.assign(new Error(`Chrome :${port} 起不来`), { code: 'E_CONFIG' });
    steps.push('launch');
  }

  // 热路径：aavid 标签已就绪 → 空转返回
  let tab = await probeTab(port, aavid);
  if (tab) {
    let cdp;
    try {
      cdp = await connect({ port, aavid });
      await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Page.bringToFront'); await sleep(400);
      await hardenViewport(cdp, system.chrome.viewport); // ★视口硬化：lockPlan 等按坐标点击，钉死视口防点屏外（详见 cdp.mjs）
      await closePopup(cdp);
      const s = await probeSnapshot(cdp, { planId, ui }); // ★S8: 一次拿 url/view/plan
      const tabOk = (s.url || '').includes('aavid=' + aavid);
      if (tabOk && s.view) {
        L.ok(`已就绪（aavid=${aavid} / 计划${planId}），空转`);
        return { ready: true, skipped: true, account, steps };
      }
      // ★C5: 标签/计划在位、仅视图(抽屉)关 → 只 open-view，不全冷重握手
      if (tabOk && s.plan === 1 && !s.view) {
        L.step('标签/计划在位、仅视图关 → 只 open-view');
        await openView(cdp, ui, planId); await closePopup(cdp);
        if (await probeView(cdp)) {
          steps.push('open-view-only');
          L.ok(`已就绪（aavid=${aavid} / 计划${planId}），仅开视图`);
          return { ready: true, skipped: true, account, steps };
        }
      }
    } catch (e) { /* 热路径失败就走冷路径 */ } finally { if (cdp) cdp.close(); }
  }

  // 母账号登录核验（一次；retry 不重做）
  {
    let driver = (await listTabs(port))[0];
    if (!driver) { const b = await connectBrowser(port); await b.send('Target.createTarget', { url: 'about:blank' }); b.close(); await sleep(3000); driver = (await listTabs(port))[0]; }
    const dcdp = await connect({ port, urlSub: driver && driver.url ? '' : 'uni-prom' });
    try {
      await dcdp.send('Runtime.enable'); await dcdp.send('Page.enable');
      await dcdp.send('Page.navigate', { url: URLS.agentHome });
      await waitFor(dcdp, "document.readyState==='complete'", { timeoutMs: 6000, floorMs: 1500 }); // ★C1
      const ls = await probeLoginStatus(dcdp);
      if (ls.hasPwd || ls.looksLogin) {
        L.step('母账号未登录 → login');
        if (!secrets) throw Object.assign(new Error('需登录但无凭据：设 QC_MOTHER_EMAIL/PWD 或 secrets.json'), { code: 'E_LOGIN' });
        await login(dcdp, secrets.email, secrets.pwd); steps.push('login');
      }
    } finally { dcdp.close(); }
  }

  // ★P2: 收敛重试 N 次（每次 重握手→ensureTab→在 aavid 标签收敛）。偶发干扰能救回；持续干扰最终抛 E_DRIFT(fail-safe)。
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      L.step(`握手+收敛（${attempt}/${attempts}）`);
      await handshakeViaDriver(port, advId);
      tab = await ensureTab(port, aavid);
      if (!tab) throw Object.assign(new Error(`建/找 aavid=${aavid} 标签失败`), { code: 'E_DRIFT' });
      const cdp = await connect({ port, aavid });
      try {
        await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Page.bringToFront'); await sleep(500);
        await hardenViewport(cdp, system.chrome.viewport); // ★视口硬化：冷收敛路径，lockPlan(clickAt) 前钉死视口（详见 cdp.mjs）
        await closePopup(cdp);
        const cur = await probeUrl(cdp);
        if (ui === 'drawer' && (!URL_RE.uniPromPath.test(cur) || !cur.includes('aavid=' + aavid))) {
          await cdp.send('Page.navigate', { url: URLS.uniProm(aavid) });
          await waitFor(cdp, "document.readyState==='complete'", { timeoutMs: 8000, floorMs: 1500 }); // ★C1
        }
        if (!await probeSessionWarm(cdp)) throw Object.assign(new Error('会话冷/被弹回 login'), { code: 'E_SIG' });
        L.ok(`aavid=${aavid} ✓`);
        await setMode(cdp, target.mode, ui);
        if (!await lockPlan(cdp, ui, aavid, planId)) throw Object.assign(new Error(`锁计划 ${planId} 失败（模式错/计划不唯一）`), { code: 'E_SELECTOR' });
        // ★冷启动抖动：openView 偶发未现「添加视频」（抽屉冷渲染慢/点击未落）→ 重试至多 3 次，不重握手。
        let viewOk = await probeView(cdp);
        for (let v = 1; v <= 3 && !viewOk; v++) {
          if (v > 1) L.step(`视图未现 → openView 重试（${v}/3）`);
          await openView(cdp, ui, planId); await closePopup(cdp);
          viewOk = await probeView(cdp);
        }
        if (!viewOk) throw Object.assign(new Error('开视图后「添加视频」仍不可见（openView 重试 3 次）'), { code: 'E_SELECTOR' });
      } finally { cdp.close(); }
      const cleaned = await cleanupStrayTabs(port, aavid); // ★P5
      steps.push(`converge#${attempt}`, `cleanup:${cleaned}`);
      L.ok(`就绪（aavid=${aavid} / 计划${planId} / 视图开）`);
      return { ready: true, skipped: false, account, attempt, steps };
    } catch (e) {
      lastErr = e;
      const transient = e.code === 'E_DRIFT' || e.code === 'E_SIG' || /timeout|ws closed/i.test(e.message || '');
      if (transient && attempt < attempts) { L.warn(`收敛失败(${e.code || e.message})，重试`); await sleep(2000); continue; }
      throw e;
    }
  }
  throw lastErr;
}
