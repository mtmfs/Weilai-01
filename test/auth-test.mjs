import assert from 'node:assert';
import { generateKeyPairSync, sign } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installAuthToken, resolveSecret } from '../lib/auth/index.mjs';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const TEST_AUTH_DIR = join(ROOT, 'test-out', 'auth-api');
rmSync(TEST_AUTH_DIR, { recursive: true, force: true });

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
process.env.WEILAI_AUTH_DIR = TEST_AUTH_DIR;
process.env.WEILAI_LICENSE_PUBLIC_KEY_DER_B64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
process.env.WEILAI_LICENSE_PUBLIC_KEY = '';

function signedToken(claims = {}) {
  const payloadB64 = Buffer.from(JSON.stringify({
    iss: 'test',
    aud: 'weilai-01',
    sub: 'team:api-test',
    features: ['api.openai'],
    secrets: ['openai.apiKey'],
    exp: Math.floor(Date.now() / 1000) + 24 * 3600,
    ...claims,
  })).toString('base64url');
  const sig = sign(null, Buffer.from(payloadB64), privateKey).toString('base64url');
  return `wl1.${payloadB64}.${sig}`;
}

installAuthToken(signedToken());
process.env.WEILAI_OPENAI_API_KEY = 'sk-internal-plaintext-123456';
process.env.OPENAI_API_KEY = '';

const masked = resolveSecret('openai.apiKey');
assert.strictEqual(masked.value, undefined, '默认 resolveSecret 不应返回明文');
assert.ok(masked.masked && masked.masked !== process.env.WEILAI_OPENAI_API_KEY, '默认 resolveSecret 应返回 masked');

const plain = resolveSecret('openai.apiKey', { allowPlaintext: true });
assert.strictEqual(plain.value, process.env.WEILAI_OPENAI_API_KEY, 'allowPlaintext=true 时内部 API 可取明文');

console.log('auth API 全部通过 ✓');
