// prep（局部流水线·丛2 环节）：sync → delete(先dry后apply) → md5fix。
import { loadConfig } from '../../lib/config.mjs';
import { runSync } from '../../lib/sync.mjs';
import { runDelete } from '../../lib/delete.mjs';
import { loadState, worklists } from '../../lib/state.mjs';
import { runMd5fix } from '../../lib/md5fix.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runPrep({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai prep <jie3|jie6> [--apply]'); e.code = 'E_USAGE'; throw e; }
  const cfg = loadConfig(id);
  log.step('prep ①/3 sync'); const s = await runSync(cfg, { log });
  log.step(`prep ②/3 delete（${flags.apply ? 'apply' : 'dry-run'}）`); const d = await runDelete(cfg, { apply: !!flags.apply, log });
  log.step('prep ③/3 md5fix');
  const w = worklists(loadState(cfg.system.project.ledgerPath));
  const names = id === 'jie6' ? [...w.deliv_reupload] : [...w.test_reupload, ...w.test_toupload];
  const m = names.length ? await runMd5fix(cfg, names, { log }) : { total: 0 };
  log.ok(`prep ${id} 完成`);
  if (flags.json) out({ command: 'prep', sync: s, delete: d, md5fix: m });
}
