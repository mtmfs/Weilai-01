// lib/sync.mjs —— 拉平台审核现实归一进台账（合并 flat-sync + flatsync-jie6，参数化通道）。
// reload 捕签名 list-required/optional → Offset 翻页替放拉全量 → LegoMid 批30 拉审核 →
// norm 文件名匹配本地 KW 件（代表副本择优）→ observe → recomputeAll → 落盘 → 渲 index.md/worklist。
// ⚠️ 未在 live 验证（C 盘满阻塞）；逻辑是 flat-sync 的忠实移植 + 翻页，待清盘后实测。
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, norm } from './cdp.mjs';
import { loadState, saveState, ensureVideo, observe, recomputeAll, worklists, summarize } from './state.mjs';
import { loadChannels } from './config.mjs';
import { probeAccount } from './session.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function localFlat(root, kw) {
  return readdirSync(root).filter(n => /\.(mp4|mov|m4v|avi)$/i.test(n) && statSync(join(root, n)).isFile() && n.includes(kw));
}

// reload 捕获平台自发的已签名 list-required/optional（要求素材视图已开，由 ready 保证）。
export async function captureListSigs(cdp, { waitMs = 14000 } = {}) {
  const reqs = new Map();
  const off = cdp.onEvent(m => {
    if (m.method === 'Network.requestWillBeSent') {
      const u = m.params.request.url;
      if (/uni-promotion\/material\/list/.test(u)) reqs.set(m.params.requestId, { url: u, postData: m.params.request.postData || null });
    }
  });
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.reload', { ignoreCache: false });
  await sleep(waitMs);
  off();
  let rq = null, op = null;
  for (const [, r] of reqs) { if (r.url.includes('list-required')) rq = r; if (r.url.includes('list-optional')) op = r; }
  if (!rq || !op) throw Object.assign(new Error(`reload 未捕获 list 签名 (required=${!!rq} optional=${!!op}) —— 素材视图可能没开/平台改版`), { code: 'E_SIG' });
  return { rq, op };
}

// 在页内：Offset 翻页替放 list-required 拉全量 + 批量 list-optional 拉审核。返回 [{name,id,audit,isDel}]。
export async function pullRows(cdp, rq, op, { maxPages = 13, limit = 500 } = {}) {
  const expr = `(async function(){
    const REQ_URL=${JSON.stringify(rq.url)}, REQ_BODY=${JSON.stringify(rq.postData || '{}')};
    const OPT_URL=${JSON.stringify(op.url)}, OPT_BODY=${JSON.stringify(op.postData || '{}')};
    let all=[], offset=0; const LIMIT=${limit};
    for(let p=0;p<${maxPages};p++){
      const rb=JSON.parse(REQ_BODY); rb.PageParams={Limit:LIMIT,Offset:offset};
      const r1=await fetch(REQ_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(rb),credentials:'include'});
      const j1=await r1.json(); const rows=(((j1.data||{}).statsData||{}).rows)||[];
      for(const row of rows){const d=row.dimensions||{};all.push({id:(d.materialId||{}).value,name:(d.roi2MaterialVideoName||{}).value});}
      if(rows.length<LIMIT)break; offset+=LIMIT;
    }
    const audit={}; const ob0=JSON.parse(OPT_BODY);
    for(let i=0;i<all.length;i+=30){
      const ids=all.slice(i,i+30).map(v=>v.id); const ob=JSON.parse(JSON.stringify(ob0)); ob.LegoMidList=ids;
      const r2=await fetch(OPT_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(ob),credentials:'include'});
      const j2=await r2.json(); const mim=((j2.data||{}).materialInfoMap)||{};
      Object.keys(mim).forEach(k=>audit[k]={s:mim[k].materialAuditStatus,d:mim[k].isDel});
    }
    return JSON.stringify(all.map(v=>({name:v.name,id:v.id,audit:(audit[v.id]||{}).s,isDel:(audit[v.id]||{}).d})));
  })()`;
  const raw = await cdp.ev(expr);
  if (!raw) throw Object.assign(new Error('pullRows 替放无返回（签名失效/筛选绑定？）'), { code: 'E_SIG' });
  return JSON.parse(raw);
}

