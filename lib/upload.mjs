// lib/upload.mjs —— 上传核心·注入 + 编排（计划②/Phase3 实现）。移植 I:\cdp-helper\run-reupload-multi.mjs。
// 核心坑：上传 <input> 是点击时临时创建的瞬态节点 → backendNodeId 极不稳。
// 解法：Page.setInterceptFileChooserDialog + DOM.getDocument 各开一次；每批 clickAt(受信任手势)拖拽框
//       → 80ms×25 轮询 Page.fileChooserOpened(寿命短) → DOM.setFileInputFiles(backendNodeId)。批≤maxPerBatch(9)。
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, norm } from './cdp.mjs';
import { guardEnter } from './guard.mjs';
import { submit } from './submit.mjs';
import { captureListSigs, pullRows } from './sync.mjs';
import { recordSubmissions } from './telemetry.mjs';
import { loadState, saveState, ensureVideo, bumpUpload, recomputeAll } from './state.mjs';
import { loadChannels } from './config.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function synthClickText(cdp, t) {
  return cdp.j(`const T=${JSON.stringify(t)};
    const el=[...document.querySelectorAll('span,div,button,a,[role=tab]')].filter(e=>__vis(e)&&(e.innerText||'').trim()===T).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
    if(!el)return false; el.scrollIntoView({block:'center'}); return __synthClick(el);`);
}
async function findBox(cdp) {
  const r = await cdp.j(`
    let z=document.querySelector('.oc-create-upload-select-wrapper')||document.querySelector('.oc-create-material-upload-video-select')||[...document.querySelectorAll('div,span,a')].filter(x=>__vis(x)&&/点击上传/.test(x.innerText||'')).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
    if(!z)return null; z.scrollIntoView({block:'center'}); const r=z.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`);
  return r ? JSON.parse(r) : null;
}

// openUploadPanel：就绪视图（添加视频可见，由 ready 保证）→ 点「添加视频」→「上传视频」tab → 拦截+getDocument 各一次。
export async function openUploadPanel(cdp, cfg, { log } = {}) {
  const L = log || { step() {}, ok() {}, warn() {} };
  if (!await cdp.j(`return __byText(/^添加视频$/).length>0;`)) return { ready: false, reason: 'NO_ADD_VIDEO（先 ready）' };
  await synthClickText(cdp, '添加视频'); await sleep(2500);
  await synthClickText(cdp, '上传视频'); await sleep(2500);
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }); // 只开一次
  await cdp.send('DOM.getDocument', { depth: -1, pierce: true });          // 初始化 DOM 跟踪一次
  const box = await findBox(cdp);
  if (box) L.ok('上传面板就绪（点击上传框可见）');
  return { ready: !!box };
}

// inject：files(绝对路径数组) 按 maxPerBatch 分批注入。返回 {injected:[...路径], batches}。★不提交。
export async function inject(cdp, cfg, files, { maxPerBatch, log } = {}) {
  const L = log || { step() {}, ok() {}, warn() {} };
  const per = maxPerBatch || (cfg.system.batch && cfg.system.batch.maxPerBatch) || 9;
  const batches = [];
  for (let i = 0; i < files.length; i += per) batches.push(files.slice(i, i + per));
  const events = [];
  const off = cdp.onEvent(m => { if (m.method === 'Page.fileChooserOpened') events.push(m); });
  const injected = [];
  try {
    for (let bi = 0; bi < batches.length; bi++) {
      L.step(`注入 batch${bi + 1}/${batches.length}（${batches[bi].length} 个）`);
      if (await injectBatch(cdp, batches[bi], bi + 1, events, L)) injected.push(...batches[bi]);
      else { L.warn(`batch${bi + 1} 6 次重试均失败，停止`); break; }
      await sleep(3500);
    }
  } finally { off(); }
  return { injected, batches: batches.length };
}

async function injectBatch(cdp, files, idx, events, L) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const box = await findBox(cdp);
    if (!box) { L.warn(`  b${idx} try${attempt}: NO_BOX`); await sleep(1800); continue; }
    await sleep(250);
    const evLen = events.length;
    await cdp.clickAt(box.x, box.y); // 受信任手势
    let fc = null;
    for (let w = 0; w < 25; w++) { fc = events.slice(evLen).pop(); if (fc) break; await sleep(80); } // 瞬态：早发现早灌
    if (!fc) { L.warn(`  b${idx} try${attempt}: NO_CHOOSER`); await sleep(1500); continue; }
    try {
      await cdp.send('DOM.setFileInputFiles', { backendNodeId: fc.params.backendNodeId, files });
    } catch (e) {
      try { await cdp.send('DOM.getDocument', { depth: -1, pierce: true }); await cdp.send('DOM.setFileInputFiles', { backendNodeId: fc.params.backendNodeId, files }); }
      catch (e2) { L.warn(`  b${idx} try${attempt}: SET_ERR ${String(e2.message || e2).slice(0, 40)}`); await sleep(1200); continue; }
    }
    await sleep(2600);
    const modal = await cdp.j(`const m=[...document.querySelectorAll('.ovui-modal__wrap,.oc-modal-wrap,[role=dialog]')].filter(__vis).pop(); return m?(m.innerText||'').replace(/\\s+/g,' ').slice(0,80):null;`);
    if (modal && /仅前|超过|最多|个视频/.test(modal)) {
      await cdp.j(`const m=[...document.querySelectorAll('.ovui-modal__wrap,.oc-modal-wrap,.ovui-modal,[role=dialog]')].filter(__vis).pop(); if(m){const b=[...m.querySelectorAll('button')].filter(x=>__vis(x)&&/^(确定|继续|确认)$/.test((x.innerText||'').trim()))[0]; if(b)__synthClick(b);}`);
      await sleep(1500);
      L.step(`  b${idx} 确认"仅前N个": ${modal}`);
    }
    L.ok(`  b${idx} 注入 ${files.length} 个 ✓ (try${attempt})`);
    return true;
  }
  return false;
}

