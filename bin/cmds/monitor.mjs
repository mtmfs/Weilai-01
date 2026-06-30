// monitor：起旁路遥测录制（常驻、跨所有标签被动观察、不干扰操作）。Ctrl-C 或到时自停。
import { join } from 'node:path';
import { loadConfig, ROOT, channelRegistry } from '../../lib/config.mjs';
import { record } from '../../lib/telemetry.mjs';
import { log, out } from '../../lib/log.mjs';

function positiveIntFlag(flags, name, fallback) {
  if (flags[name] == null) return fallback;
  const s = String(flags[name]);
  if (!/^[1-9]\d*$/.test(s)) {
    const e = new Error(`--${name} 必须是正整数，得到「${s}」`);
    e.code = 'E_USAGE';
    throw e;
  }
  return Number(s);
}

export async function runMonitor({ flags, pos }) {
  const id = pos[0] || channelRegistry().testId;
  const cfg = loadConfig(id);
  const seconds = positiveIntFlag(flags, 'seconds', 1800);
  const outFile = flags.out || join(ROOT, 'telemetry-out', `rec-${id}.jsonl`);
  const res = await record(cfg.target.port, { seconds, outFile, log });
  if (flags.json) out({ command: 'monitor', target: id, ...res });
}
