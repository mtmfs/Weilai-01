#!/usr/bin/env node
// Weilai-01 CLI 入口：解析 argv、护栏、分发子命令。
// 护栏：拒绝非 ASCII argv（中文走 channels/*.json 或 login 读回，绝不走命令行）→ exit 2 (E_USAGE)。
// 通道模型：裸命令默认 free(免费测试号)；`-paid` 后缀 / `--as <id>` 选 paid(付费投放号·主管级·烧钱)。
//   free/paid 是命令层标签 → channelRegistry 的 testId/delivId；台账内部键仍是 jie3/jie6。
import { runStatus } from './cmds/status.mjs';
import { runConfigCmd } from './cmds/config.mjs';
import { runReady } from './cmds/ready.mjs';
import { runClose } from './cmds/close.mjs';
import { runSyncCmd } from './cmds/sync.mjs';
import { runDeleteCmd } from './cmds/delete.mjs';
import { runMd5fixCmd } from './cmds/md5fix.mjs';
import { runPrep } from './cmds/prep.mjs';
import { runReconcileCmd } from './cmds/reconcile.mjs';
import { runUploadCmd } from './cmds/upload.mjs';
import { runCycle } from './cmds/cycle.mjs';
import { runRun } from './cmds/run.mjs';
import { runClearLocalCmd } from './cmds/clearlocal.mjs';
import { runMonitor } from './cmds/monitor.mjs';
import { runStatsCmd } from './cmds/stats.mjs';
import { runPassrate } from './cmds/passrate.mjs';
import { runOpen } from './cmds/open.mjs';
import { runScan } from './cmds/scan.mjs';
import { runWhoami } from './cmds/whoami.mjs';
import { runDoctor } from './cmds/doctor.mjs';
import { runInspect } from './cmds/inspect.mjs';
import { runLogin } from './cmds/login.mjs';
import { channelRegistry } from '../lib/config.mjs';
import { supervisorUnlocked } from '../lib/tier.mjs';
import { CODE_TO_EXIT } from '../lib/guard.mjs';

const EXIT = { OK: 0, USAGE: 2, RUNTIME: 1, CONFIG: 20 };
const DANGER = { read: '🟢只读', local: '🔵写本地', browser: '🟡浏览器', ledger: '🔵写台账', platform: '🔴写平台' };

