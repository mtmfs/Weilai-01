// reconcile：对账 Bug B —— un-bump 幻影上传（注入了但未真创建素材）。★默认 dry-run，--apply 才写台账。
import { loadConfig, assertChannel } from '../../lib/config.mjs';
import { runReconcile } from '../../lib/reconcile.mjs';
import { log, out } from '../../lib/log.mjs';

function nonNegativeIntFlag(flags, name) {
  if (flags[name] == null) return undefined;
  const s = String(flags[name]);
  if (!/^(0|[1-9]\d*)$/.test(s)) {
    const e = new Error(`--${name} 必须是非负整数，得到「${s}」`);
    e.code = 'E_USAGE';
    throw e;
  }
  return Number(s);
}

export async function runReconcileCmd({ flags, pos }) {
  const id = pos[0];
  assertChannel(id, '用法: weilai reconcile <通道> [--apply] [--grace-min N]');
  const graceMin = nonNegativeIntFlag(flags, 'grace-min');
  const res = await runReconcile(loadConfig(id), { apply: !!flags.apply, graceMin, log });
  if (flags.json) out({ command: 'reconcile', ...res });
}
