// lib/clearlocal.mjs —— 根据台账 stage 清洗本地源文件（flatRoot），把终态件清出工作集。
//   delivered(走完全程·jie3+jie6 都过审)     → ★彻底删除源文件（不可逆）
//   scrapped(触 jie3/jie6 上限·改MD5也没救)  → 移到 flatRoot/内容不合格/（保留待查）
//   testing/sealed/delivering(还在跑)         → 留原地不动（delivering 的源还要给 jie6 改MD5重传）
//   两类终态件的 md5fix 衍生副本(I:\md5fix\{jie3,jie6}\<name> 及旧单目录)一并删（可再生·纯腾盘）。
// ★kw 闸门：只碰含 kw(魏文彬) 的文件。★默认 dry-run，--apply 才动盘。
import { readdirSync, statSync, mkdirSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { norm } from './cdp.mjs';
import { loadState } from './state.mjs';

// 终态 → 处置：delivered 删，scrapped 移到子目录。其余 stage 不处置。
export const STAGE_PLAN = {
  delivered: { action: 'delete' },
  scrapped: { action: 'move', dest: '内容不合格' },
};

// 纯函数（便于单测）：由台账 stage 算清洗计划。返回 [{file, stage, action, dest?}]，只含终态且含 kw 的本地件。
export function computeClearPlan(state, localFiles, kw) {
  const stageByKey = {};
  for (const v of Object.values(state.videos || {})) stageByKey[norm(v.name || '')] = v.stage;
  const plan = [];
  for (const f of localFiles) {
    if (kw && !f.includes(kw)) continue; // kw 硬闸门
    const rule = STAGE_PLAN[stageByKey[norm(f)]];
    if (rule) plan.push({ file: f, stage: stageByKey[norm(f)], action: rule.action, dest: rule.dest || null });
  }
  return plan;
}

export function runClearLocal(system, { apply = false, log } = {}) {
  const L = log || { step() {}, ok() {}, info() {}, warn() {} };
  const { flatRoot, kw, ledgerPath } = system.project;
  const md5Base = system.md5fix.outDir;
  const state = loadState(ledgerPath);
  const localFiles = readdirSync(flatRoot).filter(n => {
    if (!/\.(mp4|mov|m4v|avi)$/i.test(n)) return false;
    try { return statSync(join(flatRoot, n)).isFile(); } catch (e) { return false; }
  });
  const plan = computeClearPlan(state, localFiles, kw);
  const kwFiles = localFiles.filter(f => !kw || f.includes(kw)); // 真正受管的（kw 闸门内）
  const cnt = { scrapped: 0, delivered: 0 };
  for (const p of plan) cnt[p.stage]++;
  L.info(`清洗计划：delivered→★彻底删除 ${cnt.delivered} 个 ｜ scrapped→内容不合格/ ${cnt.scrapped} 个 ｜ flatRoot 视频 ${localFiles.length}（其中魏文彬 ${kwFiles.length}）｜留魏文彬在跑的 ${kwFiles.length - plan.length} 个`);
  plan.forEach(p => L.info(`  [${p.stage}] ${p.file}  →  ${p.action === 'delete' ? '★彻底删除' : p.dest + '/'}`));

  if (!apply) { L.warn(`[dry-run] 未动盘。真清洗: 加 --apply（删 ${cnt.delivered} 个已交付源 + 移 ${cnt.scrapped} 个作废 + 删其 md5fix 衍生）`); return { dryRun: true, plan: plan.length, scrapped: cnt.scrapped, delivered: cnt.delivered }; }
  if (!plan.length) { L.ok('无终态件可清洗'); return { deleted: 0, moved: 0, derived: 0, plan: 0, scrapped: 0, delivered: 0 }; }

  let deleted = 0, moved = 0, derived = 0;
  for (const p of plan) {
    const src = join(flatRoot, p.file);
    try {
      if (p.action === 'delete') { if (existsSync(src)) { rmSync(src, { force: true }); deleted++; } }
      else { const destDir = join(flatRoot, p.dest); mkdirSync(destDir, { recursive: true }); const dst = join(destDir, p.file); if (existsSync(dst)) L.warn(`目标已存在，跳过移动: ${p.dest}/${p.file}`); else { renameSync(src, dst); moved++; } }
    } catch (e) { L.warn(`处理失败 ${p.file}: ${String(e.message || e).slice(0, 50)}`); }
    // 删 md5fix 衍生副本（两类终态都删；按通道子目录 + 兼容旧单目录）——纯可再生件，腾 I: 盘。
    for (const d of [join(md5Base, 'jie3', p.file), join(md5Base, 'jie6', p.file), join(md5Base, p.file)]) {
      try { if (existsSync(d)) { rmSync(d, { force: true }); derived++; } } catch (e) {}
    }
  }
  L.ok(`clear-local: 彻底删除 ${deleted}（已交付）｜移 ${moved} → 内容不合格/（作废）｜删 md5fix 衍生 ${derived}｜flatRoot 现仅留在跑的件`);
  return { deleted, moved, derived, plan: plan.length, scrapped: cnt.scrapped, delivered: cnt.delivered };
}
