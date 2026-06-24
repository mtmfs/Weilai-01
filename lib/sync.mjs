// lib/sync.mjs —— 拉平台审核现实归一进台账（合并 flat-sync + flatsync-jie6，参数化通道）。
// reload 捕签名 list-required/optional → Offset 翻页替放拉全量 → LegoMid 批30 拉审核 →
// norm 文件名匹配本地 KW 件（代表副本择优）→ observe → recomputeAll → 落盘 → 渲 index.md/worklist。
// ⚠️ 未在 live 验证（C 盘满阻塞）；逻辑是 flat-sync 的忠实移植 + 翻页，待清盘后实测。
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { connect, norm } from './cdp.mjs';
import { loadState, saveState, ensureVideo, observe, recomputeAll, worklists, summarize } from './state.mjs';
import { loadChannels } from './config.mjs';
import { guardEnter } from './guard.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function localFlat(root, kw) {
  return readdirSync(root).filter(n => /\.(mp4|mov|m4v|avi)$/i.test(n) && statSync(join(root, n)).isFile() && n.includes(kw));
}

// reload 捕获平台自发的已签名 list-required/optional（要求素材视图已开，由 ready 保证）。
export async function captureListSigs(cdp, { waitMs = 14000, settleMs = 1500 } = {}) {
  await cdp.send('Network.enable');
  await cdp.send('Page.enable');
  // ★C3: 不再 reload 后死等 14s。捕到 required+optional 两条签名后留一个短收尾窗口(期间有更新就覆盖，保留原"取最新"语义)即返回；
  // 到 waitMs 仍未集齐才按现状判 E_SIG。最坏 = 旧行为，常态从 ~14s 降到 ~3–5s。
  return new Promise((resolve, reject) => {
    let rq = null, op = null, done = false, settle = null;
    const finish = () => {
      if (done) return; done = true; clearTimeout(settle); clearTimeout(hard); off();
      if (!rq || !op) reject(Object.assign(new Error(`reload 未捕获 list 签名 (required=${!!rq} optional=${!!op}) —— 素材视图可能没开/平台改版`), { code: 'E_SIG' }));
      else resolve({ rq, op });
    };
    const off = cdp.onEvent(m => {
      if (m.method !== 'Network.requestWillBeSent') return;
      const u = m.params.request.url;
      if (!/uni-promotion\/material\/list/.test(u)) return;
      const r = { url: u, postData: m.params.request.postData || null };
      if (u.includes('list-required')) rq = r;
      if (u.includes('list-optional')) op = r;
      if (rq && op) { clearTimeout(settle); settle = setTimeout(finish, settleMs); }
    });
    const hard = setTimeout(finish, waitMs);
    cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});
  });
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
    /* ★C2: 审核批限流并发(4)拉取，取代逐批串行；结果合进同一 map，与串行等价 */
    const _batches=[]; for(let i=0;i<all.length;i+=30) _batches.push(all.slice(i,i+30).map(v=>v.id));
    let _bi=0; const _CONC=4;
    async function _auditWorker(){ while(_bi<_batches.length){ const ids=_batches[_bi++]; const ob=JSON.parse(JSON.stringify(ob0)); ob.LegoMidList=ids;
      const r2=await fetch(OPT_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(ob),credentials:'include'});
      const j2=await r2.json(); const mim=((j2.data||{}).materialInfoMap)||{};
      Object.keys(mim).forEach(k=>audit[k]={s:mim[k].materialAuditStatus,d:mim[k].isDel}); } }
    await Promise.all(Array.from({length:Math.min(_CONC,_batches.length)},()=>_auditWorker()));
    return JSON.stringify(all.map(v=>({name:v.name,id:v.id,audit:(audit[v.id]||{}).s,isDel:(audit[v.id]||{}).d})));
  })()`;
  const raw = await cdp.ev(expr);
  if (!raw) throw Object.assign(new Error('pullRows 替放无返回（签名失效/筛选绑定？）'), { code: 'E_SIG' });
  return JSON.parse(raw);
}

// ★S1: 按给定 mids 批量查 list-optional 审核（无 list-required 翻页、无名字匹配）。
// 抽自 pullRows 的审核并发块（30/批·4 并发），只查传入的 mids。返回 [{id,audit,isDel}]（无需 name）。
export async function pullRowsByMid(cdp, op, mids, { concurrency = 4 } = {}) {
  const expr = `(async function(){
    const OPT_URL=${JSON.stringify(op.url)}, OPT_BODY=${JSON.stringify(op.postData || '{}')};
    const MIDS=${JSON.stringify(mids)}; const ob0=JSON.parse(OPT_BODY);
    const audit={};
    const _batches=[]; for(let i=0;i<MIDS.length;i+=30) _batches.push(MIDS.slice(i,i+30));
    let _bi=0; const _CONC=${concurrency};
    async function _w(){ while(_bi<_batches.length){ const ids=_batches[_bi++]; const ob=JSON.parse(JSON.stringify(ob0)); ob.LegoMidList=ids;
      const r=await fetch(OPT_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(ob),credentials:'include'});
      const j=await r.json(); const mim=((j.data||{}).materialInfoMap)||{};
      Object.keys(mim).forEach(k=>audit[k]={s:mim[k].materialAuditStatus,d:mim[k].isDel}); } }
    await Promise.all(Array.from({length:Math.min(_CONC,_batches.length)},()=>_w()));
    return JSON.stringify(MIDS.map(id=>({id,audit:(audit[id]||{}).s,isDel:(audit[id]||{}).d})));
  })()`;
  const raw = await cdp.ev(expr);
  if (raw == null) throw Object.assign(new Error('pullRowsByMid 替放无返回（op 签名失效？）'), { code: 'E_SIG' });
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
    // ★A3: 入口护栏（断言账户/计划/会话 + 自愈一次），绝不从错账户/漂移态拉进台账
    await guardEnter(cdp, cfg, { log: L });
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

// ★S1: mid 增量同步——只查台账在飞件的 last_mid，O(在飞)、无翻页、无 norm 名字匹配。
// opt-in（默认仍走全量 runSync 作 reconcile，发现新批次/漂移）；observe-by-mid：mid→videoKey 反查。
// 不渲染 index.md/worklist（增量是高频轮询用，渲染留全量 sync 负责）。
export async function runSyncIncremental(cfg, { mutate = true, log } = {}) {
  const L = log || { step() {}, ok() {}, info() {} };
  const { system, target } = cfg;
  const channel = target.id;
  const { ledgerPath } = system.project;

  // 载入 + 用 config 覆盖 channels（唯一真源）
  const state = loadState(ledgerPath);
  const chs = loadChannels(); state.channels = chs.channels; state.pipeline = chs.pipeline;

  // 收集本通道在飞 mid：有 last_mid 且未 passed 未 scrapped（终态已单调钉死，不必再查）。
  const midToKey = new Map();
  for (const [k, v] of Object.entries(state.videos)) {
    const c = v.ch[channel]; if (!c || c.passed || c.scrapped || !c.last_mid) continue;
    midToKey.set(String(c.last_mid), k);
  }
  const mids = [...midToKey.keys()];
  if (!mids.length) {
    const sum0 = summarize(state);
    L.ok(`增量 sync ${channel}: 无在飞 mid（全部终态或无 last_mid）→ 跳过（建议跑全量 sync 兜底）`);
    return { mode: 'incremental', channel, queried: 0, observed: 0, stages: sum0.stages, worklist: { test_reupload: [], test_toupload: [], deliv_toupload: [] } };
  }

  // 连标签 → 入口护栏（断言账户/计划/会话，防错账户查询）→ 只取 op 签名 → 按 mid 查审核
  const cdp = await connect({ port: target.port, aavid: target.aavid });
  let rows;
  try {
    await cdp.send('Runtime.enable');
    await guardEnter(cdp, cfg, { log: L });
    L.step(`增量：reload 捕 op 签名 + 按 ${mids.length} 个在飞 mid 查审核`);
    const { op } = await captureListSigs(cdp);
    rows = await pullRowsByMid(cdp, op, mids);
  } finally { cdp.close(); }

  // observe-by-mid：isDel 跳过（已删副本审核值无意义、保留旧值）；否则 mid→key 反查 observe（跳过 norm 匹配）。
  const now = Date.now();
  let observed = 0;
  for (const r of rows) {
    if (r.isDel === true) continue;
    const key = midToKey.get(String(r.id)); if (!key) continue;
    observe(state.videos[key], channel, { audit: r.audit, mid: r.id, ts: now });
    observed++;
  }
  recomputeAll(state);
  if (mutate) saveState(ledgerPath, state);

  const w = worklists(state);
  const sum = summarize(state);
  L.ok(`增量 sync ${channel}: 查 ${mids.length} 个在飞 mid → observe ${observed} | ${Object.entries(sum.stages).map(([s, n]) => `${s}=${n}`).join(' ')}`);
  return { mode: 'incremental', channel, queried: mids.length, observed, stages: sum.stages, worklist: { test_reupload: w.test_reupload, test_toupload: w.test_toupload, deliv_toupload: w.deliv_toupload } };
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
