import { createPublicKey, verify } from 'node:crypto';
import {
  AUDIENCE,
  TOKEN_PREFIX,
  authErr,
  authPaths,
  b64urlDecode,
  localMachineHash,
  nowMs,
  readJson,
  sha256,
  writeJson,
} from './shared.mjs';

// ★分发时填入签发方公钥（DER SPKI base64，wl-keygen 产出）。非空 ⟹ 只认内置、彻底忽略 env（分发版不可自签）；
//   空 ⟹ 回退 env（本机开发/测试用，cli-behavior/auth-test 靠 env 注入公钥自签、保持绿）。
// 已登记待内置的签发公钥（分发打包时焊入下方数组；勿在源码直接填，否则本机 env 自签测试会失效）：
//   weilai-issuer: MCowBQYDK2VwAyEAkWys1vMb3V7INqFeC/OwiOWeoTX1658bU5fcWMLxagg=
const EMBEDDED_PUBLIC_KEYS = [];

function publicKeys() {
  // ★分发版：内置非空 → 只认内置公钥、忽略 env（根除自签后门）
  const embedded = [];
  for (const k of EMBEDDED_PUBLIC_KEYS) {
    try { embedded.push(createPublicKey({ key: Buffer.from(k, 'base64'), format: 'der', type: 'spki' })); }
    catch (e) { throw authErr('E_CONFIG', `内置公钥无法解析：${e.message}`); }
  }
  if (embedded.length) return embedded;
  // 开发/测试：无内置公钥时才回退 env（本机自签测试）
  const keys = [];
  const der = process.env.WEILAI_LICENSE_PUBLIC_KEY_DER_B64;
  if (der) {
    try { keys.push(createPublicKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'spki' })); }
    catch (e) { throw authErr('E_CONFIG', `WEILAI_LICENSE_PUBLIC_KEY_DER_B64 无法解析：${e.message}`); }
  }
  const pem = process.env.WEILAI_LICENSE_PUBLIC_KEY;
  if (pem) {
    try { keys.push(createPublicKey(pem.replace(/\\n/g, '\n'))); }
    catch (e) { throw authErr('E_CONFIG', `WEILAI_LICENSE_PUBLIC_KEY 无法解析：${e.message}`); }
  }
  return keys;
}

function parseToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) throw authErr('E_USAGE', `授权 token 格式应为 ${TOKEN_PREFIX}.<payload>.<signature>`);
  let payload;
  try { payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8')); }
  catch (e) { throw authErr('E_USAGE', `授权 token payload 无法解析：${e.message}`); }
  return { raw, payloadB64: parts[1], signature: b64urlDecode(parts[2]), payload };
}

function hasAudience(aud) {
  if (Array.isArray(aud)) return aud.includes(AUDIENCE);
  return aud === AUDIENCE;
}

export function timeMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value * 1000;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

export function featureAllowed(features = [], required = null) {
  if (!required) return true;
  if (!Array.isArray(features)) return false;
  const group = String(required).split('.')[0];
  return features.includes('*') ||
    features.includes('supervisor') ||
    features.includes(`${group}.*`) ||
    features.includes(required);
}

export function secretAllowed(secrets = [], name) {
  if (!name) return true;
  if (!Array.isArray(secrets)) return false;
  const group = String(name).split('.')[0];
  return secrets.includes('*') ||
    secrets.includes(`${group}.*`) ||
    secrets.includes(name);
}

function validateClaims(payload, { requiredFeature = null, at = nowMs() } = {}) {
  if (!hasAudience(payload.aud)) throw authErr('E_USAGE', `授权 token aud 不匹配，应为 ${AUDIENCE}`);
  const exp = timeMs(payload.exp);
  if (!exp) throw authErr('E_USAGE', '授权 token 缺少有效 exp');
  if (exp <= at) throw authErr('E_USAGE', `授权 token 已过期：${new Date(exp).toISOString()}`);
  const nbf = timeMs(payload.nbf);
  if (nbf && nbf > at) throw authErr('E_USAGE', `授权 token 尚未生效：${new Date(nbf).toISOString()}`);
  if (payload.machine && payload.machine !== localMachineHash()) throw authErr('E_USAGE', '授权 token 未绑定本机');
  if (!featureAllowed(payload.features, requiredFeature)) throw authErr('E_USAGE', `授权 token 缺少权限：${requiredFeature}`);
}

export function verifyAuthToken(token, opts = {}) {
  const parsed = parseToken(token);
  const keys = publicKeys();
  if (!keys.length) throw authErr('E_CONFIG', '未配置授权 token 公钥（WEILAI_LICENSE_PUBLIC_KEY_DER_B64 或内置公钥）');
  const data = Buffer.from(parsed.payloadB64);
  const ok = keys.some((key) => {
    try { return verify(null, data, key, parsed.signature); }
    catch (e) { return false; }
  });
  if (!ok) throw authErr('E_USAGE', '授权 token 签名无效');
  validateClaims(parsed.payload, opts);
  return {
    token: parsed.raw,
    tokenHash: sha256(parsed.raw),
    payload: parsed.payload,
  };
}

export function installAuthToken(token) {
  const verified = verifyAuthToken(token);
  const paths = authPaths();
  writeJson(paths.license, {
    version: 1,
    token: verified.token,
    tokenHash: verified.tokenHash,
    installedAt: new Date().toISOString(),
  });
  return authSummary(verified);
}

export function loadAuthToken(requiredFeature = null) {
  const data = readJson(authPaths().license);
  if (!data || !data.token) throw authErr('E_USAGE', '未安装授权 token：先运行 auth install-token <token>');
  return verifyAuthToken(data.token, { requiredFeature });
}

export function authSummary(verified) {
  const p = verified.payload;
  return {
    subject: p.sub || null,
    issuer: p.iss || null,
    audience: p.aud,
    features: Array.isArray(p.features) ? p.features : [],
    secrets: Array.isArray(p.secrets) ? p.secrets : [],
    expiresAt: new Date(timeMs(p.exp)).toISOString(),
    machine: p.machine || null,
    tokenHash: verified.tokenHash.slice(0, 12),
  };
}

export function authorize(feature) {
  const verified = loadAuthToken(feature);
  return { ok: true, license: authSummary(verified) };
}
