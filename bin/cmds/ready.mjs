// ready：横切层·上下文就绪。把目标通道从任意页面收敛到「上传就绪」（可自启动）。非破坏性。
import { loadConfig, loadSecrets } from '../../lib/config.mjs';
import { ready } from '../../lib/session.mjs';
import { log, out } from '../../lib/log.mjs';

export async function runReady({ flags, pos }) {
  const id = pos[0];
  if (id !== 'jie3' && id !== 'jie6') { const e = new Error('用法: weilai ready <jie3|jie6>'); e.code = 'E_USAGE'; throw e; }
  const cfg = loadConfig(id);
  const secrets = loadSecrets();
  const res = await ready(cfg, { secrets, log });
  if (flags.json) out({ command: 'ready', target: id, ...res });
  else log.ok(`ready ${id}: ${res.ready ? '就绪' : '未就绪'}（steps: ${(res.steps || []).join('→') || '-'}）`);
}
