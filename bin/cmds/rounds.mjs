// test-round / deliver-round —— 一轮业务（丛2）。组合横切层 ready + 叶子 sync/delete/md5fix/upload。
import { loadConfig, loadSecrets, channelRegistry } from '../../lib/config.mjs';
import { ready } from '../../lib/session.mjs';
import { runSync } from '../../lib/sync.mjs';
import { runDelete } from '../../lib/delete.mjs';
import { runMd5fix } from '../../lib/md5fix.mjs';
import { runUpload } from '../../lib/upload.mjs';
import { loadState, worklists } from '../../lib/state.mjs';
import { log, out } from '../../lib/log.mjs';

// test-round(jie3): ready → sync → delete → md5fix → upload。★含真上传到 jie3（免费测试通道）。
export async function runTestRound({ flags, pos }) {
  const id = pos[0] || channelRegistry().testId;
  const cfg = loadConfig(id);
  if (cfg.target.role !== 'test') { const e = new Error('test-round 仅限测试通道（role=test）；投放通道用 deliver-round'); e.code = 'E_USAGE'; throw e; }
  log.step('test-round ① ready'); await ready(cfg, { secrets: loadSecrets(), log });
  log.step('test-round ② sync'); const s = await runSync(cfg, { log });
  // ★穿 sync 刚拉的 platform 快照给 delete → 免其重复拉取（同账户 sync 已 guardEnter 过）。
  log.step(`test-round ③ delete（${flags.apply ? 'apply' : 'dry-run'}）`); await runDelete(cfg, { apply: !!flags.apply, log, platform: s.platform });
  const names = (() => { const w = worklists(loadState(cfg.system.project.ledgerPath)); return [...w.test_reupload, ...w.test_toupload]; })();
  log.step(`test-round ④ md5fix（${names.length} 件）`); if (names.length) await runMd5fix(cfg, names, { log });
  log.step('test-round ⑤ upload');
  let up = { injected: 0, submitted: 0, skipped: true };
  if (flags['skip-upload']) log.warn('upload 跳过（--skip-upload）');
  else up = await runUpload(cfg, { names, log });
  log.ok(`test-round ${id} 完成：注入 ${up.injected || 0} / 平台确认 ${up.submitted || 0}${up.dedup ? '（幂等跳过）' : ''}`);
  if (flags.json) out({ command: 'test-round', target: id, sync: s.stages, upload: up });
}

// deliver-round(jie6): ready → sync → md5fix → upload（sealed→jie6 投放）。
// ⚠️ jie6=有钱账户(投放中)且冷 profile 登录+创意tab 收敛未通 → 本命令结构完整但未 live 验证，谨慎。
export async function runDeliverRound({ flags, pos }) {
  const id = channelRegistry().delivId;
  const cfg = loadConfig(id);
  log.warn('⚠️ deliver-round 操作 jie6（有钱账户·投放中）；jie6 登录/创意tab 未通，未 live 验证——谨慎，建议先 --skip-upload 走骨架。');
  log.step('deliver-round ① ready'); await ready(cfg, { secrets: loadSecrets(), log });
  log.step('deliver-round ② sync'); const s = await runSync(cfg, { log });
  const names = (() => { const w = worklists(loadState(cfg.system.project.ledgerPath)); return [...w.deliv_toupload]; })();
  log.step(`deliver-round ③ md5fix（${names.length} 件 sealed）`); if (names.length) await runMd5fix(cfg, names, { log });
  log.step('deliver-round ④ upload');
  let up = { injected: 0, submitted: 0, skipped: true };
  if (flags['skip-upload']) log.warn('upload 跳过（--skip-upload）');
  else up = await runUpload(cfg, { names, log });
  log.ok(`deliver-round 完成：注入 ${up.injected || 0} / 平台确认 ${up.submitted || 0}${up.dedup ? '（幂等跳过）' : ''}`);
  if (flags.json) out({ command: 'deliver-round', target: id, sync: s.stages, upload: up });
}
