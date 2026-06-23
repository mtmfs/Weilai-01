// lib/session.mjs —— 横切层·上下文就绪（可自启动）。
// 7 探针（只读判"我在哪一步"） + 8 动作（先探针、已达成即跳过） + ready 收敛调度器（6 种起始态）。
// 重构自 I:\cdp-helper\ 的 enter-1868 / enter-jie6-panel / login / qc-setup / nav-check / open-sucai / doctor。
import { spawn } from 'node:child_process';
import { connect, connectBrowser, clickText, dismissModals } from './cdp.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// ★从 outerHTML 取账户名（不用 innerText）：账户名常在折叠的账户切换器里=隐藏元素，innerText 取不到、outerHTML 能取。
const ACC_RE = `(document.documentElement.outerHTML.match(/聚量TS-(捷沅.)/)||[])[1]||'?'`;

// ════════════════ 7 探针（只读） ════════════════
export async function probeChromePort(port) {
  try { await fetch(`http://127.0.0.1:${port}/json/version`); return true; } catch (e) { return false; }
}
export async function listTabs(port) {
  return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(t => t.type === 'page');
}
export async function probeTab(port, aavid) {
  const tabs = await listTabs(port);
  return tabs.find(t => (t.url || '').replace(/&amp;/g, '&').includes('aavid=' + aavid)) || null;
}
export async function probeAccount(cdp) { return cdp.ev(ACC_RE); }
// 等账户文本加载出来（新建标签的页面可能还在加载，body 文本未就绪 → 先返回 '?'）。
export async function waitAccount(cdp, timeoutMs = 15000) {
  const t0 = Date.now();
  let acc = '?';
  while (Date.now() - t0 < timeoutMs) {
    acc = await probeAccount(cdp);
    if (acc && acc !== '?') return acc;
    await sleep(1500);
  }
  return acc;
}
export async function probeUrl(cdp) { return cdp.ev('location.href'); }
export async function probeLoginStatus(cdp) {
  const s = await cdp.j(`return JSON.stringify({url:location.href,hasPwd:!!document.querySelector('input[type=password]'),looksLogin:/\\/login|passport|account\\/login/.test(location.href)});`);
  return JSON.parse(s);
}
// session-cookie 新鲜度：能直连 uni-prom 且不被弹回 login，即视为热。（_x_ac_ts 在 HttpOnly cookie，JS 读不到，用行为判据。）
export async function probeSessionWarm(cdp) {
  const u = await probeUrl(cdp);
  return !/\/login|from_qc_login=1|passport/.test(u || '');
}
export async function probePlan(cdp, ui, planId) {
  if (ui === 'drawer') {
    return cdp.j(`return [...document.querySelectorAll('.ovui-tr,tr')].filter(r=>__vis(r)&&(r.innerText||'').includes(${JSON.stringify(planId)})).length;`);
  }
  return cdp.ev(`(location.href.includes('adId=${planId}') && document.documentElement.outerHTML.includes('${planId}'))?1:0`);
}
// 统一就绪信号：「添加视频」按钮可见（jie3 抽屉内 / jie6 素材tab内 都有）。
export async function probeView(cdp) {
  return cdp.j(`return __byText(/^添加视频$/).length>0;`);
}

