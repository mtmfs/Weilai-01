// clear-local：根据台账 stage 清洗本地源文件——scrapped→内容不合格/、delivered→已交付/，并删 md5fix 衍生副本。
// ★默认 dry-run（先看计划），--apply 才动盘。无需通道参数（按全局 stage 清洗）。
import { loadSystem } from '../../lib/config.mjs';
import { runClearLocal } from '../../lib/clearlocal.mjs';
import { log, out } from '../../lib/log.mjs';

export function runClearLocalCmd({ flags }) {
  const res = runClearLocal(loadSystem(), { apply: !!flags.apply, log });
  if (flags.json) out({ command: 'clear-local', ...res });
}
