// lib/sync.mjs —— 拉平台审核现实归一进台账（合并 flat-sync + flatsync-jie6，参数化通道）。
// reload 捕签名 list-required/optional → Offset 翻页替放拉全量 → LegoMid 批30 拉审核 →
// norm 文件名匹配本地 KW 件（代表副本择优）→ observe → recomputeAll → 落盘 → 渲 index.md/worklist。
// 已 live：台账 passed/scrapped/last_status 均由本模块写出（早期"未 live 验证·C盘满阻塞"注记已过时，删）。
import { readdirSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { connect, norm } from './cdp.mjs';
import { ensureVideo, observe, recomputeAll, worklists, summarize, syncChannels } from './state.mjs';
import { loadChannels } from './config.mjs';
import { createLedger } from './ledger.mjs';
import { guardEnter } from './guard.mjs';
import { resolveFromPlatform } from './telemetry.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ★S1b: op 签名缓存（sidecar 在台账旁，非 git 仓库内）。增量轮询时 age<BUDGET 直接复用、跳 reload；
// 失效时 pullRowsByMid 抛 E_SIG → 调用方回退现抓 + 回写。BUDGET 偏小只是少省 reload，正确性由回退兜底。
// BUDGET = probe-sig-ttl 实测 TTL × ~70%。实测（2026-06-24 jie3）：op 签名 age 0/2/5/10min 全有效（200·canary5/5），
// TTL≥10min（未测到失效点）；取 70%·已确认 10min 窗 = 7min，留 3min 余量，失效另有回退兜底。
const SIG_TTL_BUDGET_MS = 7 * 60 * 1000;
const sigPath = (ledgerPath, channel) => `${ledgerPath}.${channel}.sig.json`;
function readCachedSig(ledgerPath, channel) {
  try { const p = sigPath(ledgerPath, channel); if (!existsSync(p)) return null; const s = JSON.parse(readFileSync(p, 'utf8')); if (s && s.url && typeof s.capturedAt === 'number') return s; } catch (e) {}
  return null;
}
function writeCachedSig(ledgerPath, channel, op) {
  try { writeFileSync(sigPath(ledgerPath, channel), JSON.stringify({ url: op.url, postData: op.postData, capturedAt: Date.now() }), 'utf8'); } catch (e) {}
}

function localFlat(root, kw) {
  return readdirSync(root).filter(n => /\.(mp4|mov|m4v|avi)$/i.test(n) && statSync(join(root, n)).isFile() && n.includes(kw));
}

// reload 捕获平台自发的已签名 list-required/optional（要求素材视图已开，由 ready 保证）。
export async function captureListSigs(cdp, { waitMs, settleMs = 1500, ui } = {}) {
  const hardWaitMs = waitMs ?? (ui === 'creative-tab' ? 30000 : 14000);
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
    const hard = setTimeout(finish, hardWaitMs);
    cdp.send('Page.reload', { ignoreCache: false }).catch(() => {});
    // ★J2(jie6 读闭环)：creative-tab 的 material/list-required+optional 要点「素材」tab 才触发（reload 落到默认 tab）。
    //   reload 后分几次补点「素材」直到捕到签名；drawer(jie3) 不传 ui → 跳过、行为不变。今日报告"不触发"系漏此步。
    if (ui === 'creative-tab') {
      const clickSucai = () => { if (done) return; cdp.j(`const el=[...document.querySelectorAll('span,div,button,a,[role=tab]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(e.innerText||'').trim()==='素材';}).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0]; if(el){el.scrollIntoView({block:'center'});['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t=>el.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window})));if(el.click)el.click();return 1;}return 0;`).catch(() => {}); };
      for (const ms of [2500, 5000, 8000, 12000, 17000, 23000]) setTimeout(clickSucai, ms);
    }
  });
}

