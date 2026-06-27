#!/usr/bin/env node
// Weilai-01 CLI 入口：解析 argv、护栏、分发子命令。
// 护栏：拒绝非 ASCII argv（中文走 channels/*.json，不走命令行）→ exit 2 (E_USAGE)。
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
import { runTestRound, runDeliverRound } from './cmds/rounds.mjs';
import { runCycle } from './cmds/cycle.mjs';
import { runRun } from './cmds/run.mjs';
import { runClearLocalCmd } from './cmds/clearlocal.mjs';
import { runMonitor } from './cmds/monitor.mjs';
import { runStatsCmd } from './cmds/stats.mjs';
import { runPassrate } from './cmds/passrate.mjs';
import { CODE_TO_EXIT } from '../lib/guard.mjs';

const EXIT = { OK: 0, USAGE: 2, RUNTIME: 1, CONFIG: 20 };

// 命令注册表。phase 标注实现进度；run 为 undefined 即骨架占位。
const COMMANDS = {
  status: { phase: 0, run: runStatus, help: '只读：台账分阶段汇总（支持 --json）' },
  config: { phase: 3, run: runConfigCmd, help: '读写 system.json / channels/*.json（get/set；★set 默认 dry-run，--apply 才写·原子写+.bak）' },
  ready: { phase: 2, run: runReady, help: 'session 收敛到上传就绪（从任意页面，可自启动）' },
  close: { phase: 1, run: runClose, help: '优雅关闭目标通道的调试 Chrome（CDP Browser.close，只关该实例·绝不碰别的 chrome）' },
  sync: { phase: 3, run: runSyncCmd, help: '拉平台审核归台账（读平台+写台账，不动平台）' },
  delete: { phase: 3, run: runDeleteCmd, help: '删过审+被拒副本（★默认 dry-run，--apply 才真删）' },
  md5fix: { phase: 3, run: runMd5fixCmd, help: '对待传/重传清单改 MD5（并行，纯本地）' },
  prep: { phase: 3, run: runPrep, help: 'sync → delete(先dry后apply) → md5fix' },
  reconcile: { phase: 3, run: runReconcileCmd, help: '对账 Bug B：un-bump 幻影上传（注入了但未真创建素材，uploads 虚高）·★默认 dry-run，--apply 才写台账（--grace-min N）' },
  upload: { phase: 3, run: runUploadCmd, help: 'inject → submit(逐文件超时) → bump（★会真上传到平台）' },
  'hold-submit': { phase: 4, help: '延迟挂起后择时一口气提交（TTL 实测转正后）' },
  'test-round': { phase: 3, run: runTestRound, help: 'jie3 一轮：ready→sync→delete→md5fix→upload（★含真上传）' },
  'deliver-round': { phase: 4, run: runDeliverRound, help: 'jie6 一轮：ready→sync→md5fix→upload（⚠️jie6 未 live 验证）' },
  sweep: { phase: 3, help: 'jie6：sync → delete' },
  monitor: { phase: 4, run: runMonitor, help: '起旁路遥测录制（常驻·跨所有标签被动·不干扰操作）' },
  stats: { phase: 4, run: runStatsCmd, help: '读录制 JSONL 出分时段请求/端点/时长报表' },
  passrate: { phase: 4, run: runPassrate, help: '读 submissions.jsonl 出分时段过审率 + Thompson(S5) 建议提交时段' },
  cycle: { phase: 4, run: runCycle, help: '多轮收敛: ready→{sync→delete(每轮腾槽)→md5fix→[upload]}×N; --rounds N --round-wait MIN --skip-upload' },
  run: { phase: 5, run: runRun, help: '★常驻异步飞轮: 单进程并发驱动 jie3+jie6 + 后台改MD5, 自治收割/回灌/交接; --jie3|--jie6|--no-jie6 --poll-floor S --poll-ceil S' },
  'clear-local': { phase: 5, run: runClearLocalCmd, help: '按台账清洗本地源文件: delivered→★彻底删除、scrapped→内容不合格/ + 删md5fix衍生（★默认 dry-run，--apply 才动盘）' },
};

// ★A2: 取值 flag。这些 flag 需要带值（`--seconds 600` 或 `--seconds=600`）；其余 `--xxx` 仍是布尔。
const VALUE_FLAGS = new Set(['seconds', 'out', 'file', 'channel', 'rounds', 'round-wait', 'grace-min', 'poll-floor', 'poll-ceil', 'full-sync', 'batch']);
function parseArgs(argv) {
  const flags = { json: false, dryRun: false, apply: false, help: false };
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--apply') flags.apply = true;
    else if (a === '-h' || a === '--help') flags.help = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);                 // --flag=value
      else {
        const name = a.slice(2);
        if (VALUE_FLAGS.has(name) && i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[name] = argv[++i]; // --flag value
        else flags[name] = true;                                             // 布尔 flag
      }
    } else pos.push(a);
  }
  return { flags, pos };
}

function usage() {
  const lines = [
    'Weilai-01 — 千川双通道过审流水线 CLI',
    '',
    '用法: weilai <命令> [target] [--json] [--dry-run|--apply]',
    '',
    '命令:',
  ];
  for (const [name, c] of Object.entries(COMMANDS)) {
    const tag = c.run ? '可用  ' : `P${c.phase}骨架`;
    lines.push(`  ${name.padEnd(15)} [${tag}] ${c.help}`);
  }
  lines.push('', 'target: jie3 | jie6 | both（默认 both）', '退出码对照见 docs/RECOVERY.md');
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);

  // 护栏：拒绝非 ASCII argv。
  const bad = argv.find((a) => /[^\x00-\x7F]/.test(a));
  if (bad) {
    console.error(`[E_USAGE] 命令行参数含非 ASCII 字符：「${bad}」。中文请写进 channels/*.json，命令行只用 ASCII 名（jie3/jie6）。`);
    process.exit(EXIT.USAGE);
  }

  const { flags, pos } = parseArgs(argv);
  const cmd = pos[0];

  if (!cmd || flags.help) {
    console.log(usage());
    process.exit(EXIT.OK);
  }

  const entry = COMMANDS[cmd];
  if (!entry) {
    console.error(`未知命令：${cmd}\n\n${usage()}`);
    process.exit(EXIT.USAGE);
  }

  // 骨架占位：清楚告知将在哪个 Phase 实现。
  if (!entry.run) {
    if (flags.json) {
      console.log(JSON.stringify({ command: cmd, implemented: false, phase: entry.phase, note: entry.help }));
    } else {
      console.log(`命令 \`${cmd}\` 计划在 Phase ${entry.phase} 实现，当前为骨架（Phase 0）。\n说明：${entry.help}`);
    }
    process.exit(EXIT.OK);
  }

  try {
    await entry.run({ flags, pos: pos.slice(1) });
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
