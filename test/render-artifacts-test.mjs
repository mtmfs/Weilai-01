// 离线测试：index.<channel>.md 通道列从 state.pipeline 动态渲染，不再硬写 jie3/jie6。
// 跑：node test/render-artifacts-test.mjs
import assert from 'node:assert';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderArtifacts } from '../lib/sync.mjs';

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
  console.log('render-artifacts 动态通道列通过 ✓');
} finally {
  rmSync(root, { recursive: true, force: true });
}
