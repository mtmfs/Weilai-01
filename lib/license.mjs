import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_UNLOCK_MINUTES = 120;
export const ALL_DAY_UNLOCK_MINUTES = 24 * 60;
const AUDIENCE = 'weilai-01';
const TOKEN_PREFIX = 'wl1';
const EMBEDDED_PUBLIC_KEYS = [];

function authDir() {
  if (process.env.WEILAI_AUTH_DIR) return process.env.WEILAI_AUTH_DIR;
  const base = process.env.LOCALAPPDATA || join(homedir(), '.weilai');
  return join(base, 'Weilai-01');
}

export function authPaths() {
  const dir = authDir();
  return {
    dir,
    license: join(dir, 'license.json'),
    session: join(dir, 'supervisor-session.json'),
  };
}

function err(code, msg) { return Object.assign(new Error(msg), { code }); }
function nowMs() { return Date.now(); }
function b64urlDecode(s) { return Buffer.from(String(s), 'base64url'); }
function sha256(s) { return createHash('sha256').update(String(s)).digest('hex'); }

export function localMachineHash() {
  let user = '';
  try { user = userInfo().username || ''; } catch (e) {}
  return sha256([process.platform, hostname(), user].join('|')).slice(0, 32);
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return null; }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

function publicKeys() {
  const keys = [];
  const der = process.env.WEILAI_LICENSE_PUBLIC_KEY_DER_B64;
  if (der) {
    try { keys.push(createPublicKey({ key: Buffer.from(der, 'base64'), format: 'der', type: 'spki' })); }
    catch (e) { throw err('E_CONFIG', `WEILAI_LICENSE_PUBLIC_KEY_DER_B64 无法解析：${e.message}`); }
  }
  const pem = process.env.WEILAI_LICENSE_PUBLIC_KEY;
  if (pem) {
    try { keys.push(createPublicKey(pem.replace(/\\n/g, '\n'))); }
    catch (e) { throw err('E_CONFIG', `WEILAI_LICENSE_PUBLIC_KEY 无法解析：${e.message}`); }
  }
  for (const k of EMBEDDED_PUBLIC_KEYS) {
    try { keys.push(createPublicKey(k)); }
    catch (e) {}
  }
  return keys;
}

function parseToken(token) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) throw err('E_USAGE', '主管 token 格式应为 wl1.<payload>.<signature>');
  let payload;
  try { payload = JSON.parse(b64urlDecode(parts[1]).toString('utf8')); }
  catch (e) { throw err('E_USAGE', `主管 token payload 无法解析：${e.message}`); }
  return { raw, payloadB64: parts[1], signature: b64urlDecode(parts[2]), payload };
}

function hasAudience(aud) {
  if (Array.isArray(aud)) return aud.includes(AUDIENCE);
  return aud === AUDIENCE;
}

function timeMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value * 1000;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
}

function featureAllowed(features = [], required = 'paid.write') {
  if (!Array.isArray(features)) return false;
  return features.includes('*') ||
    features.includes('supervisor') ||
    features.includes('paid.*') ||
    features.includes(required);
}

function validateClaims(payload, { requiredFeature = 'paid.write', at = nowMs() } = {}) {
  if (!hasAudience(payload.aud)) throw err('E_USAGE', `主管 token aud 不匹配，应为 ${AUDIENCE}`);
  const exp = timeMs(payload.exp);
  if (!exp) throw err('E_USAGE', '主管 token 缺少有效 exp');
  if (exp <= at) throw err('E_USAGE', `主管 token 已过期：${new Date(exp).toISOString()}`);
  const nbf = timeMs(payload.nbf);
  if (nbf && nbf > at) throw err('E_USAGE', `主管 token 尚未生效：${new Date(nbf).toISOString()}`);
  if (payload.machine && payload.machine !== localMachineHash()) throw err('E_USAGE', '主管 token 未绑定本机');
  if (!featureAllowed(payload.features, requiredFeature)) throw err('E_USAGE', `主管 token 缺少权限：${requiredFeature}`);
}

export function verifyLicenseToken(token, opts = {}) {
  const parsed = parseToken(token);
  const keys = publicKeys();
  if (!keys.length) throw err('E_CONFIG', '未配置主管 token 公钥（WEILAI_LICENSE_PUBLIC_KEY_DER_B64 或内置公钥）');
  const data = Buffer.from(parsed.payloadB64);
  const ok = keys.some((key) => {
    try { return verify(null, data, key, parsed.signature); }
    catch (e) { return false; }
  });
  if (!ok) throw err('E_USAGE', '主管 token 签名无效');
  validateClaims(parsed.payload, opts);
  return {
    token: parsed.raw,
    tokenHash: sha256(parsed.raw),
    payload: parsed.payload,
  };
}

