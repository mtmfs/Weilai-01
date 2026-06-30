// status：只读。载入配置 + 台账，输出分阶段/分通道汇总。Phase 0 不碰 Chrome。
import { loadSystem, loadTarget, discoverChannelIds, resolveChannelArg } from '../../lib/config.mjs';
import { loadState, summarize, ledgerExists } from '../../lib/state.mjs';
import { out, writeText } from '../../lib/log.mjs';

export async function runStatus({ flags, pos }) {
  const sys = loadSystem();
  const targetId = (pos[0] || 'both') === 'both'
    ? 'both'
    : resolveChannelArg(pos[0], '用法: weilai status [both|free|paid|<通道>]');
  const ids = targetId === 'both' ? discoverChannelIds() : [targetId];

  const channels = {};
  for (const id of ids) channels[id] = loadTarget(id); // 缺字段会抛 E_CONFIG

  const ledger = loadState(sys.project.ledgerPath);
  const sum = summarize(ledger);

  const report = {
    project: sys.project.name,
    ledgerPath: sys.project.ledgerPath,
    ledgerExists: ledgerExists(sys.project.ledgerPath),
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
    out(report);
    return;
  }

  writeText(`项目: ${report.project}`);
  writeText(`台账: ${report.ledgerPath}${report.ledgerExists ? '' : '  （不存在）'}`);
  writeText(`视频总数: ${report.totalVideos}`);
  writeText('分阶段: ' + Object.entries(report.stages).map(([k, v]) => `${k}=${v}`).join(' / '));
  for (const [id, c] of Object.entries(report.channels)) {
    writeText(
      `  [${id}] ${c.account}  aavid=${c.aavid}  mode=${c.mode}  plan=${c.planId}  port=${c.port}  maxUploads=${c.maxUploads}  | 过审=${c.passed} 作废=${c.scrapped}`
    );
  }
}
