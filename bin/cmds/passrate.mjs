// passrate：读 submissions.jsonl 出分时段过审率 + audit latency + Thompson(S5) 建议提交时段。只读。
import { loadConfig, channelRegistry } from '../../lib/config.mjs';
import { passRateStats, passRateArms } from '../../lib/telemetry.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runPassrate({ flags, pos }) {
  const id = pos[0] || channelRegistry().testId;
  const lp = loadConfig(id).system.project.ledgerPath;
  const s = passRateStats(lp);
  const a = passRateArms(lp);
  if (flags.json) { out({ command: 'passrate', target: id, ...s, bestHour: a.best, posterior: a.posterior }); return; }
  const pct = v => v == null ? '—' : (v * 100).toFixed(1) + '%';
  log.info(`pass-rate（${id}）: 提交 ${s.submissions} / 已结 ${s.resolved} / 总过审率 ${pct(s.passRate)}`);
  for (const [h, b] of Object.entries(s.byHour).sort((x, y) => +x[0] - +y[0]))
    log.info(`  ${String(h).padStart(2, '0')}时  提交${b.submitted} 过${b.passed} 拒${b.rejected} 待${b.pending}  过审率${pct(b.passRate)}  时延${b.avgLatencyMin == null ? '—' : b.avgLatencyMin + 'min'}`);
  log.info(`Thompson(S5) 建议提交时段: ${a.best == null ? '（数据不足）' : a.best + '时'}`);
}
