// 离线单测：enableFileLog 把 stderr 日志去色+加时间戳镜像到文件；out() 的 stdout 不进文件。run: node test/log-file-test.mjs
import assert from 'node:assert';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log, out, enableFileLog, logFile } from '../lib/log.mjs';

const p = join(tmpdir(), `weilai-logtest-${process.pid}.log`);
if (existsSync(p)) rmSync(p);

const ret = enableFileLog(p);
assert.strictEqual(ret, p, 'enableFileLog 返回路径');
assert.strictEqual(logFile(), p, 'logFile() 反映当前 sink');

log.ok('hello-ok');
log.warn('warn-line');
out({ secret: 'json-only-stdout' }); // 机器 JSON 走 stdout，不应进文件

const content = readFileSync(p, 'utf8');
assert.ok(/hello-ok/.test(content), '文件含 ok 内容');
assert.ok(/warn-line/.test(content), '文件含 warn 内容');
assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} /m.test(content), '每行带本地时间戳前缀');
assert.ok(!/\x1b\[/.test(content), '文件内容已去 ANSI 色码');
assert.ok(!/json-only-stdout/.test(content), 'out() 的 stdout JSON 不污染文件');

rmSync(p);
console.log('✓ log-file：时间戳 + 去色 + out 分离，全通过');