export function installLicenseToken(token) {
  const verified = verifyLicenseToken(token, { requiredFeature: 'paid.write' });
  const paths = authPaths();
  writeJson(paths.license, {
    version: 1,
    token: verified.token,
    tokenHash: verified.tokenHash,
    installedAt: new Date().toISOString(),
  });
  return licenseSummary(verified);
}

function loadLicense(requiredFeature = 'paid.write') {
  const data = readJson(authPaths().license);
  if (!data || !data.token) throw err('E_USAGE', '未安装主管 token：先运行 supervisor install-token <token>');
  return verifyLicenseToken(data.token, { requiredFeature });
}

export function licenseSummary(verified) {
  const p = verified.payload;
  return {
    subject: p.sub || null,
    issuer: p.iss || null,
    audience: p.aud,
    features: Array.isArray(p.features) ? p.features : [],
    expiresAt: new Date(timeMs(p.exp)).toISOString(),
    machine: p.machine || null,
    tokenHash: verified.tokenHash.slice(0, 12),
  };
}

export function parseUnlockMinutes(flags = {}) {
  if (flags['all-day']) return { minutes: ALL_DAY_UNLOCK_MINUTES, mode: 'all-day' };
  const raw = flags.for == null ? `${DEFAULT_UNLOCK_MINUTES}` : String(flags.for).trim().toLowerCase();
  if (raw === 'all-day' || raw === 'allday' || raw === 'day') return { minutes: ALL_DAY_UNLOCK_MINUTES, mode: 'all-day' };
  let minutes = null;
  let m = raw.match(/^([1-9]\d*)$/);
  if (m) minutes = Number(m[1]);
  m = raw.match(/^([1-9]\d*)m$/);
  if (m) minutes = Number(m[1]);
  m = raw.match(/^([1-9]\d*)h$/);
  if (m) minutes = Number(m[1]) * 60;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > ALL_DAY_UNLOCK_MINUTES) {
    throw err('E_USAGE', `--for 只能是 1..1440 分钟、Nm、Nh 或 all-day，得到「${raw}」`);
  }
  return { minutes, mode: minutes === ALL_DAY_UNLOCK_MINUTES ? 'all-day' : 'temporary' };
}

export function createUnlockSession(flags = {}) {
  const verified = loadLicense('paid.write');
  const { minutes, mode } = parseUnlockMinutes(flags);
  const unlockedAt = nowMs();
  const expiresAt = unlockedAt + minutes * 60 * 1000;
  writeJson(authPaths().session, {
    version: 1,
    tokenHash: verified.tokenHash,
    mode,
    unlockedAt: new Date(unlockedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
  });
  return { ...licenseSummary(verified), mode, minutes, unlockedAt: new Date(unlockedAt).toISOString(), sessionExpiresAt: new Date(expiresAt).toISOString() };
}

export function clearUnlockSession() {
  const p = authPaths().session;
  if (existsSync(p)) rmSync(p, { force: true });
}

export function supervisorAuthStatus(requiredFeature = 'paid.write') {
  const paths = authPaths();
  const result = {
    licenseInstalled: existsSync(paths.license),
    unlocked: false,
    authDir: paths.dir,
    machine: localMachineHash(),
    reason: null,
    license: null,
    session: null,
  };
  let verified;
  try {
    verified = loadLicense(requiredFeature);
    result.license = licenseSummary(verified);
  } catch (e) {
    result.reason = e.message;
    return result;
  }
  const session = readJson(paths.session);
  if (!session) { result.reason = '主管 session 未解锁'; return result; }
  result.session = session;
  if (session.tokenHash !== verified.tokenHash) { result.reason = '主管 session 与当前 token 不匹配'; return result; }
  const expiresAt = Date.parse(session.expiresAt || '');
  if (!expiresAt || expiresAt <= nowMs()) { result.reason = '主管 session 已过期'; return result; }
  result.unlocked = true;
  result.reason = null;
  return result;
}

export function supervisorUnlocked(requiredFeature = 'paid.write') {
  return supervisorAuthStatus(requiredFeature).unlocked;
}
