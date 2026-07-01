import { authPaths, localMachineHash, pathExists } from './shared.mjs';
import { authSummary, authorize, installAuthToken, loadAuthToken, verifyAuthToken } from './token.mjs';
import { clearUnlockSession, createUnlockSession, parseUnlockMinutes, sessionStatus } from './session.mjs';
import { declaredSecrets, maskSecret, resolveSecret } from './secrets.mjs';

export {
  ALL_DAY_UNLOCK_MINUTES,
  DEFAULT_UNLOCK_MINUTES,
  authPaths,
  localMachineHash,
} from './shared.mjs';
export { authSummary, authorize, installAuthToken, verifyAuthToken } from './token.mjs';
export { clearUnlockSession, createUnlockSession, parseUnlockMinutes } from './session.mjs';
export { declaredSecrets, maskSecret, resolveSecret } from './secrets.mjs';

export function authStatus({ feature = null, requireSession = false } = {}) {
  const paths = authPaths();
  const result = {
    licenseInstalled: pathExists(paths.license),
    authorized: false,
    unlocked: false,
    authDir: paths.dir,
    machine: localMachineHash(),
    reason: null,
    license: null,
    session: null,
    secrets: [],
  };
  let verified;
  try {
    verified = loadAuthToken(feature);
    result.authorized = true;
    result.license = authSummary(verified);
    result.secrets = result.license.secrets;
  } catch (e) {
    result.reason = e.message;
    return result;
  }
  const ss = sessionStatus(verified);
  result.unlocked = ss.unlocked;
  result.session = ss.session;
  if (requireSession && !ss.unlocked) result.reason = ss.reason;
  return result;
}

export function supervisorAuthStatus(requiredFeature = 'paid.write') {
  const st = authStatus({ feature: requiredFeature, requireSession: true });
  if (st.reason) st.reason = st.reason.replace('未安装授权 token：先运行 auth install-token <token>', '未安装主管 token：先运行 supervisor install-token <token>');
  return st;
}

export function supervisorUnlocked(requiredFeature = 'paid.write') {
  return supervisorAuthStatus(requiredFeature).unlocked;
}

export function installLicenseToken(token) {
  return installAuthToken(token);
}

export function verifyLicenseToken(token, opts = {}) {
  return verifyAuthToken(token, opts);
}

export function licenseSummary(verified) {
  return authSummary(verified);
}
