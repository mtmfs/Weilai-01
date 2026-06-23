#!/usr/bin/env node
// Weilai-01 CLI 入口：解析 argv、护栏、分发子命令。
// 护栏：拒绝非 ASCII argv（中文走 targets/*.json，不走命令行）→ exit 2 (E_USAGE)。
import { runStatus } from './cmds/status.mjs';

const EXIT = { OK: 0, USAGE: 2, RUNTIME: 1, CONFIG: 20 };

// 命令注册表。phase 标注实现进度；run 为 undefined 即骨架占位。
const COMMANDS = {
  status: { phase: 0, run: runStatus, help: '只读：台账分阶段汇总（支持 --json）' },
  ready: { phase: 2, help: 'session 三层收敛到上传就绪（从任意页面）' },
  prep: { phase: 3, help: 'sync → delete(先 --dry-run) → md5fix' },
  upload: { phase: 3, help: 'inject → submit(逐文件超时) → bump' },
  'hold-submit': { phase: 4, help: '延迟挂起后择时一口气提交（TTL 实测转正后）' },
  'test-round': { phase: 3, help: 'jie3 一轮：prep + upload' },
  'deliver-round': { phase: 4, help: 'jie6 一轮：ready + 取 sealed + upload' },
  sweep: { phase: 3, help: 'jie6：sync → delete' },
  monitor: { phase: 4, help: '起旁路遥测记录（常驻、不干扰操作）' },
  cycle: { phase: 4, help: '全局编排多轮 + 轮间人控点 + 遥测择时' },
};

function parseArgs(argv) {
  const flags = { json: false, dryRun: false, apply: false, help: false };
  const pos = [];
  for (const a of argv) {
    if (a === '--json') flags.json = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--apply') flags.apply = true;
    else if (a === '-h' || a === '--help') flags.help = true;
    else if (a.startsWith('--')) flags[a.slice(2)] = true;
    else pos.push(a);
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
    const tag = c.phase === 0 ? '可用 ' : `P${c.phase}骨架`;
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
    console.error(`[E_USAGE] 命令行参数含非 ASCII 字符：「${bad}」。中文请写进 targets/*.json，命令行只用 ASCII 名（jie3/jie6）。`);
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
    if (e && e.code === 'E_CONFIG') {
      console.error(`[E_CONFIG] ${e.message}`);
      process.exit(EXIT.CONFIG);
    }
    console.error(`[ERROR] ${(e && e.stack) || e}`);
    process.exit(EXIT.RUNTIME);
  }
}

main();
