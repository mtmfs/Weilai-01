// lib/guard.mjs —— 横切层·韧性（可自修复）。
// 碰浏览器的动作跑在 guardEnter 里：动作前 扫弹窗 + 断言身份（aavid/计划/会话），漂移/掉登录/签名过期自动恢复一次，恢复不了给稳定退出码。
// 注：完整 PRE+POST 版 guard()/withGuard() 已实现、暂未接线（预留将来给写动作加后置断言）。
import { connect } from './cdp.mjs';
import { probePlan, probeUrl, probeSessionWarm, closePopup, ssoHandshake } from './session.mjs';
import { URLS, URL_RE } from './selectors.mjs';

// 稳定退出码契约（CLI 与编排器共用；见 plan §十）。
export const EXIT = { OK: 0, RUNTIME: 1, USAGE: 2, DRIFT: 10, LOGIN: 11, SIG: 12, ROI: 13, SELECTOR: 14, GESTURE: 15, FREEZE_SKIP: 16, SINGLETON: 17, LOCK: 18, CONFIG: 20, NOT_IMPL: 64 };
export const CODE_TO_EXIT = {
  E_DRIFT: 10, E_LOGIN: 11, E_SIG: 12, E_ROI: 13, E_SELECTOR: 14, E_GESTURE: 15, E_FREEZE_SKIP: 16, E_SINGLETON: 17, E_LOCK: 18, E_CONFIG: 20, E_USAGE: 2, E_NOT_IMPL: 64,
};
const err = (code, msg) => Object.assign(new Error(msg), { code });

// 断言当前页仍是期望的 aavid+计划+会话。不符抛带 code 的错。
export async function assertIdentity(cdp, target) {
  const u = await probeUrl(cdp);
  if (URL_RE.sessionCold.test(u || '')) throw err('E_LOGIN', '被弹回登录页');
  if (!await probeSessionWarm(cdp)) throw err('E_SIG', '会话冷/签名失效');
  if (!new RegExp('aavid=' + String(target.aavid) + '(?!\\d)').test((u || '').replace(/&amp;/g, '&'))) throw err('E_DRIFT', `aavid 不在位：${target.aavid}`);
  if (await probePlan(cdp, target.ui, target.planId) !== 1) throw err('E_DRIFT', `计划不在位：${target.planId}`);
  return true;
}

// 尝试一次恢复：漂移/会话冷 → 重握手 + 重锚 uni-prom?aavid。掉登录 → 不在此自动重登（需凭据，交 ready）。
async function recoverOnce(cdp, cfg) {
  const { target } = cfg;
  await closePopup(cdp);
  await ssoHandshake(cdp, target.advId);
  if (target.ui === 'drawer') {
    await cdp.send('Page.navigate', { url: URLS.uniProm(target.aavid) });
  } else {
    await cdp.send('Page.navigate', { url: URLS.uniPromDetail(target.aavid, target.planId) });
  }
  await new Promise(r => setTimeout(r, 10000));
  await closePopup(cdp);
}

// guard：包一个 stepFn(cdp)。前置扫弹窗+断言（漂移可恢复1次），跑 step，后置再扫+断言。
export async function guard(cdp, cfg, stepFn, { log, allowRecover = true } = {}) {
  const L = log || { warn() {}, step() {} };
  // PRE
  await closePopup(cdp);
  try { await assertIdentity(cdp, cfg.target); }
  catch (e) {
    if (allowRecover && (e.code === 'E_DRIFT' || e.code === 'E_SIG')) {
      L.warn(`前置断言失败(${e.code})：${e.message} → 尝试恢复一次`);
      await recoverOnce(cdp, cfg);
      await assertIdentity(cdp, cfg.target); // 再不过就抛出去
    } else throw e;
  }
  // ACTION
  const res = await stepFn(cdp);
  // POST
  await closePopup(cdp);
  await assertIdentity(cdp, cfg.target);
  return res;
}

// ★A3: 入口护栏（PRE-only）。用于 sync/delete 这类"动作本身会改变页面、不适合 POST 断言"的命令：
// 在碰平台前 扫弹窗 + 断言身份（aavid/计划/会话），漂移/会话冷自动恢复一次，恢复不了带 code 抛出。
export async function guardEnter(cdp, cfg, { log, allowRecover = true } = {}) {
  const L = log || { warn() {} };
  await closePopup(cdp);
  try { await assertIdentity(cdp, cfg.target); }
  catch (e) {
    if (allowRecover && (e.code === 'E_DRIFT' || e.code === 'E_SIG')) {
      L.warn(`入口断言失败(${e.code})：${e.message} → 尝试恢复一次`);
      await recoverOnce(cdp, cfg);
      await assertIdentity(cdp, cfg.target); // 再不过就抛出去
    } else throw e;
  }
}

// 便捷：自行连标签 + guard 跑 step（多数命令用这个）。
export async function withGuard(cfg, stepFn, opts = {}) {
  const cdp = await connect({ port: cfg.target.port, aavid: cfg.target.aavid });
  try {
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('Page.bringToFront');
    return await guard(cdp, cfg, stepFn, opts);
  } finally { cdp.close(); }
}
