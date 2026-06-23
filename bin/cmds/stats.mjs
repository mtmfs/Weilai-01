// stats：读 monitor 录的 JSONL，出分时段(hour-of-day) 请求/端点/错误率/时长报表。
import { join } from 'node:path';
import { ROOT } from '../../lib/config.mjs';
import { statsFromFile } from '../../lib/telemetry.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runStatsCmd({ flags, pos }) {
  const id = pos[0] || 'jie3';
  const file = flags.file || join(ROOT, 'telemetry-out', `rec-${id}.jsonl`);
  const res = statsFromFile(file);
  if (flags.json) { out({ command: 'stats', file, ...res }); return; }
  log.info(`分时段统计 ${file}（${res.events} 事件）`);
  log.info('各端点平均响应时长(ms): ' + JSON.stringify(res.endpointAvgMs));
  for (const [h, b] of Object.entries(res.hours).sort((a, b2) => +a[0] - +b2[0])) {
    log.info(`  ${String(h).padStart(2, '0')}时 req=${b.reqs} err=${b.errs} ${JSON.stringify(b.byEp)}`);
  }
}
