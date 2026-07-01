import {
  authPaths,
  clearUnlockSession,
  createUnlockSession,
  installLicenseToken,
  supervisorAuthStatus,
} from '../../lib/license.mjs';
import { log, out, writeText } from '../../lib/log.mjs';

function usageErr(msg) { const e = new Error(msg); e.code = 'E_USAGE'; throw e; }

function printStatus(status) {
  const lines = [
    `主管锁：${status.unlocked ? '已解锁' : '锁定'}`,
    `本机码：${status.machine}`,
    `授权目录：${status.authDir}`,
  ];
  if (status.license) {
    lines.push(`token：${status.license.subject || '(no-sub)'} · 到期 ${status.license.expiresAt}`);
    lines.push(`权限：${status.license.features.join(', ') || '(none)'}`);
  } else {
    lines.push(`token：未安装`);
  }
  if (status.session) lines.push(`session：${status.session.mode || 'temporary'} · 到期 ${status.session.expiresAt}`);
  if (status.reason) lines.push(`原因：${status.reason}`);
  writeText(lines.join('\n'));
}

export async function runSupervisor({ flags, pos }) {
  const action = pos[0];
  if (action === 'install-token') {
    const token = pos[1];
    if (!token) usageErr('用法: weilai supervisor install-token <token> [--json]');
    const license = installLicenseToken(token);
    clearUnlockSession();
    if (flags.json) out({ command: 'supervisor', action: 'install-token', installed: true, license, paths: authPaths() });
    else {
      log.ok(`主管 token 已安装：${license.subject || '(no-sub)'}，到期 ${license.expiresAt}`);
      log.info('已清除旧主管 session；需要 paid 时运行 `weilai supervisor unlock`。');
    }
    return;
  }
  if (action === 'unlock') {
    const session = createUnlockSession(flags);
    if (flags.json) out({ command: 'supervisor', action: 'unlock', unlocked: true, session });
    else log.ok(`主管锁已解锁 ${session.minutes} 分钟（${session.mode}），到期 ${session.sessionExpiresAt}`);
    return;
  }
  if (action === 'lock') {
    clearUnlockSession();
    if (flags.json) out({ command: 'supervisor', action: 'lock', unlocked: false });
    else log.ok('主管锁已手动上锁。');
    return;
  }
  if (action === 'status') {
    const status = supervisorAuthStatus();
    if (flags.json) out({ command: 'supervisor', action: 'status', ...status });
    else printStatus(status);
    return;
  }
  usageErr('用法: weilai supervisor <status|install-token|unlock|lock> [--for 120|2h|all-day] [--all-day] [--json]');
}