// 命令注册表（声明式单一真源）。一张表同时驱动：分发 / 别名 / 主管闸 / 通道默认 / 分组危险 help。
//   group   分组（help 用）
//   channel 选通道：'free'(裸默认) | 'paid'(主管) | 'both'(主管) | 'raw'(命令自理 pos，如 status both) | 'none'(无通道)
//   danger  危险等级（help 标记）
//   tier    'normal' | 'super'（super=默认隐藏 + 解锁才可跑）
//   impl    false=桩（报未实现）
//   passChannels  true=run* 用通道 id 列表（opts.channels），不注入 pos
//   aliases 别名（旧名兜底，零破坏）
const COMMANDS = {
  // ── 看（只读）──
  status:           { group: '看', run: runStatus,        channel: 'raw',  danger: 'read',     help: '台账分阶段/分通道汇总（both|free|paid）', aliases: ['st'] },
  inspect:          { group: '看', run: runInspect,       channel: 'none', danger: 'read',     help: '查名字含某串的视频在台账的状态', aliases: ['show', 'find'] },
  'monitor-report': { group: '看', run: runStatsCmd,      channel: 'free', danger: 'read',     help: '读 monitor 录制出分时段请求/时延/错误率报表', aliases: ['stats', 'traffic'] },
  passrate:         { group: '看', run: runPassrate,      channel: 'free', danger: 'read',     help: '过审率 + 审核时延 + 建议提交时段' },
  monitor:          { group: '看', run: runMonitor,       channel: 'free', danger: 'read',     help: '旁路被动录制网络请求到文件' },
  scan:             { group: '看', run: runScan,          channel: 'none', danger: 'read',     help: '扫各通道调试 Chrome 在不在跑 + 是否本号', aliases: ['ps'] },
  doctor:           { group: '看', run: runDoctor,        channel: 'none', danger: 'read',     help: '环境自检：磁盘/ffmpeg/chrome/端口/台账/通道（--fix 探测修补 system.json）', aliases: ['preflight'] },
  // ── 会话（浏览器）──
  ready:            { group: '会话', run: runReady,       channel: 'free', danger: 'browser',  help: '收敛到上传就绪（可自启 Chrome）' },
  open:             { group: '会话', run: runOpen,        channel: 'free', danger: 'browser',  help: '只启动 Chrome 实例、不收敛（ready 挂了的逃生口）' },
  close:            { group: '会话', run: runClose,       channel: 'free', danger: 'browser',  help: '优雅关该通道调试 Chrome（不杀别的）' },
  whoami:           { group: '会话', run: runWhoami,      channel: 'free', danger: 'browser',  help: '探当前登录账户（config 的 account 为空则回填）' },
  login:            { group: '会话', run: runLogin,       channel: 'none', danger: 'local',    help: '交互式录入端口/凭据/双通道标识（双模·无汉字）' },
  // ── 流水线（叶子）──
  sync:             { group: '流水线', run: runSyncCmd,   channel: 'free', danger: 'ledger',   help: '拉平台审核归台账（不改平台）' },
  delete:           { group: '流水线', run: runDeleteCmd, channel: 'free', danger: 'platform', help: '删过审/被拒副本腾槽（dry-run 默认）' },
  md5fix:           { group: '流水线', run: runMd5fixCmd, channel: 'free', danger: 'local',    help: '改哈希让被拒件能重传（纯本地）' },
  upload:           { group: '流水线', run: runUploadCmd, channel: 'free', danger: 'platform', help: '真上传：注入→等传完→提交→记账' },
  reconcile:        { group: '流水线', run: runReconcileCmd, channel: 'free', danger: 'ledger', help: '对账 un-bump 幻影上传（dry-run 默认）' },
  // ── 编排 ──
  prep:             { group: '编排', run: runPrep,        channel: 'free', danger: 'platform', help: 'sync→delete→md5fix（备料不传；delete 段 dry-run）' },
  cycle:            { group: '编排', run: runCycle,       channel: 'free', danger: 'platform', help: '免费多轮收敛（轮间不死等）', aliases: ['test-round'] },
  run:              { group: '编排', run: runRun,         channel: 'free', danger: 'platform', passChannels: true, help: '免费飞轮（=旧 run --jie3，日常主力）', aliases: ['flywheel'] },
  // ── 维护 ──
  config:           { group: '维护', run: runConfigCmd,   channel: 'raw',  danger: 'local',    help: '读/改配置旋钮（get/set；set dry-run 默认）' },
  'clear-local':    { group: '维护', run: runClearLocalCmd, channel: 'none', danger: 'local',  help: '清本地源 + md5fix 孤儿副本（dry-run 默认）' },
  // ── 主管级（默认隐藏 + 解锁才可跑）──
  'run-paid':       { group: '主管', run: runRun,         channel: 'paid', danger: 'platform', tier: 'super', passChannels: true, help: '付费飞轮' },
  'run-both':       { group: '主管', run: runRun,         channel: 'both', danger: 'platform', tier: 'super', passChannels: true, help: 'free+paid 双通道并发飞轮' },
  'cycle-paid':     { group: '主管', run: runCycle,       channel: 'paid', danger: 'platform', tier: 'super', help: '付费多轮（跳 delete）', aliases: ['deliver-round'] },
  'delete-paid':    { group: '主管', run: runDeleteCmd,   channel: 'paid', danger: 'platform', tier: 'super', impl: false, help: '付费腾槽（未实现）', aliases: ['sweep'] },
  // ── 桩（隐藏，调用报未实现）──
  'hold-submit':    { group: '桩', channel: 'free', danger: 'platform', impl: false, help: '择时挂起提交（未实现）' },
};

// 别名表（旧名 → 规范名）。
const ALIAS = {};
for (const [name, c] of Object.entries(COMMANDS)) for (const a of (c.aliases || [])) ALIAS[a] = name;

// ★A2: 取值 flag。其余 `--xxx` 仍是布尔。
const VALUE_FLAGS = new Set([
  'seconds', 'out', 'file', 'channel', 'rounds', 'round-wait', 'grace-min', 'poll-floor', 'poll-ceil', 'full-sync', 'batch',
  'as', 'email', 'pwd',
  'free-aavid', 'free-plan', 'free-port', 'free-max',
  'paid-aavid', 'paid-plan', 'paid-port', 'paid-max',
]);
function parseArgs(argv) {
  const flags = { json: false, dryRun: false, apply: false, help: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--apply') flags.apply = true;
    else if (a === '-h' || a === '--help') flags.help = true;
    else if (a === '--help-all') { flags.help = true; flags.helpAll = true; }
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else {
        const name = a.slice(2);
        if (VALUE_FLAGS.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i];
        else flags[name] = true;
      }
    } else pos.push(a);
  }
  return { flags, pos };
}

// 解析命令要操作的通道 id（free/paid/-paid/--as）。返回 { ids, touchesPaid }。
//   ids：单通道命令为 [id]；both 为 [testId, delivId]；none/raw 为 []。
//   touchesPaid：是否碰付费号（用于主管闸）。
function resolveTargets(entry, flags) {
  const reg = channelRegistry();
  if (flags.as) {
    if (!reg.ids.includes(flags.as)) { const e = new Error(`未知通道 --as ${flags.as}（可用: ${reg.ids.join('|')}）`); e.code = 'E_USAGE'; throw e; }
    return { ids: [flags.as], touchesPaid: flags.as === reg.delivId };
  }
  if (entry.channel === 'paid') return { ids: [reg.delivId], touchesPaid: true };
  if (entry.channel === 'both') return { ids: reg.ids, touchesPaid: true };
  if (entry.channel === 'free') return { ids: [reg.testId], touchesPaid: false };
  return { ids: [], touchesPaid: false }; // none / raw
}

