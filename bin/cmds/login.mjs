// login：交互式录入端口/凭据/双通道标识（双模·全程无汉字）。
// ★账户名(汉字)不输入——保留现有 channels/*.json 的 account；运行期身份靠 aavid/planId 校验，不再回填 account。
//   只收 ASCII（port/email/pwd/aavid/planId/maxUploads，free+paid 各一组）→ 不碰 argv ASCII 铁律。
// TTY → 逐项 prompt（密码不回显）；非 TTY → 读 flag（防 AI 驱动卡死）。
// 写盘：channel 字段→channels/{free,paid 解析到的 id}.json（saveJson 原子+.bak）、凭据→secrets.json。
import readline from 'node:readline';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { ROOT, channelRegistry, loadTarget } from '../../lib/config.mjs';
import { saveJson } from '../../lib/config-write.mjs';
import { log, out } from '../../lib/log.mjs';

const DEF_PORT = { free: 24601, paid: 24602 };
const DEF_MAX = { free: 7, paid: 3 };

function usageErr(msg) { const e = new Error(msg); e.code = 'E_USAGE'; throw e; }
function parsePort(raw, role) {
  const s = String(raw);
  if (!/^[1-9]\d*$/.test(s)) usageErr(`${role} port 必须是 1..65535 整数，得到「${s}」`);
  const n = Number(s);
  if (n < 1 || n > 65535) usageErr(`${role} port 必须是 1..65535 整数，得到「${s}」`);
  return n;
}
function parsePositiveInt(raw, label) {
  const s = String(raw);
  if (!/^[1-9]\d*$/.test(s)) usageErr(`${label} 必须是正整数，得到「${s}」`);
  return Number(s);
}
function normalizeFields(role, fields = {}) {
  const out = { ...fields };
  if (out.port != null && out.port !== '') out.port = parsePort(out.port, role);
  if (out.max != null && out.max !== '') out.max = parsePositiveInt(out.max, `${role} maxUploads`);
  return out;
}

// free/paid → 内部 id。v1 在既有通道上配置；channels 不合法则早失败（不做零起步 bootstrap）。
function ids() {
  try { const r = channelRegistry(); return { free: r.testId, paid: r.delivId }; }
  catch (e) { const x = new Error(`login 需要 channels/*.json 已存在合法骨架（${e.message}）`); x.code = 'E_CONFIG'; throw x; }
}

// 读现有 channel（保留 account/role/ui/mode 等不变量），无则给最小骨架。
function baseChannel(id, role) {
  const p = join(ROOT, 'channels', `${id}.json`);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) {} }
  const isDeliv = role === 'paid';
  return { id, role: isDeliv ? 'delivery' : 'test', account: '', aavid: '', advId: '', mode: isDeliv ? '推直播间' : '推商品', planId: '', port: DEF_PORT[role], ui: isDeliv ? 'creative-tab' : 'drawer', funded: isDeliv, maxUploads: DEF_MAX[role], profileSuffix: isDeliv ? '-' + id : '' };
}

// 套字段（不动 account/role/ui/mode）。aavid 同时写 advId（二者同值）。
function applyFields(obj, role, { aavid, planId, port, max }) {
  if (aavid) { obj.aavid = String(aavid); obj.advId = String(aavid); }
  if (planId) obj.planId = String(planId);
  obj.port = port != null && port !== '' ? port : parsePort(obj.port || DEF_PORT[role], role);
  if (max != null && max !== '') obj.maxUploads = max;
  else obj.maxUploads = parsePositiveInt(obj.maxUploads || DEF_MAX[role], `${role} maxUploads`);
  return obj;
}

function writeSecrets(email, pwd) {
  const p = join(ROOT, 'secrets.json');
  let obj = {};
  if (existsSync(p)) { try { obj = JSON.parse(readFileSync(p, 'utf8')); } catch (e) {} }
  obj.mother = { email, pwd };
  saveJson(p, obj);
}

