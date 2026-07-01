import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

export const DEFAULT_UNLOCK_MINUTES = 120;
export const ALL_DAY_UNLOCK_MINUTES = 24 * 60;
export const AUDIENCE = 'weilai-01';
export const TOKEN_PREFIX = 'wl1';

export function authErr(code, msg) { return Object.assign(new Error(msg), { code }); }
export function nowMs() { return Date.now(); }
export function b64urlDecode(s) { return Buffer.from(String(s), 'base64url'); }
export function sha256(s) { return createHash('sha256').update(String(s)).digest('hex'); }

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

export function localMachineHash() {
  let user = '';
  try { user = userInfo().username || ''; } catch (e) {}
  return sha256([process.platform, hostname(), user].join('|')).slice(0, 32);
}

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return null; }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

export function removeFile(path) {
  if (existsSync(path)) rmSync(path, { force: true });
}

export function pathExists(path) {
  return existsSync(path);
}
