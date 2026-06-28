// lib/reconcile.mjs —— 对账 Bug B：un-bump 幻影上传（注入了但未真创建素材）。
// 根因：bump 按"注入"记账（uploads++、last_status=3），若提交卡死/未真创建素材，uploads 会虚高、
//       无人值守悄悄累积，可能把视频误推到满 maxUploads → 误判 scrapped。
// 判据（安全）：delete 只删 audit 1/2（过审/被拒），从不删 audit 3（审核中）的素材（见 delete.computeTargets）。
//       故某通道块 last_status===3（bump 置的在飞态、至今没被 sync observe 成 1/2）、却在新鲜平台拉取里查无此件
//       ＝ 该 bump 从未真正落平台（幻影），而非"真传过又被 delete 删掉"（后者会先被 sync 观成 1/2 或 passed/scrapped）。
//       且幻影 bump 在 submissions.jsonl 无记录（recordSubmissions 只记捕到 mid 的件）→ 无需触碰 telemetry。
// ★默认 dry-run；--apply 才写台账（台账原子写 + .bak 兜底）。
import { connect, norm } from './cdp.mjs';
import { captureListSigs, injectNameFilter, pullRows } from './sync.mjs';
import { createLedger } from './ledger.mjs';
import { guardEnter } from './guard.mjs';

export const DEFAULT_GRACE_MIN = 30; // 真素材提交后秒级入列表；30min 足够排除"刚传完未索引"的竞速误判

// ★纯函数（仿 delete.replayOk/computeTargets 的"便于单测"惯例）：算幻影 un-bump 候选，不改 state。
// 返回 [{key, name, channel, uploads, last_mid, last_ts}]。
export function computeReconcile(state, platform, channel, kw, graceMs, now) {
  // 平台 live 集合（去 isDel、限 kw）：mid 与 norm 名各建一份。
  const liveMids = new Set(), liveNames = new Set();
  for (const p of platform || []) {
    if (p.isDel === true) continue;
    const nm = p.name || ''; if (kw && !nm.includes(kw)) continue;
    if (p.id != null) liveMids.add(String(p.id));
    const k = norm(nm); if (k) liveNames.add(k);
  }
  const out = [];
  for (const [key, v] of Object.entries(state.videos || {})) {
    if (kw && !(v.name || '').includes(kw)) continue; // kw 硬闸门：只对账本项目文件
    const C = v.ch && v.ch[channel]; if (!C) continue;
    if (C.passed || C.scrapped) continue; // ★已过审/作废(可能经 delete 登记 passed 但 last_status 仍=3)→非幻影，绝不 un-bump 复活
    // 幻影判据：有过上传、仍在飞(bump 置的 3)、超 grace、且平台查无（mid 或 norm 名都不在 live 集合）。
    if (!(C.uploads > 0 && C.last_status === 3 && (now - (C.last_ts || 0)) > graceMs)) continue;
    const present = (C.last_mid && liveMids.has(String(C.last_mid))) || liveNames.has(norm(v.name || key));
    if (present) continue;
    out.push({ key, name: v.name || key, channel, uploads: C.uploads, last_mid: C.last_mid || null, last_ts: C.last_ts || 0 });
  }
  return out;
}

// 对单个通道块执行一次 un-bump：uploads-1、清 last_mid/last_ts；last_status 置 2(仍>0→回 reupload) 或 null(归0→回 toupload)。
function unbump(C) {
  C.uploads = Math.max(0, C.uploads - 1);
  C.last_mid = null; C.last_ts = 0;
  C.last_status = C.uploads > 0 ? 2 : null;
}

// 主：拉平台 → 算候选 → dry-run 打印 / --apply un-bump 落盘。仿 runDelete 签名（预留 platform 入参，便于日后接 cycle）。
export async function runReconcile(cfg, { apply = false, platform = null, graceMin, log, ledger } = {}) {
  const L = log || { step() {}, ok() {}, info() {}, warn() {} };
  const { system, target } = cfg;
  const channel = target.id;
  const { kw, ledgerPath } = system.project;
  const sysGrace = system.timeouts && system.timeouts.reconcileGraceMin; // system.json 默认（可被 --grace-min 覆盖）
  const gm = Number(graceMin); const graceMs = (Number.isFinite(gm) && gm >= 0 ? gm : (sysGrace ?? DEFAULT_GRACE_MIN)) * 60000;

  // 拉平台快照（无穿入则自连：入口护栏断言 aavid/计划/会话，绝不在错标签上对账；复用 sync 的签名捕获 + 翻页拉取）。
  let cdp = null;
  try {
    if (!platform) {
      cdp = await connect({ port: target.port, aavid: target.aavid });
      await cdp.send('Runtime.enable');
      await guardEnter(cdp, cfg, { log: L });
      L.step('reconcile: reload 捕签名 + 翻页拉平台');
      const { rq, op } = await captureListSigs(cdp, { ui: target.ui });
      if (target.ui === 'creative-tab') injectNameFilter(rq, kw);
      platform = await pullRows(cdp, rq, op);
    }
  } finally { if (cdp) cdp.close(); }

  const led = ledger || createLedger(ledgerPath);
  const now = Date.now();
  const cands = await led.read((state) => computeReconcile(state, platform, channel, kw, graceMs, now));

  L.info(`reconcile ${channel}: 幻影候选 ${cands.length}（uploads 虚高、last_status=3 但平台查无；grace=${graceMs / 60000}min）`);
  cands.forEach(c => L.info(`  un-bump  ${c.name}  uploads ${c.uploads}→${Math.max(0, c.uploads - 1)}  (${Math.round((now - c.last_ts) / 60000)}min 前)`));

  if (!apply) {
    L.warn('[dry-run] 未改台账。真对账: 加 --apply');
    return { dryRun: true, channel, candidates: cands.length, names: cands.map(c => c.name) };
  }
  if (!cands.length) { L.ok('无幻影候选，台账无需对账'); return { reconciled: 0, channel, names: [] }; }

  await led.commit('reconcile:' + channel, (state) => {
    for (const c of cands) { const C = state.videos[c.key] && state.videos[c.key].ch[channel]; if (C) unbump(C); }
  });
  L.ok(`reconcile ${channel}: un-bump ${cands.length} 件（uploads 下修、回上传队列）→ 已落盘`);
  return { reconciled: cands.length, channel, names: cands.map(c => c.name) };
}
