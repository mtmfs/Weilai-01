// status：只读。载入配置 + 台账，输出分阶段/分通道汇总。Phase 0 不碰 Chrome。
import { loadSystem, loadTarget } from '../../lib/config.mjs';
import { loadLedger, summarize } from '../../lib/state.mjs';

export async function runStatus({ flags, pos }) {
  const sys = loadSystem();
  const targetId = pos[0] || 'both';
  const ids = targetId === 'both' ? ['jie3', 'jie6'] : [targetId];

  const channels = {};
  for (const id of ids) channels[id] = loadTarget(id); // 缺字段会抛 E_CONFIG

  const ledger = loadLedger(sys.project.ledgerPath);
  const sum = summarize(ledger);

  const report = {
    project: sys.project.name,
    ledgerPath: sys.project.ledgerPath,
    ledgerExists: sum.exists,
    totalVideos: sum.total,
    stages: sum.stages,
    channels: Object.fromEntries(
      Object.entries(channels).map(([id, c]) => [
        id,
        {
          account: c.account,
          aavid: c.aavid,
          mode: c.mode,
          planId: c.planId,
          port: c.port,
          maxUploads: c.maxUploads,
          passed: sum.channels[id]?.passed ?? 0,
          scrapped: sum.channels[id]?.scrapped ?? 0,
        },
      ])
    ),
  };

  if (flags.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`项目: ${report.project}`);
  console.log(`台账: ${report.ledgerPath}${report.ledgerExists ? '' : '  （不存在）'}`);
  console.log(`视频总数: ${report.totalVideos}`);
  console.log('分阶段: ' + Object.entries(report.stages).map(([k, v]) => `${k}=${v}`).join(' / '));
  for (const [id, c] of Object.entries(report.channels)) {
    console.log(
      `  [${id}] ${c.account}  aavid=${c.aavid}  mode=${c.mode}  plan=${c.planId}  port=${c.port}  maxUploads=${c.maxUploads}  | 过审=${c.passed} 作废=${c.scrapped}`
    );
  }
}
