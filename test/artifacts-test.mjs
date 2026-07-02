// 离线单测：运行产物清理、轮转 JSONL writer、stats 流式读取。
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanArtifacts, createRotatingLineWriter } from '../lib/artifacts.mjs';
import { statsFromFile } from '../lib/telemetry.mjs';

const root = mkdtempSync(join(tmpdir(), 'weilai-artifacts-'));
try {
  const telemetry = join(root, 'telemetry-out');
  const testOut = join(root, 'test-out');
  const logs = join(root, 'logs');
  mkdirSync(telemetry, { recursive: true });
  mkdirSync(testOut, { recursive: true });
  mkdirSync(logs, { recursive: true });

  writeFileSync(join(telemetry, 'old.jsonl'), '{"kind":"mark"}\n', 'utf8');
  mkdirSync(join(testOut, 'nested'), { recursive: true });
  writeFileSync(join(testOut, 'nested', 'dom.json'), '{}\n', 'utf8');
  writeFileSync(join(logs, 'run.log'), 'line\n', 'utf8');

  const dry = cleanArtifacts(root);
  assert.strictEqual(dry.applied, false, '默认 dry-run');
  assert.strictEqual(dry.totals.fileCount, 3, 'dry-run 应统计全部文件');
  assert.ok(existsSync(join(telemetry, 'old.jsonl')), 'dry-run 不删除');

  const applied = cleanArtifacts(root, { apply: true });
  assert.strictEqual(applied.applied, true, '--apply 应执行删除');
  assert.strictEqual(applied.after.reduce((n, d) => n + d.fileCount + d.dirCount, 0), 0, '清理后目录内容为空');
  assert.ok(existsSync(telemetry) && existsSync(testOut) && existsSync(logs), '顶层产物目录保留');

  const rec = join(telemetry, 'rec-test.jsonl');
  const writer = createRotatingLineWriter(rec, { maxBytes: 80, maxFiles: 3 });
  for (let i = 0; i < 8; i++) writer.writeJson({ kind: 'req', ts: 1700000000000 + i, url: `https://x.test/api/${i}` });
  assert.ok(existsSync(rec), '当前分片存在');
  assert.ok(existsSync(rec + '.1'), '轮转分片 .1 存在');
  assert.ok(existsSync(rec + '.2'), '轮转分片 .2 存在');
  assert.ok(!existsSync(rec + '.3'), '不超过 maxFiles 分片数');

  const statsFile = join(telemetry, 'stats.jsonl');
  const t = Date.UTC(2026, 0, 1, 8, 0, 0);
  writeFileSync(statsFile, [
    JSON.stringify({ kind: 'req', ts: t, url: 'https://x.test/material/list' }),
    JSON.stringify({ kind: 'resp', ts: t + 120, status: 200, url: 'https://x.test/material/list' }),
    'bad-json',
    '',
  ].join('\n'), 'utf8');
  const stats = statsFromFile(statsFile);
  assert.strictEqual(stats.events, 2, 'stats 应只统计有效 JSONL 行');
  assert.strictEqual(stats.bad, 1, 'stats 应报告坏行');
  assert.deepStrictEqual(stats.endpointAvgMs, { list: 120 }, 'req→resp 时长应正确聚合');
  assert.strictEqual(stats.hours[String(new Date(t).getHours())].reqs, 1, '按本地小时统计请求');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('artifacts：清理 + 轮转 + stats 流式读取全通过 ✓');
