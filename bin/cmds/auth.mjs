import {
  authPaths,
  authStatus,
  clearUnlockSession,
  createUnlockSession,
  declaredSecrets,
  installAuthToken,
  resolveSecret,
  supervisorAuthStatus,
} from '../../lib/auth/index.mjs';
import { log, out, writeText } from '../../lib/log.mjs';

function usageErr(msg) { const e = new Error(msg); e.code = 'E_USAGE'; throw e; }

function printStatus(status, { supervisor = false } = {}) {
  const lines = [
    `${supervisor ? '主管锁' : '授权'}：${status.unlocked ? '已解锁' : (status.authorized ? '已授权' : '锁定')}`,
    `本机码：${status.machine}`,
    `授权目录：${status.authDir}`,
  ];
  if (status.license) {
    lines.push(`token：${status.license.subject || '(no-sub)'} · 到期 ${status.license.expiresAt}`);
    lines.push(`权限：${status.license.features.join(', ') || '(none)'}`);
    lines.push(`secrets：${status.license.secrets.join(', ') || '(none)'}`);
  } else {
    lines.push('token：未安装');
  }
  if (status.session) lines.push(`session：${status.session.mode || 'temporary'} · 到期 ${status.session.expiresAt}`);
  if (status.reason) lines.push(`原因：${status.reason}`);
  writeText(lines.join('\n'));
}

function commandUsage(command) {
  return `用法: weilai ${command} <status|install-token|unlock|lock|secrets|resolve> [secret] [--for 120|2h|all-day] [--all-day] [--json]`;
}

export async function runAuth({ flags, pos, command = 'auth' }) {
  const action = pos[0];
  const supervisor = command === 'supervisor';
  if (action === 'install-token') {
    const token = pos[1];
    if (!token) usageErr(`用法: weilai ${command} install-token <token> [--json]`);
    const license = installAuthToken(token);
    clearUnlockSession();
    if (flags.json) out({ command, action: 'install-token', installed: true, license, paths: authPaths() });
    else {
      log.ok(`${supervisor ? '主管' : '授权'} token 已安装：${license.subject || '(no-sub)'}，到期 ${license.expiresAt}`);
      log.info(`已清除旧 session；需要 paid 时运行 \`weilai ${command} unlock\`。`);
    }
    return;
  }
  if (action === 'unlock') {
    const session = createUnlockSession(flags);
    if (flags.json) out({ command, action: 'unlock', unlocked: true, session });
    else log.ok(`${supervisor ? '主管锁' : '授权 session'}已解锁 ${session.minutes} 分钟（${session.mode}），到期 ${session.sessionExpiresAt}`);
    return;
  }
  if (action === 'lock') {
    clearUnlockSession();
    if (flags.json) out({ command, action: 'lock', unlocked: false });
    else log.ok(`${supervisor ? '主管锁' : '授权 session'}已手动上锁。`);
    return;
  }
  if (action === 'status') {
    const status = supervisor ? supervisorAuthStatus() : authStatus();
    if (flags.json) out({ command, action: 'status', ...status });
    else printStatus(status, { supervisor });
    return;
  }
  if (action === 'secrets') {
    const res = declaredSecrets();
    if (flags.json) out({ command, action: 'secrets', ...res });
    else {
      const lines = res.secrets.length
        ? res.secrets.map((s) => `${s.name}\t${s.mode}\t${s.configured ? `configured:${s.source}` : 'missing'}`)
        : ['(none)'];
      writeText(lines.join('\n'));
    }
    return;
  }
  if (action === 'resolve') {
    const name = pos[1];
    if (!name) usageErr(`用法: weilai ${command} resolve <secret> [--json]`);
    const resolved = resolveSecret(name);
    if (flags.json) out({ command, action: 'resolve', secret: resolved });
    else writeText(`${resolved.name} = ${resolved.masked} (${resolved.source})`);
    return;
  }
  usageErr(commandUsage(command));
}
