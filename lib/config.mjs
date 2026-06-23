// 配置载入：system.json（机器 + 项目级） + targets/<id>.json（通道级）。
// 所有硬编码（路径/账户/计划/端口/关键词/ffmpeg）都外提到这两类文件，
// 命令行只用 ASCII 名引用目标（jie3/jie6），中文只存在 JSON 里。
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function cfgErr(msg) {
  const e = new Error(msg);
  e.code = 'E_CONFIG';
  return e;
}

function readJson(p) {
  let raw;
  try {
    raw = readFileSync(p, 'utf8');
  } catch (e) {
    throw cfgErr(`读取 ${p} 失败：${e.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw cfgErr(`解析 ${p} 失败（JSON 格式错）：${e.message}`);
  }
}

export function loadSystem() {
  const sys = readJson(join(ROOT, 'system.json'));
  for (const k of ['project', 'chrome', 'ffmpeg', 'timeouts', 'concurrency']) {
    if (!sys[k]) throw cfgErr(`system.json 缺字段：${k}`);
  }
  if (!sys.project.ledgerPath) throw cfgErr('system.json.project 缺 ledgerPath');
  return sys;
}

const REQUIRED_TARGET = ['id', 'role', 'account', 'aavid', 'mode', 'planId', 'port', 'ui', 'maxUploads'];

export function loadTarget(id) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw cfgErr(`非法 target 名：「${id}」（只允许 ASCII 字母数字/-/_）`);
  const t = readJson(join(ROOT, 'targets', `${id}.json`));
  const miss = REQUIRED_TARGET.filter((k) => t[k] === undefined);
  if (miss.length) throw cfgErr(`targets/${id}.json 缺字段：${miss.join(', ')}`);
  return t;
}

// 合并：通道运行所需的完整上下文（系统 + 目标 + 派生 profile）。
export function loadConfig(id) {
  const system = loadSystem();
  const target = loadTarget(id);
  const profile = `${system.chrome.profileBase}${id === 'jie3' ? '' : '-' + id}`;
  return { system, target, profile };
}

// 由 targets/*.json 构建台账 channels（让配置成为通道事实唯一真源；喂给 state.syncChannels）。
export function loadChannels(ids = ['jie3', 'jie6']) {
  const channels = {};
  for (const id of ids) {
    const t = loadTarget(id);
    channels[id] = { role: t.role, account: t.account, aavid: t.aavid, mode: t.mode, planId: t.planId, funded: t.funded, maxUploads: t.maxUploads };
  }
  return { channels, pipeline: ids };
}

// 母账号凭据：优先环境变量，其次 secrets.json（gitignored，永不入库）。无则返回 null（login 动作会给指引）。
export function loadSecrets() {
  if (process.env.QC_MOTHER_EMAIL && process.env.QC_MOTHER_PWD) {
    return { email: process.env.QC_MOTHER_EMAIL, pwd: process.env.QC_MOTHER_PWD };
  }
  const p = join(ROOT, 'secrets.json');
  if (existsSync(p)) {
    try {
      const s = JSON.parse(readFileSync(p, 'utf8'));
      if (s.mother && s.mother.email && s.mother.pwd) return { email: s.mother.email, pwd: s.mother.pwd };
    } catch (e) {}
  }
  return null;
}
