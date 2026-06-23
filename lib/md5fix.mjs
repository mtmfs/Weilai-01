// lib/md5fix.mjs —— 改 MD5（ffmpeg 重封装+唯一元数据，不重编码，绕平台去重）。
// 继承 I:\cdp-helper\md5fix.mjs，增强：从 config 读 ffmpeg/输出目录、★并行 fan-out、跳过已存在。
// 纯本地（不碰浏览器），可独立测试。
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFile, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { mapLimit } from './concurrency.mjs';

const execFileP = promisify(execFile);

function pickFfmpeg(candidates) {
  for (const f of candidates || []) { try { execFileSync(f, ['-version'], { stdio: 'ignore' }); return f; } catch (e) {} }
  return null;
}
const md5short = p => createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 12);

// cfg=loadConfig(target)；names=文件名数组(相对 flatRoot)；outDir 默认 system.md5fix.outDir(可传子目录分批)。
export async function runMd5fix(cfg, names, { outDir, workers, skipExisting = true, log } = {}) {
  const L = log || { step() {}, ok() {}, warn() {} };
  const { system } = cfg;
  const root = system.project.flatRoot, kw = system.project.kw;
  const FF = pickFfmpeg(system.ffmpeg.candidates);
  if (!FF) throw Object.assign(new Error('找不到 ffmpeg（检查 system.json ffmpeg.candidates）'), { code: 'E_CONFIG' });
  const out = outDir || system.md5fix.outDir;
  mkdirSync(out, { recursive: true });
  const n = workers || (system.concurrency && system.concurrency.ffmpegWorkers) || 4;

  const todo = (names || []).filter(Boolean).filter(name => {
    if (!name.includes(kw)) { L.warn(`GUARD-SKIP(非${kw}): ${name}`); return false; } // 关键词硬闸门
    return true;
  });
  L.step(`改 MD5 ${todo.length} 个（并行 ${n}，输出 ${out}）`);

  const results = await mapLimit(todo, n, async (name) => {
    const src = join(root, name), dst = join(out, name);
    if (!existsSync(src)) return { name, ok: false, reason: 'MISSING' };
    if (skipExisting && existsSync(dst)) return { name, ok: true, reason: 'SKIP-EXISTS' };
    try {
      await execFileP(FF, ['-y', '-loglevel', 'error', '-i', src, '-c', 'copy', '-map_metadata', '-1', '-metadata', 'comment=' + randomUUID(), '-movflags', '+faststart', dst]);
      const a = md5short(src), b = md5short(dst);
      return { name, ok: a !== b, a, b, reason: a !== b ? 'OK' : 'NOCHG' };
    } catch (e) { return { name, ok: false, reason: 'FFMPEG_FAIL:' + String(e.message || e).slice(0, 60) }; }
  });

  const changed = results.filter(r => r.reason === 'OK').length;
  const skipped = results.filter(r => r.reason === 'SKIP-EXISTS').length;
  const failed = results.filter(r => !r.ok && r.reason !== 'SKIP-EXISTS');
  for (const f of failed) L.warn(`${f.reason}: ${f.name}`);
  L.ok(`改 MD5: 新改 ${changed} / 跳过已存在 ${skipped} / 失败 ${failed.length}，输出 ${out}`);
  return { out, total: todo.length, changed, skipped, failed: failed.map(f => f.name) };
}
