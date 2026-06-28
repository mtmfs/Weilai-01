// whoami：只读检查该通道 Chrome/aavid 标签是否在位。账户名探针已禁用，不再回填 account。
import { loadConfig } from '../../lib/config.mjs';
import { probeChromePort, probeTab } from '../../lib/session.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runWhoami({ flags, pos }) {
  const id = pos[0];
  const cfg = loadConfig(id);
  const { port, aavid, planId, account } = cfg.target;
  if (!await probeChromePort(port)) { log.warn(`Chrome :${port} 没在跑——先 \`open ${id}\` 或 \`ready ${id}\``); if (flags.json) out({ command: 'whoami', target: id, running: false }); return; }
  const tab = await probeTab(port, aavid);
  if (!tab) { log.warn(`:${port} 在跑但无本号(aavid=${aavid})标签——先 \`ready ${id}\` 收敛`); if (flags.json) out({ command: 'whoami', target: id, running: true, tab: false }); return; }
  log.ok(`通道 ${id} 标签在位：aavid=${aavid} / planId=${planId}${account ? `（config account=${account}，未校验）` : ''}`);
  if (flags.json) out({ command: 'whoami', target: id, running: true, tab: true, aavid, planId, configuredAccount: account || null, accountProbe: false });
}
