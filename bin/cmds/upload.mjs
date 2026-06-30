// upload：inject → submit(逐文件超时) → bump（计划②上传核心）。
// 从 worklist 取待传/重传件，上传其 md5fix'd 文件（须先 ready + md5fix）。★会真上传到平台。
import { loadConfig, assertChannel } from '../../lib/config.mjs';
import { loadState, uploadNamesForRole, worklists } from '../../lib/state.mjs';
import { runUpload } from '../../lib/upload.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runUploadCmd({ flags, pos }) {
  const id = pos[0];
  assertChannel(id, '用法: weilai upload <通道>（先 ready + md5fix）');
  const cfg = loadConfig(id);
  const w = worklists(loadState(cfg.system.project.ledgerPath));
  const names = uploadNamesForRole(cfg.target.role, w);
  if (!names.length) { log.warn('worklist 空（先 sync）'); if (flags.json) out({ command: 'upload', injected: 0, submitted: 0 }); return; }
  const res = await runUpload(cfg, { names, mutate: !flags['no-mutate'], log });
  if (flags.json) out({ command: 'upload', target: id, ...res });
}
