// 台账（_video_state.json）只读载入 + 汇总。
// Phase 0 只读；Phase 2 将并入继承自 cdp-helper 的完整 lib-state
// （observe / recomputeStage / bumpUpload / worklists + 单调钉死 + 轮次 token）。
import { readFileSync, existsSync } from 'node:fs';

export const STAGES = ['testing', 'sealed', 'delivering', 'delivered', 'scrapped'];

export function loadLedger(path) {
  if (!path || !existsSync(path)) {
    return { exists: false, channels: {}, pipeline: [], videos: {} };
  }
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    s.exists = true;
    return s;
  } catch (e) {
    return { exists: false, channels: {}, pipeline: [], videos: {}, _parseError: e.message };
  }
}

// 分阶段 + 分通道汇总（只读派生，不改台账）。
export function summarize(ledger) {
  const videos = ledger.videos || {};
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
  return { exists: !!ledger.exists, total: names.length, stages, channels };
}
