// delete：删过审+被拒副本腾槽。★默认 dry-run（只打印清单），--apply 才真删。
import { loadConfig } from '../../lib/config.mjs';
import { runDelete } from '../../lib/delete.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runDeleteCmd({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai delete <jie3|jie6> [--apply]'); e.code = 'E_USAGE'; throw e; }
  const res = await runDelete(loadConfig(id), { apply: !!flags.apply, log });
  if (flags.json) out({ command: 'delete', ...res });
}
