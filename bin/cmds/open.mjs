// open：只启动该通道的调试 Chrome 实例、不收敛（ready 收敛挂了时的手动逃生口——自己导航后让 run 接管）。
import { loadConfig, assertChannel } from '../../lib/config.mjs';
import { launchChrome, probeChromePort } from '../../lib/session.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runOpen({ flags, pos }) {
  const id = pos[0];
  assertChannel(id, '用法: weilai open <通道>');
  const cfg = loadConfig(id);
  const port = cfg.target.port;
  const already = await probeChromePort(port);
  const ok = already ? true : await launchChrome(cfg.system, cfg.profile, port);
  if (ok) log.ok(`${already ? '已在跑' : '已启动'} 调试 Chrome :${port}（通道 ${id}·未收敛——自行导航后用 run 接管，或 ready 自动收敛）`);
  if (flags.json) out({ command: 'open', target: id, port, launched: !already, running: ok });
  if (!ok) { const e = new Error(`Chrome :${port} 起不来（检查 system.json chrome.path / 磁盘）`); e.code = 'E_CONFIG'; throw e; }
}
