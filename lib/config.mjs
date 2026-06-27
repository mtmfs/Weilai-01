// 配置载入：system.json（机器 + 项目级） + channels/<id>.json（通道级）。
// 所有硬编码（路径/账户/计划/端口/关键词/ffmpeg）都外提到这两类文件，
// 命令行只用 ASCII 名引用目标（jie3/jie6），中文只存在 JSON 里。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
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

// 从 chrome.flags 的 --window-size=W,H 派生虚拟视口（hardenViewport 用）。以该 flag 为单一真源，
// 避免视口尺寸在 system.json 与 cdp.mjs 双写漂移（漂移会让坐标点击落屏外，即 NO_CHOOSER 根因）。
function parseWindowSize(flags = []) {
  for (const f of flags) {
    const m = /^--window-size=(\d+),(\d+)$/.exec(String(f).trim());
    if (m) return { width: Number(m[1]), height: Number(m[2]) };
  }
  return { width: 1920, height: 1080 }; // flag 缺失兜底（与历史默认一致）
}

export function loadSystem() {
  const sys = readJson(join(ROOT, 'system.json'));
  for (const k of ['project', 'chrome', 'ffmpeg', 'timeouts', 'concurrency']) {
    if (!sys[k]) throw cfgErr(`system.json 缺字段：${k}`);
  }
  if (!sys.project.ledgerPath) throw cfgErr('system.json.project 缺 ledgerPath');
  sys.chrome.viewport = parseWindowSize(sys.chrome.flags); // ★视口单一真源（喂 hardenViewport，见 cdp.mjs）
  return sys;
}

export const REQUIRED_TARGET = ['id', 'role', 'account', 'aavid', 'mode', 'planId', 'port', 'ui', 'maxUploads'];

export function loadTarget(id) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw cfgErr(`非法 target 名：「${id}」（只允许 ASCII 字母数字/-/_）`);
  const t = readJson(join(ROOT, 'channels', `${id}.json`));
  const miss = REQUIRED_TARGET.filter((k) => t[k] === undefined);
  if (miss.length) throw cfgErr(`channels/${id}.json 缺字段：${miss.join(', ')}`);
  return t;
}

// 合并：通道运行所需的完整上下文（系统 + 目标 + 派生 profile）。
export function loadConfig(id) {
  const system = loadSystem();
  const target = loadTarget(id);
  // profile 目录 = profileBase + 通道后缀。后缀以 channels/*.json 的 profileSuffix 为单一真源（M2）；
  // 缺该字段则回退旧规则（jie3='' / 其余='-'+id），保证老配置零破坏、行为字节等价。
  const profile = `${system.chrome.profileBase}${target.profileSuffix ?? (id === 'jie3' ? '' : '-' + id)}`;
  return { system, target, profile };
}

// 发现已配置通道 id：扫 channels/*.json（字母序）。换号/改名只增删该目录文件，命令层不再硬编 jie3/jie6。
export function discoverChannelIds() {
  let files;
  try { files = readdirSync(join(ROOT, 'channels')); }
  catch (e) { throw cfgErr(`读取 channels/ 目录失败：${e.message}`); }
  const ids = files.filter((f) => /^[a-z0-9_-]+\.json$/i.test(f)).map((f) => f.replace(/\.json$/i, '')).sort();
  if (!ids.length) throw cfgErr('channels/ 下无任何通道配置（*.json）');
  return ids;
}

// 通道注册表：建 {ids, testId, delivId, byId} 并断言"恰好 1 个 test + 1 个 delivery"。
// ★这是双通道不变量的唯一守门处——多丢一个 channels/*.json 会在此 E_CONFIG，挡它静默喂进 2 段状态机/台账。
// ids 按 role 序返回 [test, delivery]（= 流水线顺序），供 status/run 等消费。
export function channelRegistry() {
  const byRole = { test: [], delivery: [] };
  const byId = {};
  for (const id of discoverChannelIds()) {
    const t = loadTarget(id); byId[id] = t;
    if (t.role === 'test' || t.role === 'delivery') byRole[t.role].push(id);
    else throw cfgErr(`channels/${id}.json role 非法：「${t.role}」（只允许 test|delivery）`);
  }
  if (byRole.test.length !== 1 || byRole.delivery.length !== 1) {
    throw cfgErr(`双通道不变量被破坏：需恰好 1 个 test + 1 个 delivery，实得 test=[${byRole.test.join(',')}] delivery=[${byRole.delivery.join(',')}]。当前仅支持双通道（见灵活性修补册 A8）。`);
  }
  const testId = byRole.test[0], delivId = byRole.delivery[0];
  return { ids: [testId, delivId], testId, delivId, byId };
}

// 命令层通道校验：id 必须是已配置通道，否则抛 E_USAGE（usageHint = 各命令自带用法串）。
export function assertChannel(id, usageHint) {
  const ids = discoverChannelIds();
  if (!id || !ids.includes(id)) { const e = new Error(`${usageHint}（通道: ${ids.join('|')}）`); e.code = 'E_USAGE'; throw e; }
  return id;
}

// 由 channels/*.json 构建台账 channels（让配置成为通道事实唯一真源；喂给 state.syncChannels）。
// 默认（ids=null）从注册表取，pipeline 按 role 序 [test, delivery]——非字母序，保住状态机 [testId,delivId]=pipeline 假设。
export function loadChannels(ids = null) {
  const reg = ids ? null : channelRegistry();
  const useIds = ids || reg.ids;
  const channels = {};
  for (const id of useIds) {
    const t = (reg && reg.byId[id]) || loadTarget(id);
    channels[id] = { role: t.role, account: t.account, aavid: t.aavid, mode: t.mode, planId: t.planId, funded: t.funded, maxUploads: t.maxUploads };
  }
  return { channels, pipeline: useIds };
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
