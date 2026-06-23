// lib/delete.mjs —— 删过审+被拒副本腾槽（合并 run-delete + delete-jie6-replay）。
// jie3(drawer)：reopenDrawer → 1 次 UI 删抓 set-opt 签名 → 批量重放(UseLegoMid)。jie6 待补(预抓签名重放)。
// ★默认 dry-run；--apply 才真删。★未 live 验证(destructive + C盘满阻塞)——逻辑是 run-delete 忠实移植，清盘后先 dry-run 核对再 apply。
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { connect, norm } from './cdp.mjs';
import { captureListSigs, pullRows } from './sync.mjs';
import { loadState, saveState, ensureVideo, recomputeAll } from './state.mjs';
import { loadChannels } from './config.mjs';
import { probeAccount } from './session.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 坐标 clickAt 本页不可靠 → 删除/确认一律合成 click（坑#6）
const SC = sel => `['pointerdown','mousedown','pointerup','mouseup','click'].forEach(tp=>{try{${sel}.dispatchEvent(new (tp.indexOf('pointer')===0?PointerEvent:MouseEvent)(tp,{bubbles:true,cancelable:true,view:window}));}catch(x){}});if(${sel}.click)${sel}.click();`;

function localSet(root, kw) {
  return new Set(readdirSync(root).filter(n => /\.(mp4|mov|m4v|avi)$/i.test(n) && statSync(join(root, n)).isFile() && n.includes(kw)).map(norm));
}

function computeTargets(platform, localKeys, state, channel, kw) {
  const live = new Map();
  for (const p of platform) { if (p.isDel === true) continue; const k = norm(p.name || ''); if (k && !live.has(k)) live.set(k, p); }
  const targets = [];
  for (const [k, p] of live) {
    if (!localKeys.has(k) || !(p.name || '').includes(kw)) continue;
    const v = state.videos[k]; const C = v ? v.ch[channel] : null;
    if (p.audit === 1) targets.push({ name: p.name, legoMid: p.id, audit: 1 });
    else if (p.audit === 2) { if (C && (C.passed || C.scrapped)) continue; targets.push({ name: p.name, legoMid: p.id, audit: 2 }); }
  }
  return targets;
}

async function closeOverlays(cdp) {
  await cdp.ev(`(function(){function vis(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';}
    function synth(el){['pointerdown','mousedown','pointerup','mouseup','click'].forEach(tp=>{try{el.dispatchEvent(new (tp.indexOf('pointer')===0?PointerEvent:MouseEvent)(tp,{bubbles:true,cancelable:true,view:window}));}catch(x){}});try{if(el.click)el.click();}catch(x){}}
    const BLACK=/oc-promotion-product-adinfo-close-icon/;
    for(const e of document.querySelectorAll('[class*=tools-vmok-plugin-modal__close-icon],[class*=vmok-plugin-popup__close-icon],[class*=vmok-plugin-modal__close],[class*=vmok-plugin-popup__close]')){if(vis(e)&&!BLACK.test(typeof e.className==='string'?e.className:''))synth(e);}
    for(const e of document.querySelectorAll('button,span,a,div')){const t=(e.innerText||'').trim();if(vis(e)&&/^(我知道了|知道了|跳过|以后再说|不再提示)$/.test(t))synth(e);}
    return 1;})()`);
  await sleep(700);
}