// 主：拉取 + 归一 + 落盘 + 渲染。cfg=loadConfig(target)；channel=cfg.target.id。
export async function runSync(cfg, { mutate = true, log } = {}) {
  const L = log || { step() {}, ok() {}, info() {} };
  const { system, target } = cfg;
  const channel = target.id;
  const { kw, flatRoot, ledgerPath } = system.project;

  const cdp = await connect({ port: target.port, aavid: target.aavid });
  let platform;
  try {
    await cdp.send('Runtime.enable');
    // 护栏：拉之前断言账户对，绝不从错账户拉进台账
    const acc = await probeAccount(cdp);
    if (acc !== target.account) throw Object.assign(new Error(`账户=${acc} ≠ ${target.account}，拒绝 sync（防污染台账）`), { code: 'E_DRIFT' });
    L.step('reload 捕签名 + 翻页拉审核');
    const { rq, op } = await captureListSigs(cdp);
    platform = await pullRows(cdp, rq, op);
  } finally { cdp.close(); }

  // 平台 live（去 isDel），按 norm 索引
  const live = new Map();
  for (const p of platform) { if (p.isDel === true) continue; const k = norm(p.name || ''); if (k && !live.has(k)) live.set(k, p); }

  // 台账：载入 + 用 config 覆盖 channels（唯一真源）+ 种本地 KW 件
  const state = loadState(ledgerPath);
  const chs = loadChannels(); state.channels = chs.channels; state.pipeline = chs.pipeline;
  const local = localFlat(flatRoot, kw);
  for (const n of local) ensureVideo(state, norm(n), n);

  // observe：每个本地文件名本轮只记一次（去重前平台有同名多份旧副本）
  const now = Date.now();
  const localKeys = new Set(local.map(norm));
  const byName = new Map();
  for (const p of platform) {
    if (p.isDel === true || !(p.name || '').includes(kw)) continue;
    const k = norm(p.name);
    if (!localKeys.has(k)) continue; // 只记本地批次的，别让平台旧件污染台账
    let g = byName.get(k); if (!g) { g = []; byName.set(k, g); } g.push(p);
  }
  for (const [k, arr] of byName) {
    const passed = arr.find(p => p.audit === 1);
    const rejected = arr.filter(p => p.audit === 2).sort((a, b) => String(b.id).localeCompare(String(a.id)))[0];
    const rep = passed || rejected || arr[0];
    observe(ensureVideo(state, k, rep.name), channel, { audit: rep.audit, mid: rep.id, ts: now });
  }
  recomputeAll(state);
  if (mutate) saveState(ledgerPath, state);

  const w = worklists(state);
  const sum = summarize(state);
  if (mutate) renderArtifacts(flatRoot, state, w, live, local, channel);

  L.ok(`sync ${channel}: 平台 live=${live.size} 本地=${local.length} | ${Object.entries(sum.stages).map(([s, n]) => `${s}=${n}`).join(' ')}`);
  return { channel, platformLive: live.size, local: local.length, stages: sum.stages, worklist: { test_reupload: w.test_reupload, test_toupload: w.test_toupload, deliv_toupload: w.deliv_toupload } };
}

function renderArtifacts(root, state, w, live, local, channel) {
  writeFileSync(join(root, '_toupload.txt'), w.test_toupload.join('\n') + (w.test_toupload.length ? '\n' : ''), 'utf8');
  writeFileSync(join(root, '_reupload.txt'), w.test_reupload.join('\n') + (w.test_reupload.length ? '\n' : ''), 'utf8');
  let md = `# 视频状态 LOG —— 机器真源=_video_state.json，本文件仅供人看\n\n`;
  md += `通道=${channel} ｜ 本地=${local.length} ｜ 平台live=${live.size} ｜ test待传=${w.test_toupload.length} ｜ test重传=${w.test_reupload.length} ｜ 封存=${w.sealed.length} ｜ 交付=${w.delivered.length} ｜ 作废=${w.scrapped.length}\n\n`;
  md += '| 文件名 | stage | jie3 | jie6 |\n|---|---|---|---|\n';
  const fmt = c => `up${c.uploads || 0}${c.passed ? '·过' : ''}${c.scrapped ? '·废' : ''}${c.last_status ? '·s' + c.last_status : ''}`;
  for (const v of Object.values(state.videos)) md += `| ${v.name} | ${v.stage} | ${fmt(v.ch.jie3 || {})} | ${fmt(v.ch.jie6 || {})} |\n`;
  writeFileSync(join(root, 'index.md'), md, 'utf8');
}
