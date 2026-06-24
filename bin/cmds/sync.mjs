// sync：拉平台审核现实归一进台账（读平台 + 写台账，不动平台）。
// 默认全量（翻页+norm 匹配，作 reconcile）；--incremental 走 S1 mid 增量（只查在飞 last_mid，O(在飞)）。
import { loadConfig } from '../../lib/config.mjs';
import { runSync, runSyncIncremental } from '../../lib/sync.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runSyncCmd({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai sync <jie3|jie6> [--no-mutate] [--incremental]'); e.code = 'E_USAGE'; throw e; }
  const fn = flags.incremental ? runSyncIncremental : runSync;
  const res = await fn(loadConfig(id), { mutate: !flags['no-mutate'], log });
  if (flags.json) out({ command: 'sync', ...res });
}