// jie3：重开素材抽屉并搜出目标行（坑#13：reload 关了抽屉，uiDeleteCapture 否则抓不到）。
async function reopenDrawerJie3(cdp, planId, kw) {
  await cdp.send('Page.bringToFront'); await sleep(1200);
  await closeOverlays(cdp);
  const sb = await cdp.ev(`(function(){function vis(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}
    const i=[...document.querySelectorAll('input')].filter(x=>/计划名称\\/ID/.test(x.getAttribute('placeholder')||'')&&vis(x))[0];if(!i)return 'NOBOX';
    const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));
    const r=i.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
  if (sb !== 'NOBOX') {
    const c = JSON.parse(sb);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await sleep(200); await cdp.send('Input.insertText', { text: planId });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
    await sleep(4500);
  }
  await cdp.ev(`(function(){function vis(el){if(!el)return false;const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}
    const row=[...document.querySelectorAll('.ovui-tr,tr')].filter(r=>vis(r)&&(r.innerText||'').includes('${planId}'))[0];if(!row)return 'NOROW';
    let e=[...row.querySelectorAll('.oc-promotion-product-adinfo-material')].filter(vis)[0]||[...row.querySelectorAll('*')].filter(x=>vis(x)&&(x.innerText||'').trim()==='素材')[0];
    if(!e)return 'NOSUCAI';e.scrollIntoView({block:'center'});${SC('e')}return 'OK';})()`);
  await sleep(3800); await closeOverlays(cdp);
  // 搜 KW 渲染目标行
  const box = await cdp.ev(`(function(){function vis(el){const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}
    const i=[...document.querySelectorAll('input')].filter(x=>/视频名称\\/ID/.test(x.getAttribute('placeholder')||'')).find(vis);if(!i)return null;
    const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(i,'');i.dispatchEvent(new Event('input',{bubbles:true}));
    const r=i.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
  if (box) {
    const c = JSON.parse(box);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: 1 });
    await sleep(200); await cdp.send('Input.insertText', { text: kw });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' });
    await sleep(6000);
  }
}

// 1 次 UI 删 → 捕获新鲜 set-opt 签名。
async function uiDeleteCapture(cdp, targetIds) {
  const reqs = new Map();
  const off = cdp.onEvent(m => { if (m.method === 'Network.requestWillBeSent' && /material\/set-opt/.test(m.params.request.url)) reqs.set(m.params.requestId, { url: m.params.request.url, postData: m.params.request.postData || null }); });
  await cdp.send('Network.enable');
  const dc = await cdp.ev(`(function(){function vis(el){const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}
    const ids=${JSON.stringify(targetIds)};
    for(const row of [...document.querySelectorAll('.ovui-tr,tr')].filter(vis)){const txt=row.innerText||'';const hit=ids.find(id=>txt.includes(id));if(!hit)continue;
      const del=[...row.querySelectorAll('*')].find(e=>vis(e)&&(e.innerText||'').trim()==='删除');if(!del)continue;
      del.scrollIntoView({block:'center'});${SC('del')}return JSON.stringify({id:hit});}
    return null;})()`);
  if (!dc) { off(); throw Object.assign(new Error('无可见目标行可删（列表未渲染目标行）'), { code: 'E_SELECTOR' }); }
  const c = JSON.parse(dc); await sleep(1400);
  await cdp.ev(`(function(){function vis(el){const r=el.getBoundingClientRect();return r.width>0&&getComputedStyle(el).display!=='none';}
    const sc=[...document.querySelectorAll('.ovui-modal__wrap,.ovui-popconfirm,[class*=popconfirm],[role=dialog],[class*=confirm]')].filter(vis).pop()||document;
    const b=[...sc.querySelectorAll('button')].filter(x=>vis(x)&&/^(确定|删除|确认|是)$/.test((x.innerText||'').trim()))[0];if(!b)return 'NOBTN';
    ${SC('b')}return 'CLICKED';})()`);
  await sleep(2800); off();
  let cap = null; for (const [, r] of reqs) if (r.url.includes('set-opt')) cap = r;
  return { sig: cap, deletedId: c.id };
}

export async function runDelete(cfg, { apply = false, log } = {}) {
  const L = log || { step() {}, ok() {}, info() {}, warn() {} };
  const { system, target } = cfg;
  const channel = target.id;
  const { kw, flatRoot, ledgerPath } = system.project;
  if (target.ui !== 'drawer') throw Object.assign(new Error('jie6(creative-tab) delete 待实现（用预抓 set-opt 签名重放，见 sweep）'), { code: 'E_CONFIG' });

  const cdp = await connect({ port: target.port, aavid: target.aavid });
  try {
    await cdp.send('Runtime.enable');
    const acc = await probeAccount(cdp);
    if (acc !== target.account) throw Object.assign(new Error(`账户=${acc} ≠ ${target.account}，拒绝 delete`), { code: 'E_DRIFT' });
    const { rq, op } = await captureListSigs(cdp);
    const platform = await pullRows(cdp, rq, op);
    const state = loadState(ledgerPath); const chs = loadChannels(); state.channels = chs.channels; state.pipeline = chs.pipeline;
    const targets = computeTargets(platform, localSet(flatRoot, kw), state, channel, kw);
    const passedNames = targets.filter(t => t.audit === 1).map(t => t.name);
    L.info(`将删 ${targets.length}（过审 ${passedNames.length} / 被拒 ${targets.length - passedNames.length}）`);
    targets.forEach(t => L.info(`  ${t.audit === 1 ? '过审' : '被拒'}  ${t.name}  id=${t.legoMid}`));
    if (!apply) { L.warn('[dry-run] 未删。真删: 加 --apply'); return { dryRun: true, targets: targets.length, passed: passedNames.length, names: targets.map(t => t.name) }; }
    if (!targets.length) { L.ok('无目标'); return { deleted: 0 }; }

    await reopenDrawerJie3(cdp, target.planId, kw);
    const { sig, deletedId } = await uiDeleteCapture(cdp, targets.map(t => t.legoMid));
    if (!sig) throw Object.assign(new Error('抓 set-opt 签名失败（确认弹窗/目标行问题）'), { code: 'E_SELECTOR' });
    const adId = JSON.parse(sig.postData).params.AdID;
    const rest = targets.filter(t => t.legoMid !== deletedId);
    const body = { optType: 'delete', params: { AdID: adId, Vids: [], LegoMids: rest.map(t => t.legoMid), UseLegoMid: true } };
    const rep = await cdp.ev(`(async function(){try{const res=await fetch(${JSON.stringify(sig.url)},{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(body))},credentials:'include'});const t=await res.text();return JSON.stringify({status:res.status,body:t.slice(0,120)});}catch(e){return JSON.stringify({error:String(e)});}})()`);
    for (const nm of passedNames) ensureVideo(state, norm(nm), nm).ch[channel].passed = true; // 过审单调钉死
    recomputeAll(state); saveState(ledgerPath, state);
    L.ok(`UI删1(id=${deletedId}) + 重放删${rest.length}: ${rep} | 登记过审 ${passedNames.length}`);
    return { deleted: targets.length, replay: rep, passedRegistered: passedNames.length };
  } finally { cdp.close(); }
}
