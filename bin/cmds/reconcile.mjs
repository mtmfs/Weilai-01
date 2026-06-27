// reconcile：对账 Bug B —— un-bump 幻影上传（注入了但未真创建素材）。★默认 dry-run，--apply 才写台账。
import { loadConfig, assertChannel } from '../../lib/config.mjs';
import { runReconcile } from '../../lib/reconcile.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runReconcileCmd({ flags, pos }) {
  const id = pos[0];
  assertChannel(id, '用法: weilai reconcile <通道> [--apply] [--grace-min N]');
  const res = await runReconcile(loadConfig(id), { apply: !!flags.apply, graceMin: flags['grace-min'], log });
  if (flags.json) out({ command: 'reconcile', ...res });
}
