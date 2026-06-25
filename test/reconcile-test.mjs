// 离线单测（无需 Chrome）：computeReconcile 只挑幻影件、不误伤在飞真件/被拒/过审/非kw；
// 且 un-bump 后 recomputeStage 把件正确归回上传队列。 跑：node test/reconcile-test.mjs
import assert from 'node:assert';
import { computeReconcile } from '../lib/reconcile.mjs';
import { norm } from '../lib/cdp.mjs';
import { recomputeStage, worklists, DEFAULT_CHANNELS, DEFAULT_PIPELINE } from '../lib/state.mjs';

const KW = '魏文彬', CH = 'jie3', NOW = 1_000_000_000_000;
const GRACE = 30 * 60000;
const OLD = NOW - 60 * 60000;   // 60min 前（超 grace）
const RECENT = NOW - 1 * 60000; //  1min 前（未超 grace）

const blank = () => ({ uploads: 0, passed: false, scrapped: false, last_status: null, last_mid: null, last_ts: 0 });
function vid(name, j3) {
  const v = { name, ch: { jie3: blank(), jie6: blank() }, stage: 'testing', scrap_reason: null };
  Object.assign(v.ch.jie3, j3);
  return v;
}
function mkState(list) {
  const state = { channels: JSON.parse(JSON.stringify(DEFAULT_CHANNELS)), pipeline: [...DEFAULT_PIPELINE], videos: {} };
  for (const v of list) state.videos[norm(v.name)] = v;
  return state;
}

// ── 夹具 ──────────────────────────────────────────────
const V = {
  phantom:   vid('魏文彬-测试_phantom',  { uploads: 2, last_status: 3, last_ts: OLD,    last_mid: '999' }), // 幻影：在飞·超grace·平台查无 → 候选
  byMid:     vid('魏文彬-测试_bymid',     { uploads: 1, last_status: 3, last_ts: OLD,    last_mid: '100' }), // 平台有此 mid → 非候选
  byName:    vid('魏文彬-测试_byname',    { uploads: 1, last_status: 3, last_ts: OLD,    last_mid: null  }), // 平台有同名 → 非候选
  grace:     vid('魏文彬-测试_grace',     { uploads: 1, last_status: 3, last_ts: RECENT, last_mid: '888' }), // 未超 grace → 非候选
  rejected:  vid('魏文彬-测试_rej',       { uploads: 2, last_status: 2, last_ts: OLD,    last_mid: '777' }), // 被拒(非在飞) → 非候选
  passed:    vid('魏文彬-测试_pass',      { uploads: 1, last_status: 1, last_ts: OLD,    last_mid: '666', passed: true }), // 过审 → 非候选
  nonKw:     vid('张三-测试_nonkw',       { uploads: 2, last_status: 3, last_ts: OLD,    last_mid: '555' }), // 非kw → 闸门跳过
  phantom1:  vid('魏文彬-测试_phantom1',  { uploads: 1, last_status: 3, last_ts: OLD,    last_mid: '444' }), // 幻影·uploads=1 → 候选（归0回 toupload）
};
const state = mkState(Object.values(V));

const platform = [
  { name: '魏文彬-不相关-x',      id: '100', audit: 3, isDel: false }, // 命中 byMid（按 mid）
  { name: '魏文彬-测试_byname',   id: '200', audit: 3, isDel: false }, // 命中 byName（按名）
  { name: '魏文彬-测试_phantom',  id: '777', audit: 1, isDel: true  }, // isDel：不进 live → phantom 仍是候选（验 isDel 排除）
];

// ── 断言 1：候选恰为两个幻影件 ──────────────────────────
const cands = computeReconcile(state, platform, CH, KW, GRACE, NOW);
const got = cands.map(c => c.name).sort();
assert.deepStrictEqual(got, ['魏文彬-测试_phantom', '魏文彬-测试_phantom1'].sort(),
  `候选应仅为两个幻影件，实得: ${JSON.stringify(got)}`);
console.log('✓ 断言1：computeReconcile 只挑幻影件（在飞真件/被拒/过审/未超grace/非kw 全不误伤；isDel 已排除）');

// ── 断言 2：un-bump 后正确归回上传队列 ──────────────────
// 复刻 runReconcile 的 un-bump 语义：uploads-1、清 mid/ts、last_status= >0?2:null。
function unbump(C) { C.uploads = Math.max(0, C.uploads - 1); C.last_mid = null; C.last_ts = 0; C.last_status = C.uploads > 0 ? 2 : null; }
for (const c of cands) unbump(state.videos[c.key].ch[CH]);
for (const k of Object.keys(state.videos)) recomputeStage(state, state.videos[k]);
const w = worklists(state);

// phantom: uploads 2→1、last_status→2 → 回 test_reupload
assert.ok(w.test_reupload.includes('魏文彬-测试_phantom'), 'phantom(uploads→1) 应回 test_reupload');
assert.ok(!w.test_toupload.includes('魏文彬-测试_phantom'), 'phantom 不应在 test_toupload');
// phantom1: uploads 1→0、last_status→null → 回 test_toupload
assert.ok(w.test_toupload.includes('魏文彬-测试_phantom1'), 'phantom1(uploads→0) 应回 test_toupload');
// 未误伤：过审件不该出现在任何上传队列；被拒件仍按其自身规则
assert.ok(!w.test_toupload.includes('魏文彬-测试_pass') && !w.test_reupload.includes('魏文彬-测试_pass'), '过审件不该回上传队列');
console.log('✓ 断言2：un-bump 后 recomputeStage 正确归队（uploads→0 回 toupload，仍>0 回 reupload）');

// ── 断言 3：幂等——再次对账无候选 ───────────────────────
const again = computeReconcile(state, platform, CH, KW, GRACE, NOW);
assert.strictEqual(again.length, 0, `un-bump 后应无残留候选，实得 ${again.length}`);
console.log('✓ 断言3：幂等——un-bump 后再对账候选为 0');

console.log('\nALL OK —— reconcile 离线单测全绿');
