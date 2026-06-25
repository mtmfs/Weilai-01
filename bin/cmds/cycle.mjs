// cycle（全局编排·丛3）：多轮收敛循环  ready → { sync → delete → md5fix → [upload] } ×N。
// ★#11「iterate 集成 delete」：每轮上传前都先跑 delete 腾槽，且用的是
//   delete.mjs::runDelete —— 台账驱动、`魏文彬`(kw) 字段写死、非全删、默认 dry-run。
//   根治 06-25 的「只传不删 → jie3 被自己重传的副本塞满」。
// --rounds N 多轮收敛（默认 1 = 单趟，行为与旧版一致）；待上传清零即提前收敛、不跑满。
// --round-wait MIN 轮间等审核（默认 12min；审核异步，等平台结果出来下一轮才有新待办）。
import { loadConfig, loadSecrets } from '../../lib/config.mjs';
import { ready } from '../../lib/session.mjs';
import { runSync } from '../../lib/sync.mjs';
import { runDelete } from '../../lib/delete.mjs';
import { loadState, worklists } from '../../lib/state.mjs';
import { runMd5fix } from '../../lib/md5fix.mjs';
import { runUpload } from '../../lib/upload.mjs';
import { log, out } from '../../lib/log.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
// 待上传集：jie6 取投放待传/重传；jie3 取测试待传/重传。
const upNamesOf = (id, w) => id === 'jie6' ? [...w.deliv_toupload, ...w.deliv_reupload] : [...w.test_toupload, ...w.test_reupload];

export async function runCycle({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai cycle <jie3|jie6> [--rounds N] [--round-wait MIN] [--skip-upload] [--apply]'); e.code = 'E_USAGE'; throw e; }
  const cfg = loadConfig(id);
  const ledgerPath = cfg.system.project.ledgerPath;
  const rounds = Math.max(1, parseInt(flags.rounds, 10) || 1);
  const waitMin = flags['round-wait'] != null ? Math.max(0, Number(flags['round-wait']) || 0) : 12;
  const trail = [];

  log.step(`cycle ① ready（${id}）`); await ready(cfg, { secrets: loadSecrets(), log });

  let r = 0, reason = 'rounds-exhausted';
  for (r = 1; r <= rounds; r++) {
    if (rounds > 1) log.step(`══════ round ${r}/${rounds} ══════`);
    if (r > 1) { log.step(`round ${r}: re-ready（幂等空转）`); await ready(cfg, { secrets: loadSecrets(), log }); }
    log.step(`round ${r} ② sync`); const sres = await runSync(cfg, { log });
    // ③ delete —— ★每轮都删（#11）：台账驱动 + 魏文彬 kw 闸门 + 非全删 + 默认 dry-run；
    //   穿 sync 刚拉的 platform 快照 → 同轮免重复拉取、且删除作用在与台账一致的同一快照上。
    log.step(`round ${r} ③ delete（${flags.apply ? 'apply' : 'dry-run'}·魏文彬 kw 闸门·台账驱动·非全删）`);
    await runDelete(cfg, { apply: !!flags.apply, log, platform: sres.platform });
    const upNames = upNamesOf(id, worklists(loadState(ledgerPath)));
    log.step(`round ${r} ④ md5fix（${upNames.length} 件）`); if (upNames.length) await runMd5fix(cfg, upNames, { log });
    // ⑤ upload —— ★会真上传到平台；--skip-upload 仍可跳过；upload 自带 kw 字段锁。
    if (flags['skip-upload']) { log.warn(`round ${r} ⑤ upload 跳过（--skip-upload）`); trail.push(`r${r}:skip`); }
    else if (!upNames.length) { log.ok(`round ${r}: 无待上传 → 收敛`); trail.push(`r${r}:empty`); reason = 'converged-empty'; break; }
    else { const up = await runUpload(cfg, { names: upNames, log }); trail.push(`r${r}:inj${up.injected || 0}/sub${up.submitted || 0}${up.dedup ? '(dedup)' : ''}`); }
    // 收敛判定：删+传后待上传清零即停（不必跑满 rounds）。
    const left = upNamesOf(id, worklists(loadState(ledgerPath)));
    if (!left.length) { log.ok(`round ${r}: 待上传=0 → 收敛`); reason = 'converged-empty'; break; }
    if (r < rounds && waitMin > 0) {
      log.step(`round ${r} 完，剩 ${left.length} 待上传；等审核 ${waitMin}min 再下一轮（中断后重跑同命令续跑·台账即检查点）`);
      await sleep(waitMin * 60000);
    }
  }
  const ranRounds = Math.min(r, rounds);
  log.ok(`cycle ${id} 完：跑 ${ranRounds} 轮（${reason}）｜${trail.join(' → ') || '(无上传步)'}`);
  if (flags.json) out({ command: 'cycle', target: id, rounds: ranRounds, reason, trail });
}
