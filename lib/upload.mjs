// lib/upload.mjs —— 上传核心·注入（计划②实现）。计划① 只留接口桩，不改其签名。
// 代码缝：计划② 填实现、不动计划① 任何模块。
//
// 契约（计划② 须实现）：
//   openUploadPanel(cdp, cfg) → 在已就绪视图上打开「添加视频→上传视频」面板，返回 {ready:bool}。
//   inject(cdp, cfg, files, opts) → 把 files(本地路径数组) 逐文件/流水线灌进上传控件（滑动窗口、卡死踢回）。
//                                   返回 {injected:[name], window:n}；不提交。
const notImpl = (fn) => Object.assign(new Error(`upload.${fn} 未实现（计划②·上传核心）`), { code: 'E_NOT_IMPL' });

export async function openUploadPanel(/* cdp, cfg */) { throw notImpl('openUploadPanel'); }
export async function inject(/* cdp, cfg, files, opts */) { throw notImpl('inject'); }
