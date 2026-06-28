// scan：扫各通道调试 Chrome 在不在跑 + aavid 标签是否在位。只读。
import { channelRegistry, loadTarget } from '../../lib/config.mjs';
import { probeChromePort, probeTab } from '../../lib/session.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runScan({ flags }) {
  const reg = channelRegistry();
  const rows = [];
  for (const id of reg.ids) {
    const t = loadTarget(id);
    const role = t.role === 'delivery' ? 'paid' : 'free';
    const up = await probeChromePort(t.port);
    let status, account = null;
    if (!up) status = '未运行';
    else {
      const tab = await probeTab(t.port, t.aavid);
      if (!tab) status = '在跑·无本号标签（可能陌生占用/未导航到本号）';
      else {
        status = '在跑·本号标签在位（账户名探针已禁用）';
      }
    }
    rows.push({ id, role, port: t.port, up, account, status });
    log.info(`  [${role}/${id}] :${t.port}  ${status}`);
  }
  if (flags.json) out({ command: 'scan', channels: rows });
}
