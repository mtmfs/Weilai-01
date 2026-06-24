// upload：inject → submit(逐文件超时) → bump（计划②上传核心）。
// 从 worklist 取待传/重传件，上传其 md5fix'd 文件（须先 ready + md5fix）。★会真上传到平台。
import { loadConfig } from '../../lib/config.mjs';
import { loadState, worklists } from '../../lib/state.mjs';
import { runUpload } from '../../lib/upload.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runUploadCmd({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai upload <jie3|jie6>（先 ready + md5fix）'); e.code = 'E_USAGE'; throw e; }
  const cfg = loadConfig(id);
  const w = worklists(loadState(cfg.system.project.ledgerPath));
  const names = id === 'jie6' ? [...w.deliv_toupload, ...w.deliv_reupload] : [...w.test_toupload, ...w.test_reupload];
  if (!names.length) { log.warn('worklist 空（先 sync）'); if (flags.json) out({ command: 'upload', injected: 0, submitted: 0 }); return; }
  const res = await runUpload(cfg, { names, mutate: !flags['no-mutate'], log });
  if (flags.json) out({ command: 'upload', target: id, ...res });
}
