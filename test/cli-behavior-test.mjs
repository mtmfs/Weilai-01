// 离线 CLI 行为测试：桩退出码、数字参数校验、login 写前校验。
// 跑：node test/cli-behavior-test.mjs
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const NODE = process.execPath;
const CLI = join(ROOT, 'bin', 'weilai.mjs');

function run(args, env = {}) {
  return spawnSync(NODE, [CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}
function sha(p) {
  return existsSync(p) ? createHash('sha1').update(readFileSync(p)).digest('hex') : null;
}

{
  const r = run(['hold-submit', '--json']);
  assert.strictEqual(r.status, 64, `hold-submit 应退出 64，实际 ${r.status}: ${r.stderr}`);
  assert.strictEqual(JSON.parse(r.stdout).implemented, false, 'hold-submit JSON 应保留 implemented=false');
  console.log('✓ hold-submit 桩退出 64 且 JSON 保持');
}

{
  const r = run(['delete-paid', '--json'], { WEILAI_SUPERVISOR: '1' });
  assert.strictEqual(r.status, 64, `delete-paid 桩应退出 64，实际 ${r.status}: ${r.stderr}`);
  assert.strictEqual(JSON.parse(r.stdout).implemented, false, 'delete-paid JSON 应保留 implemented=false');
  console.log('✓ delete-paid 桩解锁后退出 64 且 JSON 保持');
}

for (const [flag, value] of [['--batch', 'abc'], ['--poll-floor', '0'], ['--poll-ceil', '-1'], ['--full-sync', '1.5']]) {
  const r = run(['run', flag, value]);
  assert.strictEqual(r.status, 2, `run ${flag} ${value} 应 E_USAGE(2)，实际 ${r.status}`);
}
console.log('✓ run 数字参数非法值均 E_USAGE');

{
  const ch = join(ROOT, 'channels', 'jie3.json');
  const before = sha(ch);
  const r = run(['login', '--email', 'a@example.com', '--pwd', 'pw', '--free-aavid', '1', '--free-plan', '2', '--free-port', 'abc']);
  assert.strictEqual(r.status, 2, `login 非法 port 应 E_USAGE(2)，实际 ${r.status}`);
  assert.strictEqual(sha(ch), before, 'login 非法 port 不应写 channels/jie3.json');
  console.log('✓ login 非法 port 写前拒绝且不改配置');
}

console.log('\ncli-behavior 全部通过 ✓');