function usage(showAll = false) {
  const lines = [
    'Weilai-01 — 千川双通道过审流水线 CLI',
    '',
    '用法: weilai <命令> [--json] [--dry-run|--apply] [--as <id>]',
    '通道: 裸命令默认 free(免费测试号)；-paid 后缀 / --as 选 paid(付费投放号·主管级·烧钱)',
    '',
  ];
  for (const g of ['看', '会话', '流水线', '编排', '维护', '主管', '桩']) {
    const items = Object.entries(COMMANDS).filter(([, c]) => c.group === g &&
      (showAll || (c.tier !== 'super' && c.impl !== false && g !== '桩')));
    if (!items.length) continue;
    lines.push(`【${g}】`);
    for (const [name, c] of items) {
      const al = (c.aliases && c.aliases.length) ? ` (${c.aliases.join(',')})` : '';
      const tag = c.impl === false ? '⚪桩' : (c.tier === 'super' ? '🔒主管' : (DANGER[c.danger] || ''));
      lines.push(`  ${(name + al).padEnd(24)} ${tag.padEnd(7)} ${c.help}`);
    }
    lines.push('');
  }
  if (!showAll) lines.push('（--help-all 显示主管级/桩/别名全集）');
  lines.push('退出码对照见 docs/工程总报告.md §A.1');
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const { flags, pos } = parseArgs(argv);
  let cmd = pos[0];
  if (cmd && ALIAS[cmd]) cmd = ALIAS[cmd]; // 别名 → 规范名

  // 护栏：拒绝非 ASCII argv（汉字账户名/计划绝不走命令行；login 交互式从 stdin 读，不受此限）。
  // 例外：inspect 是只读台账按名字搜，搜索词允许中文（不碰平台/配置）；flag 仍须 ASCII。
  const allowCN = cmd === 'inspect';
  const bad = argv.find((a) => /[^\x00-\x7F]/.test(a) && !(allowCN && !a.startsWith('-')));
  if (bad) {
    console.error(`[E_USAGE] 命令行参数含非 ASCII 字符：「${bad}」。中文写进 channels/*.json 或用 login，命令行只用 ASCII。`);
    process.exit(EXIT.USAGE);
  }

  if (!cmd || flags.help) {
    console.log(usage(!!flags.helpAll));
    process.exit(EXIT.OK);
  }

  const entry = COMMANDS[cmd];
  if (!entry) {
    console.error(`未知命令：${pos[0]}\n\n${usage()}`);
    process.exit(EXIT.USAGE);
  }

  try {
    // 通道解析 + 主管闸（碰付费号 / super 命令 → 须解锁）。raw/none 不解析通道。
    const needsResolve = entry.channel !== 'raw' && entry.channel !== 'none';
    const targets = needsResolve ? resolveTargets(entry, flags) : { ids: [], touchesPaid: false };
    if ((entry.tier === 'super' || targets.touchesPaid) && !supervisorUnlocked()) {
      console.error(`[E_USAGE] \`${cmd}\` 是主管级（付费/烧钱通道）命令，默认锁定。\n解锁：设环境变量 WEILAI_SUPERVISOR=1 后重试（PowerShell: $env:WEILAI_SUPERVISOR=1）。`);
      process.exit(EXIT.USAGE);
    }

    // 桩占位。
    if (entry.impl === false || !entry.run) {
      if (flags.json) console.log(JSON.stringify({ command: cmd, implemented: false, note: entry.help }));
      else console.log(`命令 \`${cmd}\` 尚未实现（桩）。说明：${entry.help}`);
      process.exit(EXIT.OK);
    }

    const restPos = pos.slice(1);
    if (entry.passChannels) {
      // run* 用通道 id 列表（runRun 再叠加 legacy --jie3/--jie6 + 主管闸）。
      await entry.run({ flags, pos: restPos, channels: targets.ids });
    } else if (needsResolve && targets.ids.length === 1) {
      // 单通道命令：把解析到的 id 注入 pos[0]（旧命令文件按 pos[0]=通道 工作，零改动）。
      await entry.run({ flags, pos: [targets.ids[0], ...restPos] });
    } else {
      // raw（status/config 自理 free/paid/both 标签）/ none（无通道）。
      await entry.run({ flags, pos: restPos });
    }
  } catch (e) {
    const code = e && e.code;
    if (code && CODE_TO_EXIT[code] !== undefined) {
      console.error(`[${code}] ${e.message}`);
      process.exit(CODE_TO_EXIT[code]);
    }
    console.error(`[ERROR] ${(e && e.stack) || e}`);
    process.exit(EXIT.RUNTIME);
  }
}

main();
