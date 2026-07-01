// 离线 CLI 行为测试：命令分发、数字参数校验、login 写前校验。
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
const PAID_WRAPPERS = [
  'ready-paid',
  'open-paid',
  'close-paid',
  'whoami-paid',
  'sync-paid',
  'upload-paid',
  'hold-submit-paid',
  'reconcile-paid',
  'monitor-paid',
  'monitor-report-paid',
  'delete-paid',
];

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
function assertExit(args, status, msg, env = {}) {
  const r = run(args, env);
  assert.strictEqual(r.status, status, `${msg}，实际 ${r.status}\nSTDERR:\n${r.stderr}\nSTDOUT:\n${r.stdout}`);
  return r;
}

{
  assertExit(['hold-submit', '--delay-min', 'abc', '--json'], 2, 'hold-submit 非法 delay-min 应 E_USAGE(2)');
  assertExit(['hold-submit', '--delay-min'], 2, 'hold-submit 缺少 delay-min 值应 E_USAGE(2)');
  assertExit(['hold-submit', '--as', 'paid', '--delay-min', '0', '--json'], 2, 'hold-submit --as paid 未解锁应 E_USAGE(2)');
  assertExit(['hold-submit', '--as', '--json'], 2, '缺少 --as 值应 E_USAGE(2)');
  console.log('✓ hold-submit 参数校验和主管锁符合预期');
}

{
  const r = assertExit(['--help'], 0, '--help 应成功');
  for (const cmd of PAID_WRAPPERS) {
    assert.ok(!r.stdout.includes(cmd), `--help 不应显示主管级 ${cmd}`);
  }
  assert.ok(!r.stdout.includes('stats-paid'), '--help 不应显示 stats-paid 别名');
  assert.ok(!r.stdout.includes('traffic-paid'), '--help 不应显示 traffic-paid 别名');
  console.log('✓ 默认 help 隐藏 paid 包装命令');
}

{
  const r = assertExit(['--help-all'], 0, '--help-all 应成功');
  for (const cmd of PAID_WRAPPERS) {
    assert.ok(r.stdout.includes(cmd), `--help-all 应显示 ${cmd}`);
  }
  assert.ok(r.stdout.includes('stats-paid'), '--help-all 应显示 stats-paid 别名');
  assert.ok(r.stdout.includes('traffic-paid'), '--help-all 应显示 traffic-paid 别名');
  console.log('✓ help-all 显示 paid 包装命令和别名');
}

for (const cmd of PAID_WRAPPERS) {
  assertExit([cmd, '--json'], 2, `${cmd} 未解锁应 E_USAGE(2)`);
}
console.log('✓ paid 包装命令未解锁均 E_USAGE');

for (const [flag, value] of [['--batch', 'abc'], ['--poll-floor', '0'], ['--poll-ceil', '-1'], ['--full-sync', '1.5']]) {
  assertExit(['run', flag, value], 2, `run ${flag} ${value} 应 E_USAGE(2)`);
}
assertExit(['run', '--batch'], 2, 'run --batch 缺值应 E_USAGE(2)');
console.log('✓ run 数字参数非法值均 E_USAGE');

for (const args of [
  ['run', 'paid'],
  ['ready', 'paid'],
  ['sync', 'paid'],
  ['upload', 'paid', '--json'],
  ['hold-submit', 'paid', '--json'],
]) {
  assertExit(args, 2, `${args.join(' ')} 裸通道组合应 E_USAGE(2)`);
}
console.log('✓ 裸通道组合在进入业务逻辑前被拒绝');

for (const args of [
  ['status', 'nope'],
  ['config', 'get', 'nope', 'port'],
]) {
  assertExit(args, 2, `${args.join(' ')} 未知通道应 E_USAGE(2) 而非 E_CONFIG`);
}
for (const args of [
  ['status', '--as', 'paid'],
  ['config', 'get', 'system', 'project.name', '--as', 'paid'],
  ['scan', '--as', 'paid'],
]) {
  assertExit(args, 2, `${args.join(' ')} 不支持 --as 时应 E_USAGE(2)`);
}
console.log('✓ raw/none 命令的通道错误和 --as 误用均 E_USAGE');

for (const args of [
  ['cycle', '--rounds', 'abc'],
  ['monitor', '--seconds', 'abc'],
  ['reconcile', '--grace-min', 'abc'],
]) {
  assertExit(args, 2, `${args.join(' ')} 应 E_USAGE(2)`);
}
console.log('✓ cycle/monitor/reconcile 数字参数非法值均 E_USAGE');

{
  const ch = join(ROOT, 'channels', 'jie3.json');
  const before = sha(ch);
  assertExit(['login', '--email', 'a@example.com', '--pwd', 'pw', '--free-aavid', '1', '--free-plan', '2', '--free-port', 'abc'], 2, 'login 非法 port 应 E_USAGE(2)');
  assert.strictEqual(sha(ch), before, 'login 非法 port 不应写 channels/jie3.json');
  assertExit(['login', '--email', 'a@example.com', '--pwd', 'pw', '--free-aavid', '1', '--free-plan', '2', '--free-max', 'abc'], 2, 'login 非法 maxUploads 应 E_USAGE(2)');
  assert.strictEqual(sha(ch), before, 'login 非法 maxUploads 不应写 channels/jie3.json');
  console.log('✓ login 非法 port/maxUploads 写前拒绝且不改配置');
}

{
  const ch = join(ROOT, 'channels', 'jie3.json');
  const before = sha(ch);
  assertExit(['config', 'set', 'free', 'port', '70000', '--apply'], 2, 'config set 非法 port 应 E_USAGE(2)');
  assert.strictEqual(sha(ch), before, 'config set 非法 port 不应写 channels/jie3.json');
  assertExit(['config', 'set', 'free', 'maxUploads', '0', '--apply'], 2, 'config set 非法 maxUploads 应 E_USAGE(2)');
  assert.strictEqual(sha(ch), before, 'config set 非法 maxUploads 不应写 channels/jie3.json');
  console.log('✓ config set 非法 port/maxUploads 写前拒绝且不改配置');
}

console.log('\ncli-behavior 全部通过 ✓');
