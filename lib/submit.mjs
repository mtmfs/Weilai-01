// lib/submit.mjs —— 上传核心·提交（计划②实现）。计划① 只留接口桩，不改其签名。
//
// 契约（计划② 须实现）：
//   submit(cdp, cfg, opts) → 保活等上传完成（★逐文件超时：谁传完谁走、龟速件短超时踢回，不整批门控）
//                            → 点确定 → 连点「确认添加 N 个」→ 返回 {submitted:N, mids:[...]}（真提交数喂 bump）。
//   holdSubmit(cdp, cfg, {at}) → 把已 100% 未提交的素材挂起，到遥测窗口择时一口气提交（TTL 实测转正后才用）。
const notImpl = (fn) => Object.assign(new Error(`submit.${fn} 未实现（计划②·上传核心）`), { code: 'E_NOT_IMPL' });

export async function submit(/* cdp, cfg, opts */) { throw notImpl('submit'); }
export async function holdSubmit(/* cdp, cfg, opts */) { throw notImpl('holdSubmit'); }
