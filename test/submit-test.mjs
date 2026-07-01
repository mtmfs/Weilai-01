// Offline submit behavior tests. Run: node test/submit-test.mjs
import assert from 'node:assert';
import { submit, holdSubmit } from '../lib/submit.mjs';

function fakeCdp(snaps) {
  const calls = [];
  return {
    calls,
    async send(method) {
      calls.push(['send', method]);
      return {};
    },
    async j(expr) {
      calls.push(['j', expr]);
      if (expr.includes('.oc-progress-content')) {
        const s = snaps.length > 1 ? snaps.shift() : snaps[0];
        return JSON.stringify(s);
      }
      if (expr.includes("return b?(__synthClick(b),'CLICKED'):'NOBTN'")) return 'CLICKED';
      if (expr.includes('modal.querySelectorAll')) return null;
      if (expr.includes('modalOpen')) return JSON.stringify({ modalOpen: false, uploadBoxOpen: false });
      throw new Error('unexpected expression: ' + expr.slice(0, 120));
    },
  };
}

const cfg = { system: { timeouts: { patientMaxMin: 1, pollSec: 1, perFileNoProgressSec: 1 } } };

{
  const cdp = fakeCdp([{ total: 0, inprog: 0, done: 0, inprogSum: 0, cEn: true }]);
  const res = await submit(cdp, cfg, { log: { step() {}, ok() {}, warn() {}, info() {} } });
  assert.strictEqual(res.click, 'CLICKED');
  assert.notStrictEqual(res.click, 'EMPTY');
  console.log('✓ submit: total=0 but confirm enabled still clicks');
}

{
  const cdp = fakeCdp([{ total: 0, inprog: 0, done: 0, inprogSum: 0, cEn: false }]);
  const res = await submit(cdp, cfg, { log: { step() {}, ok() {}, warn() {}, info() {} } });
  assert.strictEqual(res.click, 'EMPTY');
  console.log('✓ submit: true empty panel stays EMPTY');
}

{
  const cdp = fakeCdp([
    { total: 0, inprog: 0, done: 0, inprogSum: 0, cEn: true },
    { total: 0, inprog: 0, done: 0, inprogSum: 0, cEn: true },
  ]);
  const res = await holdSubmit(cdp, cfg, { delayMin: 0, log: { step() {}, ok() {}, warn() {}, info() {} } });
  assert.strictEqual(res.held, true);
  assert.strictEqual(res.click, 'CLICKED');
  console.log('✓ holdSubmit: delay=0 confirms after gate');
}

console.log('\nsubmit-test 全部通过 ✓');
