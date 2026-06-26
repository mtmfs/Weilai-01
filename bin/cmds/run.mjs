// bin/cmds/run.mjs —— `weilai run`：常驻异步飞轮（替代多轮 cycle 的同步阻塞 sleep 空转）。
// 默认双通道；--jie3/--jie6 显式单选；--no-jie6 排除。SIGINT/SIGTERM 优雅停（等在途收尾，★绝不杀 Chrome）。
import { runFlywheel } from '../../lib/flywheel.mjs';
import { log } from '../../lib/log.mjs';

export async function runRun({ flags }) {
  // 通道选择：显式 --jie3/--jie6 → 白名单；否则默认双通道、--no-jieX 排除。
  let channels;
  if (flags.jie3 || flags.jie6) channels = ['jie3', 'jie6'].filter(c => flags[c]);
  else channels = ['jie3', 'jie6'].filter(c => !flags['no-' + c]);
  if (!channels.length) { const e = new Error('用法: weilai run [--jie3|--jie6|--no-jie6] [--poll-floor S] [--poll-ceil S] [--full-sync MIN]'); e.code = 'E_USAGE'; throw e; }

  // CLI 覆盖（其余取 system.json.daemon / flywheel.DAEMON_DEFAULTS）。
  const daemon = {};
  if (flags['poll-floor'] != null) daemon.pollFloorSec = Number(flags['poll-floor']);
  if (flags['poll-ceil'] != null) daemon.pollCeilSec = Number(flags['poll-ceil']);
  if (flags['full-sync'] != null) daemon.fullSyncMin = Number(flags['full-sync']);
  if (flags['no-md5-subdir']) daemon.md5fixPerChannelDir = false;
  if (flags.batch != null) daemon.releaseMax = Number(flags.batch); // 每 tick 最多释放几个（模拟多批次飞轮）

  const controller = new AbortController();
  let stopping = false;
  const stop = (sig) => { if (stopping) { log.warn(`再次 ${sig}：仍在收尾，请耐心（或手动 weilai close）`); return; } stopping = true; log.warn(`收到 ${sig}，优雅停止飞轮（等在途步骤收尾，★绝不杀 Chrome）...`); controller.abort(); };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  log.step('weilai run：常驻飞轮（Ctrl-C 优雅停）');
  await runFlywheel({ channels, log, daemon, signal: controller.signal });
}
