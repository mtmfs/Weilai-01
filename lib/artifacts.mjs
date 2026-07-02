// lib/artifacts.mjs —— 运行产物治理：安全清理 + 小文件轮转 + JSONL 流式读取。
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const ARTIFACT_DIRS = ['telemetry-out', 'test-out', 'logs'];
export const FIVE_MB = 5 * 1024 * 1024;
export const DEFAULT_TELEMETRY_ROTATION = { maxBytes: FIVE_MB, maxFiles: 5 };
export const DEFAULT_LOG_ROTATION = { maxBytes: FIVE_MB, maxFiles: 7 };

function assertInside(root, target) {
  const rr = resolve(root);
  const tr = resolve(target);
  const rel = relative(rr, tr);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return tr;
  const e = new Error(`拒绝访问工作区外路径: ${tr}`);
  e.code = 'E_CONFIG';
  throw e;
}

function rotationOpts(opts = {}, defaults = {}) {
  const maxBytes = Number(opts.maxBytes ?? defaults.maxBytes ?? FIVE_MB);
  const maxFiles = Number(opts.maxFiles ?? defaults.maxFiles ?? 5);
  return {
    maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : FIVE_MB,
    maxFiles: Number.isFinite(maxFiles) && maxFiles > 0 ? Math.floor(maxFiles) : 1,
  };
}

function rotatedPath(path, index) {
  return `${path}.${index}`;
}

export function rotateIfNeeded(path, incomingBytes = 0, opts = {}) {
  const { maxBytes, maxFiles } = rotationOpts(opts);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) return false;
  let size = 0;
  try { size = statSync(path).size; } catch (e) { return false; }
  if (size + incomingBytes <= maxBytes) return false;
  if (maxFiles <= 1) {
    rmSync(path, { force: true });
    return true;
  }
  const last = maxFiles - 1;
  rmSync(rotatedPath(path, last), { force: true });
  for (let i = last; i >= 1; i--) {
    const src = i === 1 ? path : rotatedPath(path, i - 1);
    const dst = rotatedPath(path, i);
    if (existsSync(src)) renameSync(src, dst);
  }
  return true;
}

export function createRotatingLineWriter(path, opts = {}) {
  const ro = rotationOpts(opts);
  mkdirSync(dirname(path), { recursive: true });
  return {
    path,
    writeLine(value) {
      const line = String(value).endsWith('\n') ? String(value) : `${value}\n`;
      rotateIfNeeded(path, Buffer.byteLength(line, 'utf8'), ro);
      appendFileSync(path, line, 'utf8');
    },
    writeJson(value) {
      this.writeLine(JSON.stringify(value));
    },
  };
}

function scanEntry(root, fullPath) {
  const st = statSync(fullPath);
  const rel = relative(root, fullPath).replace(/\\/g, '/');
  if (!st.isDirectory()) return [{ path: rel, type: 'file', bytes: st.size }];
  const out = [{ path: rel, type: 'dir', bytes: 0 }];
  for (const name of readdirSync(fullPath, { withFileTypes: true })) {
    out.push(...scanEntry(root, join(fullPath, name.name)));
  }
  return out;
}

export function scanArtifacts(root, dirs = ARTIFACT_DIRS) {
  const rr = resolve(root);
  return dirs.map((name) => {
    const path = assertInside(rr, join(rr, name));
    if (!existsSync(path)) return { name, path, exists: false, fileCount: 0, dirCount: 0, bytes: 0, entries: [] };
    const children = readdirSync(path, { withFileTypes: true });
    const entries = [];
    for (const child of children) entries.push(...scanEntry(rr, join(path, child.name)));
    return {
      name,
      path,
      exists: true,
      fileCount: entries.filter((e) => e.type === 'file').length,
      dirCount: entries.filter((e) => e.type === 'dir').length,
      bytes: entries.reduce((sum, e) => sum + (e.bytes || 0), 0),
      entries,
    };
  });
}

export function cleanArtifacts(root, { apply = false, dirs = ARTIFACT_DIRS } = {}) {
  const rr = resolve(root);
  const before = scanArtifacts(rr, dirs);
  if (apply) {
    for (const item of before) {
      const path = assertInside(rr, item.path);
      mkdirSync(path, { recursive: true });
      for (const child of readdirSync(path, { withFileTypes: true })) {
        const full = assertInside(rr, join(path, child.name));
        rmSync(full, { recursive: true, force: true });
      }
    }
  }
  const after = apply ? scanArtifacts(rr, dirs) : before;
  return {
    applied: !!apply,
    before,
    after,
    totals: before.reduce((acc, item) => {
      acc.fileCount += item.fileCount;
      acc.dirCount += item.dirCount;
      acc.bytes += item.bytes;
      return acc;
    }, { fileCount: 0, dirCount: 0, bytes: 0 }),
  };
}

export function forEachJsonlObject(path, onObject) {
  if (!existsSync(path)) return { records: 0, bad: 0 };
  const fd = openSync(path, 'r');
  const decoder = new StringDecoder('utf8');
  const buf = Buffer.allocUnsafe(64 * 1024);
  let carry = '';
  let records = 0;
  let bad = 0;
  const consume = (line) => {
    const s = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!s) return;
    try { onObject(JSON.parse(s)); records++; } catch (e) { bad++; }
  };
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      const text = carry + decoder.write(buf.subarray(0, n));
      const lines = text.split('\n');
      carry = lines.pop() || '';
      for (const line of lines) consume(line);
    }
    carry += decoder.end();
    if (carry) consume(carry);
  } finally {
    closeSync(fd);
  }
  return { records, bad };
}
