// inspect：查名字含某子串的视频在台账的状态（替代临时查询脚本）。只读，全局（台账是全局的，不分通道）。
import { loadSystem, channelRegistry } from '../../lib/config.mjs';
import { loadState } from '../../lib/state.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runInspect({ flags, pos }) {
  const sub = pos[0];
  if (!sub) { const e = new Error('用法: weilai inspect <名字片段>（如 inspect 张晟钰）'); e.code = 'E_USAGE'; throw e; }
  const sys = loadSystem();
  const state = loadState(sys.project.ledgerPath);
  const reg = channelRegistry();
  const hits = Object.values(state.videos || {}).filter(v => (v.name || '').includes(sub));
  if (!hits.length) { log.warn(`无匹配「${sub}」的视频`); if (flags.json) out({ command: 'inspect', sub, hits: [] }); return; }
  const fmt = (ch) => ch ? `传${ch.uploads || 0}${ch.passed ? '·过审' : ch.scrapped ? '·作废' : (ch.last_status === 2 ? '·被拒' : ch.last_status === 3 ? '·审核中' : '')}` : '—';
  log.info(`匹配「${sub}」: ${hits.length} 件`);
  for (const v of hits) log.info(`  [${v.stage}] ${v.name}  | free(${reg.testId}): ${fmt(v.ch && v.ch[reg.testId])}  | paid(${reg.delivId}): ${fmt(v.ch && v.ch[reg.delivId])}`);
  if (flags.json) out({ command: 'inspect', sub, count: hits.length, hits: hits.map(v => ({ name: v.name, stage: v.stage, ch: v.ch })) });
}