// ── 编排：openUploadPanel → inject → submit → bump（计划②的 upload 环节）──────────────
// names=台账视频名数组；取 I:\md5fix\<name>（须先 md5fix）。connect+guardEnter 防上传到错账户。
// ★bump 是唯一 uploads++ 写者：对注入件 uploads++、last_status=3；last_mid 由下次 sync 回填。
// ★轮次 token 幂等：同通道+同批文件 30min 内已上传过 → 判误重跑，跳过整轮（不重复创建素材、不双计 uploads）。
//   超窗＝多半经历了新一轮审核/重传应再计；时间窗是 upload 这类"非幂等增量操作"的务实护栏。
const REBUMP_WINDOW_MS = 30 * 60 * 1000;
const roundToken = (channel, names) => createHash('sha1').update(`${channel}|${[...names].sort().join(',')}`).digest('hex').slice(0, 16);

// ★point7：取每个注入名的 max-mid live 副本 = 刚提交件（snowflake mid 时间序，等长→字典序=数值序）。
function pickSubmittedMids(platform, injNorms) {
  const set = new Set(injNorms);
  const byName = new Map();
  for (const p of platform) {
    if (p.isDel === true || p.id == null) continue;
    const k = norm(p.name || ''); if (!set.has(k)) continue;
    const cur = byName.get(k);
    if (!cur || String(p.id) > String(cur)) byName.set(k, String(p.id));
  }
  return byName;
}

export async function runUpload(cfg, { names, log, mutate = true } = {}) {
  const L = log || { step() {}, ok() {}, warn() {}, info() {} };
  const { system, target } = cfg;
  const channel = target.id;
  const md5Dir = system.md5fix.outDir;

  const files = [];
  for (const n of names || []) { const p = join(md5Dir, n); if (existsSync(p)) files.push(p); else L.warn(`跳过(无 md5fix 文件，先 md5fix): ${n}`); }
  if (!files.length) { L.warn('无可上传文件'); return { injected: 0, submitted: 0 }; }

  const targetNames = files.map(f => f.split(/[\\/]/).pop());
  const token = roundToken(channel, targetNames);

  // 前置幂等护栏：同批文件近窗已上传 → 跳过整轮（在碰平台/创建素材之前）。
  let state = null;
  if (mutate) {
    state = loadState(system.project.ledgerPath);
    const prev = (state.rounds || {})[token];
    if (prev && Date.now() - prev.ts < REBUMP_WINDOW_MS) {
      L.warn(`疑似重跑（同批 ${Math.round((Date.now() - prev.ts) / 60000)}min 前已上传）→ 跳过整轮，防重复素材+双计 uploads。确为新一轮请待审核更新后再传。`);
      return { injected: 0, submitted: 0, dedup: true };
    }
  }

  const cdp = await connect({ port: target.port, aavid: target.aavid });
  let injected = [], N = 0, midByName = new Map();
  try {
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('DOM.enable'); await cdp.send('Page.bringToFront');
    await guardEnter(cdp, cfg, { log: L }); // 身份断言：绝不上传到错账户（尤其有钱的 jie6）
    const panel = await openUploadPanel(cdp, cfg, { log: L });
    if (!panel.ready) throw Object.assign(new Error('上传面板未就绪（先跑 ready）'), { code: 'E_SELECTOR' });
    injected = (await inject(cdp, cfg, files, { log: L })).injected;
    N = (await submit(cdp, cfg, { log: L })).submitted;
    // ★point7：捕本轮 materialId（reload 拉平台，每名取 max-mid live 副本）→ 喂 bump.last_mid + submissions.jsonl。
    if (injected.length) {
      await new Promise(r => setTimeout(r, 3000)); // settle：让新素材入列
      try {
        const { rq, op } = await captureListSigs(cdp);
        const platform = await pullRows(cdp, rq, op);
        midByName = pickSubmittedMids(platform, injected.map(f => norm(f.split(/[\\/]/).pop())));
        L.info(`捕 mid: ${midByName.size}/${injected.length} 名命中`);
      } catch (e) { L.warn(`捕 mid 失败（不致命，sync 会回填 last_mid）: ${String(e.message || e).slice(0, 50)}`); }
    }
  } finally { cdp.close(); }

  if (mutate && injected.length) {
    if (!state) state = loadState(system.project.ledgerPath);
    const chs = loadChannels(); state.channels = chs.channels; state.pipeline = chs.pipeline;
    const now = Date.now();
    const injNames = injected.map(f => f.split(/[\\/]/).pop());
    for (const n of injNames) bumpUpload(ensureVideo(state, norm(n), n), channel, { mid: midByName.get(norm(n)), ts: now });
    state.rounds = state.rounds || {};
    state.rounds[token] = { ts: now, n: injNames.length }; // 记轮次 token（防 30min 内误重跑双计）
    recomputeAll(state);
    saveState(system.project.ledgerPath, state);
    // ★pass-rate 基建：记本轮提交（submit-time + materialId）；audit 结果由后续 sync 顺带 resolve。
    const subItems = injNames.map(n => ({ mid: midByName.get(norm(n)), name: n })).filter(it => it.mid);
    const rec = subItems.length ? recordSubmissions(system.project.ledgerPath, channel, subItems, now) : 0;
    L.ok(`upload ${channel}: 注入 ${injNames.length} / 平台确认 ${N} / 捕 mid ${midByName.size} → bump + 记 submissions ${rec}（uploads++、last_mid 已填）`);
  }
  return { injected: injected.length, submitted: N };
}
