// monitor：起旁路遥测录制（常驻、跨所有标签被动观察、不干扰操作）。Ctrl-C 或到时自停。
import { join } from 'node:path';
import { loadConfig, ROOT } from '../../lib/config.mjs';
import { record } from '../../lib/telemetry.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runMonitor({ flags, pos }) {
  const id = pos[0] || 'jie3';
  const cfg = loadConfig(id);
  const seconds = parseInt(flags.seconds || '1800', 10);
  const outFile = join(ROOT, 'telemetry-out', `rec-${id}.jsonl`);
  const res = await record(cfg.target.port, { seconds, outFile, log });
  if (flags.json) out({ command: 'monitor', target: id, ...res });
}