// ★J2: 往 list-required 的 Filters 注入素材名过滤（jie6 素材海量含他人件，不过滤会全量超时）。
//   字段 roi2_material_name_or_id（UI 搜索框用的 name_or_id 搜索，Operator 7 = 含 kw）。幂等：先去重再加。
export function injectNameFilter(rq, kw) {
  if (!rq || !rq.postData || !kw) return;
  try {
    const b = JSON.parse(rq.postData);
    if (b.Filters && Array.isArray(b.Filters.Conditions)) {
      b.Filters.Conditions = b.Filters.Conditions.filter(c => c.Field !== 'roi2_material_name_or_id');
      b.Filters.Conditions.push({ Field: 'roi2_material_name_or_id', Operator: 7, Values: [kw] });
      rq.postData = JSON.stringify(b);
    }
  } catch (e) {}
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
    /* ★J2-健壮性: 重试漏返回审核值的 mid（jie6 list-optional 偶发不全 → 单次扫描会漏判过审，实测首扫漏 14 件）。串行补一遍。 */
    const _miss=all.filter(v=>v.id!=null&&!(v.id in audit)).map(v=>v.id);
    for(let i=0;i<_miss.length;i+=30){ const ids=_miss.slice(i,i+30); const ob=JSON.parse(JSON.stringify(ob0)); ob.LegoMidList=ids;
      try{ const r=await fetch(OPT_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(ob),credentials:'include'}); const j=await r.json(); const mim=((j.data||{}).materialInfoMap)||{}; Object.keys(mim).forEach(k=>audit[k]={s:mim[k].materialAuditStatus,d:mim[k].isDel}); }catch(e){} }
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
    const audit={}; let _ok=0;
    const _batches=[]; for(let i=0;i<MIDS.length;i+=30) _batches.push(MIDS.slice(i,i+30));
    let _bi=0; const _CONC=${concurrency};
    async function _w(){ while(_bi<_batches.length){ const ids=_batches[_bi++]; const ob=JSON.parse(JSON.stringify(ob0)); ob.LegoMidList=ids;
      const r=await fetch(OPT_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(ob),credentials:'include'});
      let j={}; try{ j=await r.json(); }catch(e){}
      const mim=(j.data||{}).materialInfoMap;
      /* ★S1b 健康判据：必须是 list-optional 应有形状（data.materialInfoMap 为对象，含已删件 isDel=true 也算）。
         登录重定向/SPA HTML(json解析失败)/错误码 都没这个形状→判失效→回退现抓。空 {} 仍算健康(合法空结果)。 */
      if(r.status===200 && (j.code==null||j.code===0) && mim && typeof mim==='object') _ok++;
      if(mim) Object.keys(mim).forEach(k=>audit[k]={s:mim[k].materialAuditStatus,d:mim[k].isDel}); } }
    await Promise.all(Array.from({length:Math.min(_CONC,_batches.length)},()=>_w()));
    if(_batches.length>0 && _ok===0) return '__UNHEALTHY__'; /* ★S1b: 所有批都失败=签名失效→调用方回退现抓 */
    return JSON.stringify(MIDS.map(id=>({id,audit:(audit[id]||{}).s,isDel:(audit[id]||{}).d})));
  })()`;
  const raw = await cdp.ev(expr);
  if (raw == null) throw Object.assign(new Error('pullRowsByMid 替放无返回（op 签名失效？）'), { code: 'E_SIG' });
  if (raw === '__UNHEALTHY__') throw Object.assign(new Error('pullRowsByMid 所有批次响应异常（缓存签名失效？）'), { code: 'E_SIG' });
  return JSON.parse(raw);
}

// 主：拉取 + 归一 + 落盘 + 渲染。cfg=loadConfig(target)；channel=cfg.target.id。
export async function runSync(cfg, { mutate = true, log, ledger } = {}) {
  const L = log || { step() {}, ok() {}, info() {} };
  const { system, target } = cfg;
  const channel = target.id;
  const { kw, flatRoot, ledgerPath } = system.project;

  const cdp = await connect({ port: target.port, aavid: target.aavid });
  let platform;
  try {
    await cdp.send('Runtime.enable');
    // ★A3: 入口护栏（断言 aavid/计划/会话 + 自愈一次），绝不从错标签/漂移态拉进台账
    await guardEnter(cdp, cfg, { log: L });
    L.step('reload 捕签名 + 翻页拉审核');
    const { rq, op } = await captureListSigs(cdp, { ui: target.ui }); // ★J2: creative-tab 补点素材触发列表
    if (target.ui === 'creative-tab') injectNameFilter(rq, kw); // ★J2: jie6 素材海量(含他人)→注入 name 过滤只拉 kw 件，否则全量超时
    platform = await pullRows(cdp, rq, op);
  } finally { cdp.close(); }

  // 平台 live（去 isDel），按 norm 索引
  const live = new Map();
  for (const p of platform) { if (p.isDel === true) continue; const k = norm(p.name || ''); if (k && !live.has(k)) live.set(k, p); }

  // 台账：种本地 KW 件 + observe（去重后每名一次的代表副本）。先把"纯计算"部分算好（不碰台账），
  // 再把"种件 + observe"作为同步 delta 经 ledger 串行提交（提交时刻新鲜 load，根治并发丢失更新）。
  const local = localFlat(flatRoot, kw);
  const now = Date.now();
  const localKeys = new Set(local.map(norm));
  const byName = new Map();
  for (const p of platform) {
    if (p.isDel === true || !(p.name || '').includes(kw)) continue;
    const k = norm(p.name);
    if (!localKeys.has(k)) continue; // 只记本地批次的，别让平台旧件污染台账
    let g = byName.get(k); if (!g) { g = []; byName.set(k, g); } g.push(p);
  }
  const observations = [];
  for (const [k, arr] of byName) {
    const passed = arr.find(p => p.audit === 1 || p.audit === 4); // ★M5: 4=审核通过可优化，同等视为过审代表
    const rejected = arr.filter(p => p.audit === 2).sort((a, b) => String(b.id).localeCompare(String(a.id)))[0];
    const rep = passed || rejected || arr[0];
    observations.push({ key: k, name: rep.name, audit: rep.audit, mid: rep.id });
  }
  const applyObs = (state) => {
    for (const n of local) ensureVideo(state, norm(n), n);
    for (const o of observations) observe(ensureVideo(state, o.key, o.name), channel, { audit: o.audit, mid: o.mid, ts: now });
  };

  const led = ledger || createLedger(ledgerPath);
  let w, sum, snap;
  if (mutate) {
    w = await led.commit('sync:' + channel, applyObs);
    // ★pass-rate 基建：用本次已拉 platform 顺带结审 submissions.jsonl 的待结提交（零额外平台调用）。
    const nres = resolveFromPlatform(ledgerPath, platform, now); if (nres) L.info(`pass-rate: 结审 ${nres} 件`);
    snap = await led.read((s) => s);            // 提交后一致快照（渲染/汇总用）
    sum = summarize(snap);
    renderArtifacts(flatRoot, snap, w, live, local, channel);
  } else {
    const r = await led.read((s) => { const chs = loadChannels(); syncChannels(s, chs.channels, chs.pipeline); applyObs(s); recomputeAll(s); return { w: worklists(s), sum: summarize(s) }; });
    w = r.w; sum = r.sum;
  }

  L.ok(`sync ${channel}: 平台 live=${live.size} 本地=${local.length} | ${Object.entries(sum.stages).map(([s, n]) => `${s}=${n}`).join(' ')}`);
  const result = { channel, platformLive: live.size, local: local.length, stages: sum.stages, worklist: { test_reupload: w.test_reupload, test_toupload: w.test_toupload, deliv_toupload: w.deliv_toupload } };
  // ★最小解耦最大合并：platform 用「非枚举」属性挂载——编排器可 `s.platform` 取原始平台快照穿给 delete（省其重复 reload+翻页拉取），
  //   而 JSON.stringify / 对象展开(...res) 都跳过非枚举属性，绝不会把上百行快照灌进 `--json` 的 stdout。
  Object.defineProperty(result, 'platform', { value: platform, enumerable: false });
  return result;
}

// ★S1: mid 增量同步——只查台账在飞件的 last_mid，O(在飞)、无翻页、无 norm 名字匹配。
// opt-in（默认仍走全量 runSync 作 reconcile，发现新批次/漂移）；observe-by-mid：mid→videoKey 反查。
// 不渲染 index.md/worklist（增量是高频轮询用，渲染留全量 sync 负责）。
export async function runSyncIncremental(cfg, { mutate = true, log, cacheSig = true, ledger } = {}) {
  const L = log || { step() {}, ok() {}, info() {}, warn() {} };
  const { system, target } = cfg;
  const channel = target.id;
  const { ledgerPath } = system.project;

  const led = ledger || createLedger(ledgerPath);
  // 收集本通道在飞 mid（快照）：有 last_mid 且未 passed 未 scrapped（终态已单调钉死，不必再查）。
  const midToKey = await led.read((state) => {
    const m = new Map();
    for (const [k, v] of Object.entries(state.videos)) {
      const c = v.ch[channel]; if (!c || c.passed || c.scrapped || !c.last_mid) continue;
      m.set(String(c.last_mid), k);
    }
    return m;
  });
  const mids = [...midToKey.keys()];
  if (!mids.length) {
    const sum0 = await led.read((s) => summarize(s));
    L.ok(`增量 sync ${channel}: 无在飞 mid（全部终态或无 last_mid）→ 跳过（建议跑全量 sync 兜底）`);
    return { mode: 'incremental', channel, queried: 0, observed: 0, stages: sum0.stages, worklist: { test_reupload: [], test_toupload: [], deliv_toupload: [] } };
  }

  // 连标签 → 入口护栏（断言 aavid/计划/会话，防错标签查询）→ 取 op 签名（★S1b 缓存优先）→ 按 mid 查审核
  const cdp = await connect({ port: target.port, aavid: target.aavid });
  let rows, sigSource = 'fresh';
  try {
    await cdp.send('Runtime.enable');
    await guardEnter(cdp, cfg, { log: L });
    // ★S1b: 先试缓存签名（age<BUDGET），命中则跳 reload；失效（pullRowsByMid 抛 E_SIG）则回退现抓。
    let op = null;
    if (cacheSig) {
      const c = readCachedSig(ledgerPath, channel);
      if (c && (Date.now() - c.capturedAt) < SIG_TTL_BUDGET_MS) op = { url: c.url, postData: c.postData };
    }
    if (op) {
      try { L.step(`增量：用缓存签名（跳 reload）查 ${mids.length} 个在飞 mid`); rows = await pullRowsByMid(cdp, op, mids); sigSource = 'cache'; }
      catch (e) { if (e.code === 'E_SIG') { L.warn('缓存签名失效 → reload 现抓'); op = null; } else throw e; }
    }
    if (!op) {
      L.step(`增量：reload 捕 op 签名 + 按 ${mids.length} 个在飞 mid 查审核`);
      const sigs = await captureListSigs(cdp, { ui: target.ui }); // ★J2: creative-tab 补点素材触发列表
      if (cacheSig) writeCachedSig(ledgerPath, channel, sigs.op);
      rows = await pullRowsByMid(cdp, sigs.op, mids);
    }
  } finally { cdp.close(); }

  // observe-by-mid：isDel 跳过（已删副本审核值无意义、保留旧值）；否则 mid→key 反查 observe（跳过 norm 匹配）。
  const now = Date.now();
  const observed = rows.filter(r => r.isDel !== true && midToKey.has(String(r.id)) && r.audit != null).length; // 只计真学到审核值的
  const applyObs = (state) => {
    for (const r of rows) {
      if (r.isDel === true) continue;
      const key = midToKey.get(String(r.id)); if (!key || !state.videos[key]) continue;
      observe(state.videos[key], channel, { audit: r.audit, mid: r.id, ts: now });
    }
  };
  let w, sum;
  if (mutate) {
    w = await led.commit('sync-inc:' + channel, applyObs);
    sum = summarize(await led.read((s) => s));
  } else {
    const r2 = await led.read((s) => { const chs = loadChannels(); syncChannels(s, chs.channels, chs.pipeline); applyObs(s); recomputeAll(s); return { w: worklists(s), sum: summarize(s) }; });
    w = r2.w; sum = r2.sum;
  }
  L.ok(`增量 sync ${channel}（签名=${sigSource}）: 查 ${mids.length} 个在飞 mid → observe ${observed} | ${Object.entries(sum.stages).map(([s, n]) => `${s}=${n}`).join(' ')}`);
  return { mode: 'incremental', channel, sigSource, queried: mids.length, observed, stages: sum.stages, worklist: { test_reupload: w.test_reupload, test_toupload: w.test_toupload, deliv_toupload: w.deliv_toupload } };
}

export function renderArtifacts(root, state, w, live, local, channel) {
  // ★#6 按通道分名：防 jie3/jie6 sync 写同名文件互相覆盖（这些是人看产物，机器真源在台账）。
  writeFileSync(join(root, `_toupload.${channel}.txt`), w.test_toupload.join('\n') + (w.test_toupload.length ? '\n' : ''), 'utf8');
  writeFileSync(join(root, `_reupload.${channel}.txt`), w.test_reupload.join('\n') + (w.test_reupload.length ? '\n' : ''), 'utf8');
  let md = `# 视频状态 LOG —— 机器真源=_video_state.json，本文件仅供人看\n\n`;
  md += `通道=${channel} ｜ 本地=${local.length} ｜ 平台live=${live.size} ｜ test待传=${w.test_toupload.length} ｜ test重传=${w.test_reupload.length} ｜ 封存=${w.sealed.length} ｜ 交付=${w.delivered.length} ｜ 作废=${w.scrapped.length}\n\n`;
  const cols = (state.pipeline && state.pipeline.length) ? state.pipeline : Object.keys(state.channels || {});
  md += `| 文件名 | stage | ${cols.join(' | ')} |\n`;
  md += `|---|---|${cols.map(() => '---').join('|')}|\n`;
  const fmt = c => `up${c.uploads || 0}${c.passed ? '·过' : ''}${c.scrapped ? '·废' : ''}${c.last_status ? '·s' + c.last_status : ''}`;
  for (const v of Object.values(state.videos)) md += `| ${v.name} | ${v.stage} | ${cols.map(id => fmt((v.ch && v.ch[id]) || {})).join(' | ')} |\n`;
  writeFileSync(join(root, `index.${channel}.md`), md, 'utf8');
}
