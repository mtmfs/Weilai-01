// cycle（全局编排骨架·丛4）：ready → sync → delete → md5fix → [upload]。
// 计划①：upload 槽位走接口桩；--skip-upload 跳过，否则调桩(抛 E_NOT_IMPL→计划②填)。
import { loadConfig, loadSecrets } from '../../lib/config.mjs';
import { ready } from '../../lib/session.mjs';
import { runSync } from '../../lib/sync.mjs';
import { runDelete } from '../../lib/delete.mjs';
import { loadState, worklists } from '../../lib/state.mjs';
import { runMd5fix } from '../../lib/md5fix.mjs';
import { inject } from '../../lib/upload.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runCycle({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai cycle <jie3|jie6> [--skip-upload] [--apply]'); e.code = 'E_USAGE'; throw e; }
  const cfg = loadConfig(id);
  const steps = [];
  log.step('cycle ① ready'); await ready(cfg, { secrets: loadSecrets(), log }); steps.push('ready');
  log.step('cycle ② sync'); await runSync(cfg, { log }); steps.push('sync');
  log.step(`cycle ③ delete（${flags.apply ? 'apply' : 'dry-run'}）`); await runDelete(cfg, { apply: !!flags.apply, log }); steps.push('delete');
  log.step('cycle ④ md5fix');
  const w = worklists(loadState(cfg.system.project.ledgerPath));
  const names = id === 'jie6' ? [...w.deliv_reupload] : [...w.test_reupload, ...w.test_toupload];
  if (names.length) await runMd5fix(cfg, names, { log }); steps.push('md5fix');
  // ⑤ upload —— 计划① 留桩
  if (flags['skip-upload']) { log.warn('cycle ⑤ upload 跳过（--skip-upload）'); steps.push('upload:skipped'); }
  else {
    try { await inject(/* cdp */ null, cfg, /* files */ []); steps.push('upload'); } // ★A9: 按 inject(cdp,cfg,files) 真实签名占位传参，计划②填实现时不致参数错位
    catch (e) { if (e.code === 'E_NOT_IMPL') { log.warn('cycle ⑤ upload 未实现（计划②）→ 等价 --skip-upload'); steps.push('upload:not-impl'); } else throw e; }
  }
  log.ok(`cycle ${id} 骨架跑完：${steps.join(' → ')}`);
  if (flags.json) out({ command: 'cycle', target: id, steps });
}
