// cycle（多轮编排）：ready → { sync → [delete 腾槽] → md5fix → [upload] } ×N。
// ★轮间不死等（旧 12min sleep 空转已删；要等审核回灌的长流程用 `run` 飞轮）。
// ★delete 对 drawer / creative-tab 都可跑；默认 dry-run，--apply 才真删。
import { loadConfig, loadSecrets, assertChannel } from '../../lib/config.mjs';
import { ready } from '../../lib/session.mjs';
import { runSync } from '../../lib/sync.mjs';
import { runDelete } from '../../lib/delete.mjs';
import { loadState, uploadNamesForRole, worklists } from '../../lib/state.mjs';
import { runMd5fix } from '../../lib/md5fix.mjs';
import { runUpload } from '../../lib/upload.mjs';
import { log, out } from '../../lib/log.mjs';

function positiveIntFlag(flags, name, fallback) {
  if (flags[name] == null) return fallback;
  const s = String(flags[name]);
  if (!/^[1-9]\d*$/.test(s)) {
    const e = new Error(`--${name} 必须是正整数，得到「${s}」`);
    e.code = 'E_USAGE';
    throw e;
  }
  return Number(s);
}

export async function runCycle({ flags, pos }) {
  const id = pos[0];
  assertChannel(id, '用法: weilai cycle [--rounds N] [--skip-upload] [--apply]');
  const cfg = loadConfig(id);
  const ledgerPath = cfg.system.project.ledgerPath;
  const rounds = positiveIntFlag(flags, 'rounds', 1);
  const trail = [];

  log.step(`cycle ① ready（${id}）`); await ready(cfg, { secrets: loadSecrets(), log });

  let r = 0, reason = 'rounds-exhausted';
  for (r = 1; r <= rounds; r++) {
    if (rounds > 1) log.step(`══════ round ${r}/${rounds} ══════`);
    if (r > 1) { log.step(`round ${r}: re-ready（幂等空转）`); await ready(cfg, { secrets: loadSecrets(), log }); }
    log.step(`round ${r} ② sync`); const sres = await runSync(cfg, { log });
    log.step(`round ${r} ③ delete（${flags.apply ? 'apply' : 'dry-run'}·${cfg.system.project.kw || 'kw'} 闸门·台账驱动·非全删）`);
    await runDelete(cfg, { apply: !!flags.apply, log, platform: sres.platform });
    const upNames = uploadNamesForRole(cfg.target.role, worklists(loadState(ledgerPath)));
    log.step(`round ${r} ④ md5fix（${upNames.length} 件）`); if (upNames.length) await runMd5fix(cfg, upNames, { log });
    // ⑤ upload —— ★会真上传；--skip-upload 仍可跳过；upload 自带 kw 字段锁。
    if (flags['skip-upload']) { log.warn(`round ${r} ⑤ upload 跳过（--skip-upload）`); trail.push(`r${r}:skip`); }
    else if (!upNames.length) { log.ok(`round ${r}: 无待上传 → 收敛`); trail.push(`r${r}:empty`); reason = 'converged-empty'; break; }
    else { const up = await runUpload(cfg, { names: upNames, log }); trail.push(`r${r}:inj${up.injected || 0}/sub${up.submitted || 0}${up.dedup ? '(dedup)' : ''}`); }
    // 收敛判定：删+传后待上传清零即停。
    const left = uploadNamesForRole(cfg.target.role, worklists(loadState(ledgerPath)));
    if (!left.length) { log.ok(`round ${r}: 待上传=0 → 收敛`); reason = 'converged-empty'; break; }
    if (r < rounds) log.step(`round ${r} 完，剩 ${left.length} 待上传 → 直接下一轮（轮间不死等；要等审核回灌请用 \`run\` 飞轮）`);
  }
  const ranRounds = Math.min(r, rounds);
  log.ok(`cycle ${id} 完：跑 ${ranRounds} 轮（${reason}）｜${trail.join(' → ') || '(无上传步)'}`);
  if (flags.json) out({ command: 'cycle', target: id, rounds: ranRounds, reason, trail });
}
