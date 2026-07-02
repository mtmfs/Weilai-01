// tools/wl-keygen.mjs —— 生成签发密钥对（Ed25519）。私钥留你手里、公钥内置进分发版。
// ★签发侧工具，不入分发包（dist audit 排除 tools/）。跑：node tools/wl-keygen.mjs ./keys
import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] || '.';
mkdirSync(out, { recursive: true });
const { publicKey, privateKey } = generateKeyPairSync('ed25519');

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const pubDerB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

writeFileSync(join(out, 'wl-issuer-private.pem'), privPem, { mode: 0o600 });
writeFileSync(join(out, 'wl-issuer-public.der.b64.txt'), pubDerB64 + '\n');
console.log('私钥 →', join(out, 'wl-issuer-private.pem'), '（离线保管，绝不外泄/入库/交 AI）');
console.log('公钥 →', join(out, 'wl-issuer-public.der.b64.txt'), '（交维护者内置 EMBEDDED_PUBLIC_KEYS）');
console.log('\n=== 内置用公钥串（DER b64，把这一行给维护者）===\n' + pubDerB64);
