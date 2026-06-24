// lib/md5fix.mjs —— 改 MD5（ffmpeg 重封装+唯一元数据，不重编码，绕平台去重）。
// 继承 I:\cdp-helper\md5fix.mjs，增强：从 config 读 ffmpeg/输出目录、★并行 fan-out、跳过已存在。
// 纯本地（不碰浏览器），可独立测试。
import { existsSync, mkdirSync, renameSync, rmSync, createReadStream } from 'node:fs';
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
// ★C4: 流式哈希，避免把整个 ~400MB 文件读进内存（旧版 readFileSync 整读，src+dst × 并发 worker 内存尖峰可达数 GB）。
const md5short = (p) => new Promise((resolve, reject) => {
  const h = createHash('md5');
  createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex').slice(0, 12))).on('error', reject);
});

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
    const part = join(out, name.replace(/(\.[^.\\/]+)$/, '.part$1')); // ★A6: 临时名保留原扩展名（ffmpeg 靠扩展名定容器格式），如 foo.part.mp4
    if (!existsSync(src)) return { name, ok: false, reason: 'MISSING' };
    if (skipExisting && existsSync(dst)) return { name, ok: true, reason: 'SKIP-EXISTS' };
    try {
      // ★A6: 写临时 .part → 校验 → rename 成最终文件。中断只会留 .part（下轮被覆盖），绝不留半截 dst 被 skipExisting 当成好文件上传。
      if (existsSync(part)) rmSync(part, { force: true });
      await execFileP(FF, ['-y', '-loglevel', 'error', '-i', src, '-c', 'copy', '-map_metadata', '-1', '-metadata', 'comment=' + randomUUID(), '-movflags', '+faststart', part]);
      const a = await md5short(src), b = await md5short(part);
      renameSync(part, dst);
      return { name, ok: a !== b, a, b, reason: a !== b ? 'OK' : 'NOCHG' };
    } catch (e) {
      try { if (existsSync(part)) rmSync(part, { force: true }); } catch (e2) {}
      return { name, ok: false, reason: 'FFMPEG_FAIL:' + String(e.message || e).slice(0, 60) };
    }
  });

  const changed = results.filter(r => r.reason === 'OK').length;
  const skipped = results.filter(r => r.reason === 'SKIP-EXISTS').length;
  const failed = results.filter(r => !r.ok && r.reason !== 'SKIP-EXISTS');
  for (const f of failed) L.warn(`${f.reason}: ${f.name}`);
  L.ok(`改 MD5: 新改 ${changed} / 跳过已存在 ${skipped} / 失败 ${failed.length}，输出 ${out}`);
  return { out, total: todo.length, changed, skipped, failed: failed.map(f => f.name) };
}
