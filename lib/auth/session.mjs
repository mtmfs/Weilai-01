import {
  ALL_DAY_UNLOCK_MINUTES,
  DEFAULT_UNLOCK_MINUTES,
  authErr,
  authPaths,
  nowMs,
  readJson,
  removeFile,
  writeJson,
} from './shared.mjs';
import { authSummary, loadAuthToken } from './token.mjs';

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
    throw authErr('E_USAGE', `--for 只能是 1..1440 分钟、Nm、Nh 或 all-day，得到「${raw}」`);
  }
  return { minutes, mode: minutes === ALL_DAY_UNLOCK_MINUTES ? 'all-day' : 'temporary' };
}

export function createUnlockSession(flags = {}) {
  const verified = loadAuthToken('paid.write');
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
  return { ...authSummary(verified), mode, minutes, unlockedAt: new Date(unlockedAt).toISOString(), sessionExpiresAt: new Date(expiresAt).toISOString() };
}

export function clearUnlockSession() {
  removeFile(authPaths().session);
}

export function readUnlockSession() {
  return readJson(authPaths().session);
}

export function sessionStatus(verified) {
  const session = readUnlockSession();
  if (!session) return { unlocked: false, session: null, reason: '主管 session 未解锁' };
  if (session.tokenHash !== verified.tokenHash) return { unlocked: false, session, reason: '主管 session 与当前 token 不匹配' };
  const expiresAt = Date.parse(session.expiresAt || '');
  if (!expiresAt || expiresAt <= nowMs()) return { unlocked: false, session, reason: '主管 session 已过期' };
  return { unlocked: true, session, reason: null };
}
