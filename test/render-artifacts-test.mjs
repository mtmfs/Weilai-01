// 离线测试：index.<channel>.md 通道列从 state.pipeline 动态渲染，不再硬写 jie3/jie6。
// 跑：node test/render-artifacts-test.mjs
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeTargets, replayOk } from '../lib/delete.mjs';
import { renderArtifacts } from '../lib/sync.mjs';
import { uploadNamesForRole } from '../lib/state.mjs';

const root = mkdtempSync(join(tmpdir(), 'weilai-render-'));
try {
  const state = {
    channels: {
      alpha: { maxUploads: 7 },
      beta: { maxUploads: 3 },
    },
    pipeline: ['alpha', 'beta'],
    videos: {
      one: {
        name: 'one.mp4',
        stage: 'testing',
        ch: {
          alpha: { uploads: 1, passed: false, scrapped: false, last_status: 3 },
          beta: { uploads: 0, passed: false, scrapped: false, last_status: null },
        },
      },
    },
  };
  const w = { test_toupload: [], test_reupload: [], sealed: [], delivered: [], scrapped: [] };
  renderArtifacts(root, state, w, new Map(), [], 'alpha');
  const md = readFileSync(join(root, 'index.alpha.md'), 'utf8');
  assert.ok(md.includes('| 文件名 | stage | alpha | beta |'), '表头应使用 pipeline 通道名');
  assert.ok(!md.includes('| 文件名 | stage | jie3 | jie6 |'), '表头不应硬写 jie3/jie6');
  assert.ok(md.includes('| one.mp4 | testing | up1·s3 | up0 |'), '行内容应按动态列顺序渲染');
  const w2 = { test_toupload: ['t-new'], test_reupload: ['t-re'], deliv_toupload: ['d-new'], deliv_reupload: ['d-re'] };
  assert.deepStrictEqual(uploadNamesForRole('test', w2), ['t-new', 't-re'], 'test 通道应取首传+重传');
  assert.deepStrictEqual(uploadNamesForRole('delivery', w2), ['d-new', 'd-re'], 'delivery 通道应取 sealed 首投+重传');
  assert.strictEqual(replayOk(JSON.stringify({ status: 200, body: '{"status_code":0,"message":"success"}' })), true, 'paid set-opt status_code=0 应算成功');
  assert.strictEqual(replayOk(JSON.stringify({ status: 200, body: '{"status_code":2001,"message":"fail"}' })), false, 'paid set-opt 非 0 status_code 应算失败');
  const delState = { videos: { 'kw-a.mp4': { ch: { paid: { passed: false, scrapped: false } } } } };
  const delTargets = computeTargets([
    { name: 'KW-a.mp4', id: 'm1', audit: 1 },
    { name: 'KW-a.mp4', id: 'm2', audit: 4 },
    { name: 'KW-a.mp4', id: 'm1', audit: 1 },
  ], new Set(['kw-a.mp4']), delState, 'paid', 'KW');
  assert.deepStrictEqual(delTargets.map(t => t.legoMid), ['m1', 'm2'], 'delete 候选应按 materialId 去重并保留同名多副本');
  console.log('render-artifacts 动态通道列通过 ✓');
} finally {
  rmSync(root, { recursive: true, force: true });
}
