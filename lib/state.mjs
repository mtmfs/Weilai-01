// lib/state.mjs —— 双通道台账 _video_state.json: {channels, pipeline, videos}.
// 继承自 I:\cdp-helper\lib-state.mjs（验证过的干净件），增强：原子写+备份、summarize、ledgerExists、syncChannels。
// 分层: observe/bumpUpload 是 channel-scoped(上传/拉取插件用, 不懂流水线);
//       recomputeStage 是编排器用(由 ch事实+channels+pipeline 算 stage, 单一真相, 不手维护)。
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs';
import { loadChannels } from './config.mjs';

// ★通道事实唯一真源 = channels/*.json（loadState 经 bootChannels 从中取）。以下仅为离线单测夹具；
//   真实运行不再回退到任何业务账号，缺/坏 channels 会明确 E_CONFIG 停止。
export const DEFAULT_CHANNELS = {
  jie3: { role: 'test',     account: '', aavid: '', mode: '', planId: '', funded: false, maxUploads: 7 },
  jie6: { role: 'delivery', account: '', aavid: '', mode: '', planId: '', funded: true,  maxUploads: 3 }
};
export const DEFAULT_PIPELINE = ['jie3', 'jie6']; // 流水线顺序: 测试通道 -> 投放通道
export const STAGES = ['testing', 'sealed', 'delivering', 'delivered', 'scrapped'];

export function ledgerExists(p) { return !!p && existsSync(p); }

// 引导 channels/pipeline：优先从 config(channels/*.json) 取（通道事实唯一真源）；读不到才回退离线默认。
// 让"台账缺 channels / 文件不存在"也落到 channels 真值，根除 DEFAULT_CHANNELS 与 channels 双源漂移。
function bootChannels() {
  const c = loadChannels();
  if (c && c.channels && c.pipeline) return { channels: c.channels, pipeline: c.pipeline };
  throw Object.assign(new Error('channels/*.json 未能提供通道配置'), { code: 'E_CONFIG' });
}

export function loadState(p) {
  const boot = bootChannels();
  const base = { channels: boot.channels, pipeline: boot.pipeline, videos: {} };
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

// 用 config/channels 覆盖台账 channels（让配置成为通道事实的唯一真源；调用后再 recomputeAll）。
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
  if (audit === 1 || audit === 4) c.passed = true; // 单调钉死（★M5: 4=审核通过可优化，同等视为过审；否则既不过审又不进重传→永久卡死）
}

// ── 编排器 API(只有它懂流水线) ────────────────────────────────
export function recomputeStage(state, v) {
  const [testId, delivId] = state.pipeline;
  const T = v.ch[testId], D = v.ch[delivId];
  const tMax = state.channels[testId].maxUploads, dMax = state.channels[delivId].maxUploads;
  // ★流水线语义推断：视频出现在投放通道(jie6 有上传/过审/有素材mid) ⟹ 它必然过过 jie3。据此推断 jie3 已过审，
  //   防"jie3 副本被删 / jie6 审核值漏取 → 台账 jie3.passed 漂移为 false → 误当 testing 重传或 scrapped 已在 jie6 的件"。
  //   含 D.last_mid：即便 jie6 审核值暂时没取到(observe 记了 mid 没记 status)，有 mid 就说明它进过 jie6。
  const tPassed = T.passed || D.uploads > 0 || D.passed || !!D.last_mid;
  // ★作废单调钉死: 满 attempts 且失败时设 scrapped=true, 一旦置真永不回退。仅在未(推断)过审时才可能 jie3 作废。
  if (!tPassed && T.uploads >= tMax && T.last_status === 2) T.scrapped = true;
  if (!D.passed && D.uploads >= dMax && D.last_status === 2) D.scrapped = true;
  v.scrap_reason = null;
  if (!tPassed) {
    if (T.scrapped) { v.stage = 'scrapped'; v.scrap_reason = testId + '_' + tMax + 'x_fail'; }
    else v.stage = 'testing';
    return v.stage;
  }
  if (D.passed) { v.stage = 'delivered'; return v.stage; }           // 投放过审 = 交付(passed 优先于 scrapped)
  // ★in-jie6 判据用"任何 jie6 痕迹"(上传/素材mid/审核值)，不用 uploads===0：jie6 scan 只 observe(写 mid/status)
  //   不 bump uploads，故扫到的件 uploads 恒=0；若仍按 uploads===0 判 sealed 会把"已在 jie6 的件"误判成"待推送"。
  const inJie6 = D.uploads > 0 || !!D.last_mid || D.last_status != null;
  if (!inJie6) { v.stage = 'sealed'; return v.stage; }               // jie3 过审、jie6 无任何痕迹 = 待推送 jie6
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

// 按通道角色取本轮应上传/备料的名字。test 取测试通道首传+重传；delivery 取 sealed 首投+投放重传。
export function uploadNamesForRole(role, w) {
  return role === 'delivery'
    ? [...(w.deliv_toupload || []), ...(w.deliv_reupload || [])]
    : [...(w.test_toupload || []), ...(w.test_reupload || [])];
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