async function commit({ free, paid, email, pwd, log: L }) {
  const map = ids();
  free = normalizeFields('free', free);
  paid = normalizeFields('paid', paid);
  const prepared = [];
  for (const [role, fields] of [['free', free], ['paid', paid]]) {
    if (!fields || (!fields.aavid && !fields.planId)) continue;
    const id = map[role];
    const obj = applyFields(baseChannel(id, role), role, fields);
    prepared.push({ role, id, obj });
  }
  const written = [];
  for (const role of ['free', 'paid']) {
    if (!prepared.some(p => p.role === role)) L.warn(`${role} 通道：未提供 aavid/planId，跳过`);
  }
  for (const { role, id, obj } of prepared) {
    saveJson(join(ROOT, 'channels', `${id}.json`), obj);
    written.push({ role, id, port: obj.port });
    L.ok(`已写 channels/${id}.json（${role}·port=${obj.port}·account 保留=${obj.account || '空'}）`);
  }
  if (email && pwd) { writeSecrets(email, pwd); L.ok('已写 secrets.json（mother 凭据·gitignored·原子+.bak）'); }
  else L.warn('未提供邮箱/密码，secrets.json 未改');
  return written;
}

function fromFlags(flags) {
  return {
    email: flags.email, pwd: flags.pwd,
    free: { aavid: flags['free-aavid'], planId: flags['free-plan'], port: flags['free-port'], max: flags['free-max'] },
    paid: { aavid: flags['paid-aavid'], planId: flags['paid-plan'], port: flags['paid-port'], max: flags['paid-max'] },
  };
}

function ask(rl, q, def) {
  return new Promise((res) => rl.question(def != null && def !== '' ? `${q} [默认 ${def}]: ` : `${q}: `, (a) => res((a && a.trim()) || (def != null ? String(def) : ''))));
}
function askHidden(rl, q) {
  return new Promise((res) => {
    process.stdout.write(`${q}（输入不回显）: `);
    const orig = rl._writeToOutput;
    rl._writeToOutput = (s) => { if (s === '\n' || s === '\r\n' || s === '\r') orig.call(rl, '\n'); }; // 吞回显、放行换行
    rl.question('', (a) => { rl._writeToOutput = orig; res(a); });
  });
}

async function interactive(map) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const cur = {};
  for (const role of ['free', 'paid']) { try { cur[role] = loadTarget(map[role]); } catch (e) { cur[role] = {}; } }
  try {
    log.info('录入登录信息（长串可右键粘贴；回车=用默认/保留现值；全程无需输入汉字）');
    const fp = await ask(rl, '调试端口 free', cur.free.port || DEF_PORT.free);
    const pp = await ask(rl, '调试端口 paid', cur.paid.port || DEF_PORT.paid);
    const email = await ask(rl, '母账号邮箱');
    const pwd = await askHidden(rl, '母账号密码');
    const fa = await ask(rl, 'free 通道 aavid', cur.free.aavid || '');
    const fpl = await ask(rl, 'free 通道 planId', cur.free.planId || '');
    const fm = await ask(rl, 'free 通道 最大上传', cur.free.maxUploads || DEF_MAX.free);
    log.info('— 以下为 paid(付费·烧钱)通道；不配可直接回车跳过 —');
    const pa = await ask(rl, '*paid 通道 aavid', cur.paid.aavid || '');
    const ppl = await ask(rl, '*paid 通道 planId', cur.paid.planId || '');
    const pm = await ask(rl, '*paid 通道 最大上传', cur.paid.maxUploads || DEF_MAX.paid);
    return { email, pwd, free: { aavid: fa, planId: fpl, port: fp, max: fm }, paid: { aavid: pa, planId: ppl, port: pp, max: pm } };
  } finally { rl.close(); }
}

export async function runLogin({ flags }) {
  const map = ids(); // 早失败：channels 不合法直接报
  let input;
  if (process.stdin.isTTY && process.stdout.isTTY && !flags.email) {
    input = await interactive(map);
  } else {
    input = fromFlags(flags);
    if (!input.email || !input.pwd) usageErr('非交互需 --email <e> --pwd <p>（+ free/paid 至少一组 --*-aavid/--*-plan）');
    if ((!input.free.aavid || !input.free.planId) && (!input.paid.aavid || !input.paid.planId)) usageErr('至少配一个通道：--free-aavid+--free-plan 或 --paid-aavid+--paid-plan');
  }
  const written = await commit({ ...input, log });
  if (!written.length) log.warn('未写入任何通道（未提供 aavid/planId）');
  else log.ok(`login 完成：配置 ${written.map(w => w.role).join('+')}。下一步：\`ready free\` 登录就绪 → \`scan\` 确认标签。`);
  if (flags.json) out({ command: 'login', written });
}