// ════════════════ 8 动作（幂等） ════════════════
// 1. launch-chrome：起调试 Chrome（已在则跳过），等端口监听。
export async function launchChrome(system, profile, port) {
  if (await probeChromePort(port)) return true;
  const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, ...(system.chrome.flags || [])];
  spawn(system.chrome.path, args, { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 30; i++) { await sleep(1000); if (await probeChromePort(port)) return true; }
  return false;
}
// 2. login：母账号密码登录（协议框 + 合成提交）。重构自 login.mjs。
export async function login(cdp, email, pwd) {
  let u = await probeUrl(cdp);
  if (!/business\.oceanengine\.com\/login/.test(u)) {
    await cdp.send('Page.navigate', { url: 'https://business.oceanengine.com/login' }); await sleep(8000);
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
  await cdp.send('Page.navigate', { url: `https://agent.oceanengine.com/agent/redirect/ad?advId=${advId}` });
  await sleep(9000);
  return true;
}
// 4. ensure-tab：锁定 aavid 标签；无则浏览器级 Target.createTarget 新建并等出现（带重试，修旧 10s 硬等无重试）。
export async function ensureTab(port, aavid) {
  let tab = await probeTab(port, aavid);
  if (tab) return tab;
  const b = await connectBrowser(port);
  await b.send('Target.createTarget', { url: `https://qianchuan.jinritemai.com/uni-prom?aavid=${aavid}` });
  b.close();
  for (let i = 0; i < 8; i++) { await sleep(2000); tab = await probeTab(port, aavid); if (tab) return tab; }
  return null;
}
// 5. set-mode：jie3 推商品（点 tab）；jie6 推直播间靠 detail URL 锁，无需点。
export async function setMode(cdp, mode, ui) {
  if (ui !== 'drawer') return true; // jie6 走 detail URL
  await clickText(cdp, /^推商品$/, '.tab-label,span,div,a,[role=tab]'); await sleep(5000);
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
    await sleep(4500);
    const rc = await probePlan(cdp, ui, planId);
    return rc === 1;
  }
  const cur = await probeUrl(cdp);
  if (!/uni-prom\/detail/.test(cur) || !cur.includes('adId=' + planId)) {
    await cdp.send('Page.navigate', { url: `https://qianchuan.jinritemai.com/uni-prom/detail?aavid=${aavid}&adId=${planId}` });
    await sleep(9000);
  }
  return (await probePlan(cdp, ui, planId)) === 1;
}
// 7. open-view：jie3 点计划行「素材」开抽屉；jie6 点「素材」tab。完成后「添加视频」可见。
export async function openView(cdp, ui, planId) {
  if (ui === 'drawer') {
    const clk = await cdp.ev(`(function(){function vis(el){const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}const row=[...document.querySelectorAll('.ovui-tr,tr')].filter(r=>vis(r)&&(r.innerText||'').includes('${planId}'))[0];if(!row)return 'NO_ROW';let e=[...row.querySelectorAll('.oc-promotion-product-adinfo-material')].filter(vis)[0]||[...row.querySelectorAll('*')].filter(x=>vis(x)&&(x.innerText||'').trim()==='素材')[0];if(!e)return 'NO_SUCAI';e.scrollIntoView({block:'center'});['pointerdown','mousedown','pointerup','mouseup','click'].forEach(tp=>e.dispatchEvent(new (tp.indexOf('pointer')===0?PointerEvent:MouseEvent)(tp,{bubbles:true,cancelable:true,view:window})));if(e.click)e.click();return 'CLICKED';})()`);
    await sleep(4000);
    return clk === 'CLICKED';
  }
  await clickText(cdp, /^素材$/, 'button,span,a,div,[role=tab],.tab-label'); await sleep(4000);
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
      await closePopup(cdp);
      const acc = await probeAccount(cdp);
      const u = await probeUrl(cdp);
      if (acc === account && (u || '').includes('aavid=' + aavid) && await probeView(cdp)) {
        L.ok(`已就绪（${account} / 计划${planId}），空转`);
        return { ready: true, skipped: true, account: acc, steps };
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
      await dcdp.send('Page.navigate', { url: 'https://agent.oceanengine.com' }); await sleep(6000);
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
        await closePopup(cdp);
        const cur = await probeUrl(cdp);
        if (ui === 'drawer' && (!/uni-prom/.test(cur) || !cur.includes('aavid=' + aavid))) {
          await cdp.send('Page.navigate', { url: `https://qianchuan.jinritemai.com/uni-prom?aavid=${aavid}` }); await sleep(8000);
        }
        if (!await probeSessionWarm(cdp)) throw Object.assign(new Error('会话冷/被弹回 login'), { code: 'E_SIG' });
        let acc = await waitAccount(cdp, 18000); // 冷加载慢→给足预算（命中即早返回，只在真失败时才等满；P6 误判已回退）
        if (acc === '?') {
          const reUrl = ui === 'drawer'
            ? `https://qianchuan.jinritemai.com/uni-prom?aavid=${aavid}`
            : `https://qianchuan.jinritemai.com/uni-prom/detail?aavid=${aavid}&adId=${planId}`;
          L.step('账户未就绪 → 重锚再等');
          await cdp.send('Page.navigate', { url: reUrl }); await sleep(8000); await closePopup(cdp);
          acc = await waitAccount(cdp, 12000);
        }
        if (acc !== account) throw Object.assign(new Error(`账户=${acc} ≠ ${account}（防误操作有钱账户）`), { code: 'E_DRIFT' });
        L.ok(`账户=${account} ✓`);
        await setMode(cdp, target.mode, ui);
        if (!await lockPlan(cdp, ui, aavid, planId)) throw Object.assign(new Error(`锁计划 ${planId} 失败（模式错/计划不唯一）`), { code: 'E_SELECTOR' });
        if (!await probeView(cdp)) await openView(cdp, ui, planId);
        await closePopup(cdp);
        if (!await probeView(cdp)) throw Object.assign(new Error('开视图后「添加视频」仍不可见'), { code: 'E_SELECTOR' });
      } finally { cdp.close(); }
      const cleaned = await cleanupStrayTabs(port, aavid); // ★P5
      steps.push(`converge#${attempt}`, `cleanup:${cleaned}`);
      L.ok(`就绪（${account} / 计划${planId} / 视图开）`);
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
