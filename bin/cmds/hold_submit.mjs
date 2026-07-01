// hold-submit: inject files, wait until upload can be confirmed, hold, then submit.
import { loadConfig, assertChannel } from '../../lib/config.mjs';
import { loadState, uploadNamesForRole, worklists } from '../../lib/state.mjs';
import { runUpload } from '../../lib/upload.mjs';
import { log, out } from '../../lib/log.mjs';

function nonNegativeNumberFlag(flags, name, fallback) {
  if (flags[name] == null) return fallback;
  const s = String(flags[name]);
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    const e = new Error(`--${name} 必须是非负数字，得到「${s}」`);
    e.code = 'E_USAGE';
    throw e;
  }
  return n;
}

export async function runHoldSubmitCmd({ flags, pos }) {
  const id = pos[0];
  assertChannel(id, '用法: weilai hold-submit <通道> [--delay-min N]');
  const cfg = loadConfig(id);
  const delayMin = nonNegativeNumberFlag(flags, 'delay-min', 10);
  const w = worklists(loadState(cfg.system.project.ledgerPath));
  const names = uploadNamesForRole(cfg.target.role, w);
  if (!names.length) {
    log.warn('worklist 空（先 sync）');
    if (flags.json) out({ command: 'hold-submit', injected: 0, submitted: 0, delayMin });
    return;
  }
  const res = await runUpload(cfg, { names, mutate: !flags['no-mutate'], log, holdDelayMin: delayMin });
  if (flags.json) out({ command: 'hold-submit', target: id, ...res });
}
