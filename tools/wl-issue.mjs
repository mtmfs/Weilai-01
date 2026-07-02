// tools/wl-issue.mjs —— 一键签发授权令牌（需签发私钥）。★签发侧工具，不入分发包。
// 用法：
//   node tools/wl-issue.mjs --key ./keys/wl-issuer-private.pem --machine <客户机器码> --sub "supervisor:机器A" --days 365
//   node tools/wl-issue.mjs --key ... --machine <码> --features "*" --secrets "*" --days 3650      # 0 号令牌
//   node tools/wl-issue.mjs --key ... --any --features paid.write,paid.read --days 90               # 不绑机器(慎用)
// 客户机器码来自：weilai auth status 的“本机码”。
import { readFileSync } from 'node:fs';
import { createPrivateKey, sign } from 'node:crypto';
import { encryptSecret } from '../lib/auth/keyenc.mjs';

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : def; }
const has = (name) => process.argv.includes('--' + name);

const keyPath = arg('key');
if (!keyPath) { console.error('必须 --key <私钥pem>'); process.exit(2); }
let priv;
try { priv = createPrivateKey(readFileSync(keyPath, 'utf8')); }
catch (e) { console.error('读取/解析私钥失败：' + e.message); process.exit(2); }

const days = Number(arg('days', '365'));
if (!Number.isFinite(days) || days <= 0) { console.error('--days 必须是正数'); process.exit(2); }
const now = Math.floor(Date.now() / 1000);
const csv = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

const payload = {
  iss: arg('iss', 'weilai-issuer'),
  aud: 'weilai-01',
  sub: arg('sub', 'supervisor'),
  features: csv(arg('features', '*')),
  secrets: csv(arg('secrets', '*')),
  nbf: now - 60,
  exp: now + days * 86400,
};
const machine = arg('machine');
if (machine) payload.machine = machine;
else if (!has('any')) { console.error('必须 --machine <客户机器码>（防复制扩散），或显式 --any 签任意机器令牌'); process.exit(2); }

// 方案 B：--api-openai <key> 把 API key 用内置口令加密后埋进 encKeys（客户端解密用）。
const apiOpenai = arg('api-openai');
if (apiOpenai) payload.encKeys = { 'openai.apiKey': encryptSecret(apiOpenai) };

const pb = Buffer.from(JSON.stringify(payload)).toString('base64url');
const sig = sign(null, Buffer.from(pb), priv).toString('base64url');
const token = 'wl1.' + pb + '.' + sig;

console.log('sub      :', payload.sub);
console.log('features :', JSON.stringify(payload.features), '| secrets:', JSON.stringify(payload.secrets));
console.log('machine  :', payload.machine || '(任意机器)');
console.log('生效/过期:', new Date(payload.nbf * 1000).toISOString(), '→', new Date(payload.exp * 1000).toISOString());
console.log('\n=== 令牌（交客户：weilai auth install-token <令牌>）===\n' + token);
