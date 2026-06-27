// delete：删过审+被拒副本腾槽。★默认 dry-run（只打印清单），--apply 才真删。
import { loadConfig, assertChannel } from '../../lib/config.mjs';
import { runDelete } from '../../lib/delete.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runDeleteCmd({ flags, pos }) {
  const id = pos[0];
  assertChannel(id, '用法: weilai delete <通道> [--apply]');
  const res = await runDelete(loadConfig(id), { apply: !!flags.apply, log });
  if (flags.json) out({ command: 'delete', ...res });
}
