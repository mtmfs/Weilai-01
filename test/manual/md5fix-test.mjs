// 一次性：对 flatRoot 里前 3 个 KW 视频改 MD5，输出到 I:\md5fix-test，验证并行 + 哈希真变。
import { loadConfig } from '../../lib/config.mjs';
import { runMd5fix } from '../../lib/md5fix.mjs';
import { log } from '../../lib/log.mjs';
import { readdirSync } from 'node:fs';
const cfg = loadConfig('jie3');
const root = cfg.system.project.flatRoot, kw = cfg.system.project.kw;
const all = readdirSync(root).filter(n => /\.(mp4|mov|m4v)$/i.test(n) && n.includes(kw));
const sample = all.slice(0, 3);
console.log('flatRoot:', root, '| KW件总数:', all.length, '| 取样:', sample);
const res = await runMd5fix(cfg, sample, { outDir: 'I:\\md5fix-test', workers: 3, log });
console.log('RESULT:', JSON.stringify(res, null, 1));
