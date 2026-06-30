// config：读写 system.json / channels/*.json（命令可改运营旋钮，免手翻文件）。
// ★set 默认 dry-run（打印 old→new、不写）；--apply 才落盘（config-write 原子写 + .bak）。
// ★只命令化 ASCII 字段：中文值（kw/account/mode）会被 bin/weilai.mjs 的 argv ASCII 闸门先行拦下(exit 2)
//   并提示写进 JSON——本命令不削弱该铁律，中文字段维持手改 channels/*.json。
// ★敏感字段（aavid/planId/funded/maxUploads，驱动有钱号真实投放/支出）dry-run 时额外 ⚠ 告警。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, loadTarget, REQUIRED_TARGET, resolveChannelArg } from '../../lib/config.mjs';
import { saveJson, getByPath, setByPath, coerceScalar } from '../../lib/config-write.mjs';
import { log, out, writeText } from '../../lib/log.mjs';

const SENSITIVE = new Set(['aavid', 'planId', 'funded', 'maxUploads']); // 驱动有钱号真实投放/支出

function usageErr(msg) { const e = new Error(msg); e.code = 'E_USAGE'; throw e; }
function cfgErr(msg) { const e = new Error(msg); e.code = 'E_CONFIG'; throw e; }

function validateChannelField(id, key, value) {
  if (key === 'port' && (!Number.isInteger(value) || value < 1 || value > 65535)) {
    usageErr(`${id}.port 必须是 1..65535 整数，得到「${value}」`);
  }
  if (key === 'maxUploads' && (!Number.isInteger(value) || value < 1)) {
    usageErr(`${id}.maxUploads 必须是正整数，得到「${value}」`);
  }
}

// 解析 target → 原始落盘 JSON（不走 loadSystem：它会派生 viewport，写回会污染文件）。
// 'system' → system.json（读原始）；其余 → channels/<id>.json（loadTarget = 读原始 + 校验 REQUIRED_TARGET，无派生字段）。
function resolveTarget(id) {
  if (id === 'system') {
    const path = join(ROOT, 'system.json');
    try { return { path, obj: JSON.parse(readFileSync(path, 'utf8')), isChannel: false, id }; }
    catch (e) { cfgErr(`读取/解析 ${path} 失败：${e.message}`); }
  }
  return { path: join(ROOT, 'channels', `${id}.json`), obj: loadTarget(id), isChannel: true, id };
}

function resolveConfigLabel(label) {
  if (label === 'system') return 'system';
  return resolveChannelArg(label, '用法: weilai config <get|set> <system|free|paid|通道> <a.b.c> [value]');
}

function doGet({ id, key, json }) {
  const { obj } = resolveTarget(id);
  const val = getByPath(obj, key);
  if (val === undefined) cfgErr(`键不存在：${id}.${key}`);
  if (json) { out({ command: 'config', action: 'get', target: id, key, value: val }); return; }
  writeText(typeof val === 'object' ? JSON.stringify(val) : String(val)); // 裸值 → 可脚本化
}

function doSet({ id, key, rawValue, apply, json }) {
  const { path, obj, isChannel } = resolveTarget(id);
  const oldVal = getByPath(obj, key);
  if (oldVal !== undefined && typeof oldVal === 'object') cfgErr(`${id}.${key} 是对象/数组，不支持命令行整体改；请手改 JSON。`);
  const newVal = coerceScalar(oldVal, rawValue); // 按旧值类型转（数字/布尔/字符串）；aavid/planId 是字符串→保持字符串
  if (isChannel) validateChannelField(id, key, newVal);
  // 在副本上干跑：set + （通道）REQUIRED_TARGET 完整性，确保改后文件仍合法，再决定是否落盘。
  const next = JSON.parse(JSON.stringify(obj));
  setByPath(next, key, newVal);
  if (isChannel) {
    const miss = REQUIRED_TARGET.filter((k) => next[k] === undefined);
    if (miss.length) cfgErr(`改后 channels/${id}.json 缺字段：${miss.join(', ')}`);
  }
  const topField = String(key).split('.')[0];
  const acctRisk = isChannel && (topField === 'aavid' || topField === 'planId'); // 指向错账户/计划（免费号也会投错地方）
  const moneyRisk = isChannel && !!obj.funded && SENSITIVE.has(topField);        // 有钱号上影响真实支出
  const sensitive = acctRisk || moneyRisk;
  log.step(`config set ${id}.${key}: ${JSON.stringify(oldVal)} → ${JSON.stringify(newVal)}${apply ? '' : '（dry-run·未写）'}`);
  if (acctRisk) log.warn(`${id}.${topField} 是账户/计划标识，误改会把操作指向错账户/计划——核对后再 --apply。`);
  if (moneyRisk) log.warn(`${id} 是付费投放通道(funded)，改 ${topField} 影响真实投放/支出——核对后再 --apply。`);
  if (!apply) {
    log.info('加 --apply 才真写（原子写 + .bak 备份旧值）。');
    if (json) out({ command: 'config', action: 'set', target: id, key, old: oldVal ?? null, new: newVal, applied: false, sensitive });
    return;
  }
  saveJson(path, next);
  log.ok(`已写 ${path}（旧值已备份为 .bak）`);
  if (json) out({ command: 'config', action: 'set', target: id, key, old: oldVal ?? null, new: newVal, applied: true, sensitive });
}

export async function runConfigCmd({ flags, pos }) {
  const action = pos[0];
  if (action === 'get') {
    const [, label, key] = pos;
    if (!label || !key) usageErr('用法: weilai config get <system|free|paid> <a.b.c> [--json]');
    doGet({ id: resolveConfigLabel(label), key, json: !!flags.json });
  } else if (action === 'set') {
    const [, label, key, value] = pos;
    if (!label || !key || value === undefined) usageErr('用法: weilai config set <system|free|paid> <a.b.c> <value> [--apply]（默认 dry-run；中文值请手改 JSON）');
    doSet({ id: resolveConfigLabel(label), key, rawValue: value, apply: !!flags.apply, json: !!flags.json });
  } else {
    usageErr('用法: weilai config <get|set> <system|free|paid> <a.b.c> [value] [--apply|--json]');
  }
}
