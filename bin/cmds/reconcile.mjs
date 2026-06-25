// reconcile：对账 Bug B —— un-bump 幻影上传（注入了但未真创建素材）。★默认 dry-run，--apply 才写台账。
import { loadConfig } from '../../lib/config.mjs';
import { runReconcile } from '../../lib/reconcile.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runReconcileCmd({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai reconcile <jie3|jie6> [--apply] [--grace-min N]'); e.code = 'E_USAGE'; throw e; }
  const res = await runReconcile(loadConfig(id), { apply: !!flags.apply, graceMin: flags['grace-min'], log });
  if (flags.json) out({ command: 'reconcile', ...res });
}
