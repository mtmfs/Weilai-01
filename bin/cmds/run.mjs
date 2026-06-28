// bin/cmds/run.mjs —— `weilai run`：常驻异步飞轮。
// 通道：`run`=免费(裸默认·dispatcher 传 [testId])；`run-paid`/`run-both`=主管级（dispatcher 传通道列表）。
// 兼容旧 flag：--jie3/--jie6/--no-jie6（含付费号须 WEILAI_SUPERVISOR=1 解锁）。
// SIGINT/SIGTERM 优雅停（等在途收尾，★绝不杀 Chrome）。
import { join } from 'node:path';
import { runFlywheel } from '../../lib/flywheel.mjs';
import { ROOT, channelRegistry } from '../../lib/config.mjs';
import { supervisorUnlocked } from '../../lib/tier.mjs';
import { log, enableFileLog } from '../../lib/log.mjs';

const today = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };

export async function runRun({ flags, channels: bound }) {
  const reg = channelRegistry();
  const ids = reg.ids;
  let channels;
  if (ids.some(c => flags[c]) || ids.some(c => flags['no-' + c])) {
    // legacy 显式 flag：兼容旧 run --jie3/--jie6/--no-jie6
    if (ids.some(c => flags[c])) channels = ids.filter(c => flags[c]);
    else channels = ids.filter(c => !flags['no-' + c]);
  } else {
    channels = (bound && bound.length) ? bound : [reg.testId]; // 默认 free
  }
  if (!channels.length) { const e = new Error(`用法: weilai run [--<通道>|--no-<通道>]（通道: ${ids.join('|')}）`); e.code = 'E_USAGE'; throw e; }
  // 主管闸：含付费号须解锁（覆盖 legacy --jie6 / --as paid 等到 paid 的路径）。
  if (channels.includes(reg.delivId) && !supervisorUnlocked()) {
    const e = new Error(`飞轮含付费号 ${reg.delivId}（主管级·烧钱），默认锁定：设 WEILAI_SUPERVISOR=1 解锁，或用 \`run\`（仅免费）。`); e.code = 'E_USAGE'; throw e;
  }

  // CLI 覆盖（其余取 system.json.daemon / flywheel.DAEMON_DEFAULTS）。
  const daemon = {};
  if (flags['poll-floor'] != null) daemon.pollFloorSec = Number(flags['poll-floor']);
  if (flags['poll-ceil'] != null) daemon.pollCeilSec = Number(flags['poll-ceil']);
  if (flags['full-sync'] != null) daemon.fullSyncMin = Number(flags['full-sync']);
  if (flags['no-md5-subdir']) daemon.md5fixPerChannelDir = false;
  if (flags.batch != null) daemon.releaseMax = Number(flags.batch);

  // 持久化日志：默认落仓库 logs/run-<日期>.log（零配置·长跑/无人值守事后诊断），WEILAI_LOG_FILE 可覆盖路径。
  const logPath = process.env.WEILAI_LOG_FILE || join(ROOT, 'logs', `run-${today()}.log`);
  const lf = enableFileLog(logPath);
  if (lf) log.info(`📄 运行日志 → ${lf}`);

  const controller = new AbortController();
  let stopping = false;
  const stop = (sig) => { if (stopping) { log.warn(`再次 ${sig}：仍在收尾，请耐心（或手动 weilai close）`); return; } stopping = true; log.warn(`收到 ${sig}，优雅停止飞轮（等在途步骤收尾，★绝不杀 Chrome）...`); controller.abort(); };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  log.step(`==== run 启动 ${new Date().toLocaleString()} · 通道 ${channels.join('+')} · pid ${process.pid}（Ctrl-C 优雅停）====`);
  await runFlywheel({ channels, log, daemon, signal: controller.signal });
  log.step(`==== run 结束 ${new Date().toLocaleString()} · pid ${process.pid} ====`);
}
