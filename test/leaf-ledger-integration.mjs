// test/leaf-ledger-integration.mjs —— 离线端到端验证「叶子 → ledger 提交器」接线在真实代码里正确。
// 用 runReconcile（接受 platform 入参 → 跳过 CDP）跑真实叶子：种一个幻影在飞件 → apply 对账 → 验证经 ledger un-bump 落盘。
// 跑：node test/leaf-ledger-integration.mjs （非 0 退出码 = 失败）
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { loadConfig } from '../lib/config.mjs';
import { createLedger } from '../lib/ledger.mjs';
import { loadState } from '../lib/state.mjs';
import { runReconcile } from '../lib/reconcile.mjs';

const PATH = join(tmpdir(), `weilai-leaf-test-${process.pid}.json`);
const clean = () => { for (const s of ['', '.tmp', '.bak']) { try { rmSync(PATH + s, { force: true }); } catch (e) {} } };
const NOPLOG = { step() {}, ok() {}, info() {}, warn() {} };
clean();

const NAME = '6-25-魏文彬-测试-leaf (1).mp4'; // 含关键词 魏文彬，过 kw 闸门
const old = Date.now() - 60 * 60000;          // 60min 前（超 grace）
// 种台账：jie3 在飞（uploads=1, last_status=3, 有 mid）；平台将查无此 mid → 幻影 → 应 un-bump。
writeFileSync(PATH, JSON.stringify({
  channels: {}, pipeline: ['jie3', 'jie6'],
  videos: {
    [NAME]: {
      name: NAME,
      ch: {
        jie3: { uploads: 1, passed: false, scrapped: false, last_status: 3, last_mid: 'PHANTOM123', last_ts: old },
        jie6: { uploads: 0, passed: false, scrapped: false, last_status: null, last_mid: null, last_ts: 0 },
      },
      stage: 'testing', scrap_reason: null,
    },
  },
}), 'utf8');

const cfg = loadConfig('jie3');
const ledger = createLedger(PATH);

// platform=[] → 幻影 mid 不在平台 → 候选；graceMin=0 → 立即过 grace。apply=true → 经 ledger.commit 落盘。
const res = await runReconcile(cfg, { apply: true, platform: [], graceMin: 0, ledger, log: NOPLOG });
assert.strictEqual(res.reconciled, 1, `应 un-bump 1 件，实际 ${res.reconciled}`);

const after = loadState(PATH);
const c = after.videos[NAME].ch.jie3;
assert.strictEqual(c.uploads, 0, `un-bump 后 jie3.uploads 应=0，实际 ${c.uploads}`);
assert.strictEqual(c.last_status, null, `un-bump 后 jie3.last_status 应=null，实际 ${c.last_status}`);
assert.strictEqual(after.videos[NAME].stage, 'testing', `recompute 后 stage 应=testing，实际 ${after.videos[NAME].stage}`);
console.log(`[ok] runReconcile 经 ledger un-bump 落盘正确: uploads 1→${c.uploads}, status 3→${c.last_status}, stage=${after.videos[NAME].stage}`);

// 第二次对账：已无幻影（uploads=0、last_status≠3）→ 应 0 件，验证幂等不误伤。
const res2 = await runReconcile(cfg, { apply: true, platform: [], graceMin: 0, ledger, log: NOPLOG });
assert.strictEqual(res2.reconciled, 0, `二次对账应 0 件（幂等），实际 ${res2.reconciled}`);
console.log('[ok] 二次对账幂等无误伤');

clean();
console.log('leaf-ledger-integration: ALL PASS');
