// lib/state.mjs —— 双通道台账 _video_state.json: {channels, pipeline, videos}.
// 继承自 I:\cdp-helper\lib-state.mjs（验证过的干净件），增强：原子写+备份、summarize、ledgerExists、syncChannels。
// 分层: observe/bumpUpload 是 channel-scoped(上传/拉取插件用, 不懂流水线);
//       recomputeStage 是编排器用(由 ch事实+channels+pipeline 算 stage, 单一真相, 不手维护)。
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs';

export const DEFAULT_CHANNELS = {
  jie3: { role: 'test',     account: '捷沅3', aavid: '1849209213181706', mode: '推商品',   planId: '1868230520126939', funded: false, maxUploads: 5 },
  jie6: { role: 'delivery', account: '捷沅6', aavid: '1862076853297476', mode: '推直播间', planId: '1864536448309275', funded: true,  maxUploads: 3 }
};
export const DEFAULT_PIPELINE = ['jie3', 'jie6']; // 流水线顺序: 测试通道 -> 投放通道
export const STAGES = ['testing', 'sealed', 'delivering', 'delivered', 'scrapped'];

export function ledgerExists(p) { return !!p && existsSync(p); }

export function loadState(p) {
  const base = { channels: JSON.parse(JSON.stringify(DEFAULT_CHANNELS)), pipeline: [...DEFAULT_PIPELINE], videos: {} };
  if (!existsSync(p)) return base;
  const fill = (s) => { if (!s.channels) s.channels = base.channels; if (!s.pipeline) s.pipeline = base.pipeline; if (!s.videos) s.videos = {}; return s; };
  let raw;
  try { raw = readFileSync(p, 'utf8'); }
  catch (e) { throw Object.assign(new Error(`读取台账失败 ${p}: ${e.message}`), { code: 'E_CONFIG' }); }
  try {
    return fill(JSON.parse(raw));
  } catch (e) {
    // ★A1: 解析失败绝不静默返回空台账（否则随后的 saveState 会用空数据覆盖好台账、清零 uploads/passed/scrapped）。
    // 先试 .bak 自动恢复（带 stderr 告警，不静默）；无可用备份则大声失败，让操作者从备份手工恢复。
    const bak = p + '.bak';
    if (existsSync(bak)) {
      try {
        const s = fill(JSON.parse(readFileSync(bak, 'utf8')));
        process.stderr.write(`⚠ 台账 ${p} 解析失败，已自动回退 .bak（请核对后再继续）\n`);
        return s;
      } catch (e2) { /* .bak 也坏 → 落到下面抛错 */ }
    }
    throw Object.assign(new Error(`台账损坏且无可用备份 ${p}: ${e.message}（请从 .bak 手工恢复，勿继续写入）`), { code: 'E_CONFIG' });
  }
}

// ★原子写 + 备份：写临时文件 → 备份现有 → rename。根治"覆盖写不抗崩溃"。
export function saveState(p, s) {
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(s, null, 1), 'utf8');
  if (existsSync(p)) { try { copyFileSync(p, p + '.bak'); } catch (e) {} }
  renameSync(tmp, p);
}

// 用 config/targets 覆盖台账 channels（让配置成为通道事实的唯一真源；调用后再 recomputeAll）。
export function syncChannels(state, channels, pipeline) {
  if (channels) state.channels = channels;
  if (pipeline) state.pipeline = pipeline;
  return state;
}

function blankCh() { return { uploads: 0, passed: false, scrapped: false, last_status: null, last_mid: null, last_ts: 0 }; }
export function ensureVideo(state, key, name) {
  if (!state.videos[key]) {
    const ch = {}; for (const id of Object.keys(state.channels)) ch[id] = blankCh();
    state.videos[key] = { name: name || key, ch, stage: 'testing', scrap_reason: null };
  }
  const v = state.videos[key]; if (name && !v.name) v.name = name;
  for (const id of Object.keys(state.channels)) if (!v.ch[id]) v.ch[id] = blankCh();
  return v;
}

