// whoami：探该通道当前登录账户（只读）；若 config 的 account 为空则回填（与 login 共用"账户基线设定"）。
import { join } from 'node:path';
import { loadConfig, loadTarget, ROOT } from '../../lib/config.mjs';
import { connect } from '../../lib/cdp.mjs';
import { probeChromePort, probeTab, waitAccount } from '../../lib/session.mjs';
import { saveJson } from '../../lib/config-write.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runWhoami({ flags, pos }) {
  const id = pos[0];
  const cfg = loadConfig(id);
  const { port, aavid } = cfg.target;
  if (!await probeChromePort(port)) { log.warn(`Chrome :${port} 没在跑——先 \`open ${id}\` 或 \`ready ${id}\``); if (flags.json) out({ command: 'whoami', target: id, running: false }); return; }
  const tab = await probeTab(port, aavid);
  if (!tab) { log.warn(`:${port} 在跑但无本号(aavid=${aavid})标签——先 \`ready ${id}\` 收敛`); if (flags.json) out({ command: 'whoami', target: id, running: true, tab: false }); return; }
  let cdp, account = '?';
  try { cdp = await connect({ port, aavid }); account = await waitAccount(cdp, 8000); } finally { if (cdp) cdp.close(); }
  log.ok(`通道 ${id} 当前账户：${account}${cfg.target.account ? `（config 记: ${cfg.target.account}）` : ''}`);
  let filled = false;
  if (account && account !== '?' && !cfg.target.account) {
    const obj = loadTarget(id); obj.account = account; saveJson(join(ROOT, 'channels', `${id}.json`), obj); filled = true;
    log.ok(`已回填 account=${account} 到 channels/${id}.json（断言基线）`);
  } else if (account !== '?' && cfg.target.account && account !== cfg.target.account) {
    log.warn(`⚠ 当前账户 ${account} ≠ config 记的 ${cfg.target.account}（可能登错号/账户漂移）`);
  }
  if (flags.json) out({ command: 'whoami', target: id, account, filled });
}
