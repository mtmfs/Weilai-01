// md5fix：对台账派生的待传/重传清单改 MD5（并行）。纯本地。
import { loadConfig, channelRegistry } from '../../lib/config.mjs';
import { loadState, uploadNamesForRole, worklists } from '../../lib/state.mjs';
import { runMd5fix } from '../../lib/md5fix.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runMd5fixCmd({ flags, pos }) {
  const id = pos[0] || channelRegistry().testId;
  const cfg = loadConfig(id);
  const state = loadState(cfg.system.project.ledgerPath);
  const w = worklists(state);
  const names = uploadNamesForRole(cfg.target.role, w);
  if (!names.length) { log.warn('无待改 MD5 的文件（worklist 空，先跑 sync）'); if (flags.json) out({ command: 'md5fix', total: 0 }); return; }
  const res = await runMd5fix(cfg, names, { outDir: flags.out, log });
  if (flags.json) out({ command: 'md5fix', ...res });
}