// ── channel-scoped 插件 API(不懂 stage) ─────────────────────────
// 上传插件: 某通道成功提交一次 → uploads++, 审核置"审核中"(防旧 last_status=2 撞 cap 误判)。
export function bumpUpload(v, channelId, { mid, ts } = {}) {
  const c = v.ch[channelId]; if (!c) return;
  c.uploads++; c.last_status = 3; if (mid) c.last_mid = mid; if (ts) c.last_ts = ts;
}
// 拉取(sync)插件: 观察某通道平台审核(去重后每名一次的代表副本) → passed 单调OR + last_status 取代表。
export function observe(v, channelId, { audit, mid, ts }) {
  const c = v.ch[channelId]; if (!c) return;
  if (audit != null) c.last_status = audit; // ★A7: 别用 undefined（本轮没拉到审核状态）覆盖上轮已知状态，否则 recompute 会漏判 scrapped
  if (mid) c.last_mid = mid; if (ts) c.last_ts = ts;
  if (audit === 1) c.passed = true; // 单调钉死
}

// ── 编排器 API(只有它懂流水线) ────────────────────────────────
export function recomputeStage(state, v) {
  const [testId, delivId] = state.pipeline;
  const T = v.ch[testId], D = v.ch[delivId];
  const tMax = state.channels[testId].maxUploads, dMax = state.channels[delivId].maxUploads;
  // ★作废单调钉死: 满 attempts 且失败时设 scrapped=true, 一旦置真永不回退。
  if (!T.passed && T.uploads >= tMax && T.last_status === 2) T.scrapped = true;
  if (!D.passed && D.uploads >= dMax && D.last_status === 2) D.scrapped = true;
  v.scrap_reason = null;
  if (!T.passed) {
    if (T.scrapped) { v.stage = 'scrapped'; v.scrap_reason = testId + '_' + tMax + 'x_fail'; }
    else v.stage = 'testing';
    return v.stage;
  }
  if (D.uploads === 0) { v.stage = 'sealed'; return v.stage; }       // 测试过审, 还没推送投放
  if (D.passed) { v.stage = 'delivered'; return v.stage; }           // 投放过审 = 交付(passed 优先于 scrapped)
  if (D.scrapped) { v.stage = 'scrapped'; v.scrap_reason = delivId + '_' + dMax + 'x_fail'; }
  else v.stage = 'delivering';
  return v.stage;
}
export function recomputeAll(state) { for (const k of Object.keys(state.videos)) recomputeStage(state, state.videos[k]); }

// ── 派生工作清单(编排器用) ────────────────────────────────────
export function worklists(state) {
  const w = { test_toupload: [], test_reupload: [], sealed: [], deliv_toupload: [], deliv_reupload: [], delivered: [], scrapped: [] };
  const [testId, delivId] = state.pipeline;
  for (const [k, v] of Object.entries(state.videos)) {
    const T = v.ch[testId], D = v.ch[delivId];
    if (v.stage === 'testing') {
      // ★只把「被拒(last_status===2)」算待重传；「审核中(3)」在飞、两清单都不进（防 cycle 多轮误传在飞件，对齐下面 deliv_reupload 门控）。
      if (T.uploads === 0) w.test_toupload.push(v.name);
      else if (T.last_status === 2) w.test_reupload.push(v.name);
    }
    else if (v.stage === 'sealed') { w.sealed.push(v.name); w.deliv_toupload.push(v.name); }
    else if (v.stage === 'delivering') { if (D.last_status === 2 && D.uploads < state.channels[delivId].maxUploads) w.deliv_reupload.push(v.name); }
    else if (v.stage === 'delivered') { w.delivered.push(v.name); }
    else if (v.stage === 'scrapped') { w.scrapped.push(v.name); }
  }
  return w;
}

// ── 只读汇总(status 用) ───────────────────────────────────────
export function summarize(state) {
  const videos = state.videos || {};
  const names = Object.keys(videos);
  const stages = Object.fromEntries(STAGES.map((s) => [s, 0]));
  const channels = {};
  for (const name of names) {
    const v = videos[name] || {};
    if (v.stage && stages[v.stage] !== undefined) stages[v.stage]++;
    const ch = v.ch || {};
    for (const cid of Object.keys(ch)) {
      channels[cid] = channels[cid] || { uploads: 0, passed: 0, scrapped: 0 };
      if (ch[cid].uploads) channels[cid].uploads += 1;
      if (ch[cid].passed) channels[cid].passed += 1;
      if (ch[cid].scrapped) channels[cid].scrapped += 1;
    }
  }
  return { total: names.length, stages, channels };
}
