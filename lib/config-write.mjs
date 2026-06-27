// lib/config-write.mjs —— 配置原子写 + 点分键读写 + 标量类型转换（供 `weilai config get/set`）。
// 原子写镜像 lib/state.mjs::saveState（tmp → 备份 .bak → rename）：坏写绝不毁原文件、抗崩溃。
import { writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs';

function cfgErr(msg) { const e = new Error(msg); e.code = 'E_CONFIG'; return e; }

// 原子写：临时文件 → 备份现有为 .bak（非致命）→ rename。与 state.saveState 同款。
export function saveJson(p, obj) {
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  if (existsSync(p)) { try { copyFileSync(p, p + '.bak'); } catch (e) {} }
  renameSync(tmp, p);
}

// 点分键读：getByPath(obj, 'a.b.c')。缺路径返回 undefined（不抛）。
export function getByPath(obj, dotted) {
  return String(dotted).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// 点分键写：原地 setByPath(obj,'a.b.c',v)。中途缺对象则报错——不擅自造中间结构，避免把 schema 写歪。
export function setByPath(obj, dotted, value) {
  const keys = String(dotted).split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (o[k] == null || typeof o[k] !== 'object') {
      throw cfgErr(`键路径不存在：${keys.slice(0, i + 1).join('.')}（不自动创建中间结构，避免写歪 schema）`);
    }
    o = o[k];
  }
  o[keys[keys.length - 1]] = value;
  return obj;
}

// 标量类型转换：把命令行字符串按"旧值类型"转换——旧值是数字→Number、布尔→Boolean，其余保持字符串。
// 以旧值类型为准 = 无需维护字段类型表、天然对齐 schema（aavid/planId 是字符串 → 保持字符串）。
// 旧值不存在（新键）才尽力推断：纯数字串→Number、true/false→Boolean。
export function coerceScalar(oldVal, raw) {
  const t = typeof oldVal;
  if (t === 'number') { const n = Number(raw); if (!Number.isFinite(n)) throw cfgErr(`期望数字，得到「${raw}」`); return n; }
  if (t === 'boolean') { if (raw === 'true') return true; if (raw === 'false') return false; throw cfgErr(`期望 true/false，得到「${raw}」`); }
  if (oldVal === undefined) {
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  }
  return raw;
}
