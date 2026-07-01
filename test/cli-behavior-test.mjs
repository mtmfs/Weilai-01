// 离线 CLI 行为测试：命令分发、数字参数校验、login 写前校验。
// 跑：node test/cli-behavior-test.mjs
import assert from 'node:assert';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const NODE = process.execPath;
const CLI = join(ROOT, 'bin', 'weilai.mjs');
const TEST_AUTH_DIR = join(ROOT, 'test-out', 'auth-cli-behavior');
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
  'run-paid',
  'run-both',
  'cycle-paid',
  'delete-paid',
];

rmSync(TEST_AUTH_DIR, { recursive: true, force: true });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const LICENSE_ENV = {
  WEILAI_LICENSE_PUBLIC_KEY_DER_B64: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
};

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}
function signedToken(claims = {}) {
  const payloadB64 = b64urlJson({
    iss: 'test',
    aud: 'weilai-01',
    sub: 'team:test',
    features: ['paid.*'],
    exp: Math.floor(Date.now() / 1000) + 24 * 3600,
    ...claims,
  });
  const sig = sign(null, Buffer.from(payloadB64), privateKey).toString('base64url');
  return `wl1.${payloadB64}.${sig}`;
}

function run(args, env = {}) {
  const baseEnv = {
    ...process.env,
    WEILAI_AUTH_DIR: TEST_AUTH_DIR,
    WEILAI_SUPERVISOR: '',
    WEILAI_LICENSE_PUBLIC_KEY: '',
    WEILAI_LICENSE_PUBLIC_KEY_DER_B64: '',
    WEILAI_OPENAI_API_KEY: '',
    OPENAI_API_KEY: '',
  };
  return spawnSync(NODE, [CLI, ...args], {
    cwd: ROOT,
    env: { ...baseEnv, ...env },
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

{
  let r = assertExit(['supervisor', 'status', '--json'], 0, 'supervisor status 无 token 应成功返回锁定状态');
  let st = JSON.parse(r.stdout);
  assert.strictEqual(st.unlocked, false, '无 token 时不应解锁');
  assert.ok(st.reason.includes('未安装主管 token'), '无 token 应提示未安装');

  assertExit(['supervisor', 'unlock', '--json'], 2, '无 token 时 supervisor unlock 应失败');
  assertExit(['supervisor', 'install-token', 'bad-token', '--json'], 2, '坏 token 应拒绝', LICENSE_ENV);

  const token = signedToken();
  r = assertExit(['supervisor', 'install-token', token, '--json'], 0, '有效 token 应可安装', LICENSE_ENV);
  let installed = JSON.parse(r.stdout);
  assert.strictEqual(installed.installed, true, 'install-token 应返回 installed=true');
  assert.strictEqual(installed.license.subject, 'team:test', 'install-token 应读出 subject');

  r = assertExit(['supervisor', 'unlock', '--json'], 0, 'supervisor unlock 默认应成功', LICENSE_ENV);
  let unlocked = JSON.parse(r.stdout);
  assert.strictEqual(unlocked.session.minutes, 120, '默认临时解锁应为 120 分钟');
  assert.strictEqual(unlocked.session.mode, 'temporary', '默认临时解锁 mode 应为 temporary');

  r = assertExit(['supervisor', 'status', '--json'], 0, 'unlock 后 status 应成功', LICENSE_ENV);
  st = JSON.parse(r.stdout);
  assert.strictEqual(st.unlocked, true, 'unlock 后应解锁');

  r = assertExit(['hold-submit', '--as', 'paid', '--delay-min', 'abc', '--json'], 2, '解锁后 paid 命令应进入业务参数校验', LICENSE_ENV);
  assert.ok(r.stderr.includes('--delay-min'), '解锁后应看到 hold-submit 参数错误，而不是主管锁错误');

  r = assertExit(['supervisor', 'unlock', '--all-day', '--json'], 0, 'supervisor unlock --all-day 应成功', LICENSE_ENV);
  unlocked = JSON.parse(r.stdout);
  assert.strictEqual(unlocked.session.minutes, 1440, '全天解锁应为 1440 分钟');
  assert.strictEqual(unlocked.session.mode, 'all-day', '全天解锁 mode 应为 all-day');
  assertExit(['supervisor', 'unlock', '--for', '25h', '--json'], 2, 'supervisor unlock --for 25h 应拒绝超过 24 小时', LICENSE_ENV);

  assertExit(['supervisor', 'lock', '--json'], 0, 'supervisor lock 应成功', LICENSE_ENV);
  r = assertExit(['hold-submit', '--as', 'paid', '--delay-min', 'abc', '--json'], 2, 'lock 后 paid 命令应重新被锁', LICENSE_ENV);
  assert.ok(r.stderr.includes('默认锁定'), 'lock 后应回到主管锁错误');

  const writeOnlyToken = signedToken({ features: ['paid.write'] });
  assertExit(['supervisor', 'install-token', writeOnlyToken, '--json'], 0, 'paid.write token 应可安装', LICENSE_ENV);
  assertExit(['supervisor', 'unlock', '--json'], 0, 'paid.write token 应可解锁普通 paid 写操作', LICENSE_ENV);
  r = assertExit(['delete-paid', '--apply', '--json'], 2, 'delete-paid --apply 应要求 paid.delete 权限', LICENSE_ENV);
  assert.ok(r.stderr.includes('paid.delete'), 'delete-paid --apply 应提示缺少 paid.delete 权限');
  console.log('✓ supervisor token + 默认120分钟/全天解锁/手动上锁符合预期');
}

{
  const now = Math.floor(Date.now() / 1000);
  assertExit(['auth', 'install-token', signedToken({ exp: now - 10 }), '--json'], 2, '过期 auth token 应拒绝', LICENSE_ENV);
  assertExit(['auth', 'install-token', signedToken({ aud: 'other-aud' }), '--json'], 2, 'aud 不匹配 auth token 应拒绝', LICENSE_ENV);
  assertExit(['auth', 'install-token', signedToken({ nbf: now + 3600 }), '--json'], 2, 'nbf 未生效 auth token 应拒绝', LICENSE_ENV);

  const apiToken = signedToken({ features: ['api.openai'], secrets: ['openai.apiKey'] });
  let r = assertExit(['auth', 'install-token', apiToken, '--json'], 0, 'auth install-token 应安装 api token', LICENSE_ENV);
  let installed = JSON.parse(r.stdout);
  assert.ok(installed.license.features.includes('api.openai'), 'auth install-token 应保留 api.openai 权限');
  assert.ok(installed.license.secrets.includes('openai.apiKey'), 'auth install-token 应保留 secret 声明');

  r = assertExit(['auth', 'status', '--json'], 0, 'auth status 应返回授权状态', LICENSE_ENV);
  let st = JSON.parse(r.stdout);
  assert.strictEqual(st.authorized, true, 'auth status 应 authorized=true');
  assert.ok(st.secrets.includes('openai.apiKey'), 'auth status 应显示 secret 摘要');

  r = assertExit(['auth', 'secrets', '--json'], 0, 'auth secrets 应列出声明 secret', LICENSE_ENV);
  let secrets = JSON.parse(r.stdout);
  assert.strictEqual(secrets.secrets[0].name, 'openai.apiKey', 'auth secrets 应列 openai.apiKey');
  assert.strictEqual(secrets.secrets[0].configured, false, '未设 BYOK 时 configured=false');

  assertExit(['auth', 'resolve', 'openai.apiKey', '--json'], 20, '未设 BYOK 时 auth resolve 应 E_CONFIG', LICENSE_ENV);

  const rawKey = 'sk-test-abcdef1234567890';
  r = assertExit(['auth', 'resolve', 'openai.apiKey', '--json'], 0, '设置 BYOK 后 auth resolve 应成功', { ...LICENSE_ENV, WEILAI_OPENAI_API_KEY: rawKey });
  const resolved = JSON.parse(r.stdout);
  assert.strictEqual(resolved.secret.name, 'openai.apiKey', 'auth resolve 应返回 secret 名');
  assert.strictEqual(resolved.secret.source, 'WEILAI_OPENAI_API_KEY', 'auth resolve 应返回 BYOK 来源');
  assert.ok(resolved.secret.masked && !resolved.secret.value, 'CLI JSON 不应返回明文 value');
  assert.ok(!r.stdout.includes(rawKey), 'CLI 输出不应包含完整 API key');

  const noSecretToken = signedToken({ features: ['api.openai'], secrets: [] });
  assertExit(['auth', 'install-token', noSecretToken, '--json'], 0, '无 secret 声明 token 可安装', LICENSE_ENV);
  r = assertExit(['auth', 'resolve', 'openai.apiKey', '--json'], 2, '缺少 secret 声明应 E_USAGE', { ...LICENSE_ENV, WEILAI_OPENAI_API_KEY: rawKey });
  assert.ok(r.stderr.includes('未声明 secret'), '缺少 secret 声明应说明原因');

  const noApiToken = signedToken({ features: ['paid.write'], secrets: ['openai.apiKey'] });
  assertExit(['auth', 'install-token', noApiToken, '--json'], 0, '无 api.openai 权限 token 可安装', LICENSE_ENV);
  r = assertExit(['auth', 'resolve', 'openai.apiKey', '--json'], 2, '缺少 api.openai 权限应 E_USAGE', { ...LICENSE_ENV, WEILAI_OPENAI_API_KEY: rawKey });
  assert.ok(r.stderr.includes('api.openai'), '缺少 api.openai 权限应说明原因');

  assertExit(['supervisor', 'status', '--json'], 0, 'supervisor 兼容入口仍应可用', LICENSE_ENV);
  console.log('✓ auth token 验签 / secrets / BYOK masked 解析符合预期');
}

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
