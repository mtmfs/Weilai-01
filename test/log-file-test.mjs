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

const p2 = join(tmpdir(), `weilai-logrotate-${process.pid}.log`);
for (const f of [p2, p2 + '.1', p2 + '.2']) if (existsSync(f)) rmSync(f);
assert.strictEqual(enableFileLog(p2, { maxBytes: 120, maxFiles: 2 }), p2, 'enableFileLog 支持轮转参数');
for (let i = 0; i < 12; i++) log.info('rotate-line-' + i + '-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
assert.ok(existsSync(p2), '轮转后当前日志存在');
assert.ok(existsSync(p2 + '.1'), '轮转后 .1 日志存在');
assert.ok(!existsSync(p2 + '.2'), 'maxFiles=2 时不保留 .2');

rmSync(p);
rmSync(p2, { force: true });
rmSync(p2 + '.1', { force: true });
console.log('✓ log-file：时间戳 + 去色 + out 分离 + 轮转，全通过');
