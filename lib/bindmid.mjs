// lib/bindmid.mjs —— jie6 上传 mid 捕获：从提交期 bind-video-to-owner 请求解析 file_name → materialId。
//
// ★真实结构（2026-07-02 真号 jie6 抓包确认）：一个 bind-video-to-owner 请求即含全部映射：
//   req : {"vids":[{"file_name":"xxx.mp4","video_id":"v0dc8..."}]}          （name ↔ vid）
//   resp: {"data":{"vidToMidMap":{"V0Dc8...":"7657783787443699750"}}}       （vid ↔ materialId）
//   ★坑：req 的 video_id 全小写、resp vidToMidMap 的 key 混合大小写 → join 必须大小写归一，否则查不到。
//   URL 判据见 selectors.URL_RE.bindVideo=/bind-video-to-owner/（已验证命中）。不需 add-materials/create 二次 join。

// 从收集到的请求事件解析 name→mid。events=[{url,reqBody,respBody}]（cdp.openRequestCollector 产出）。
// kw 过滤 file_name；vid 大小写不敏感 join。纯函数、可离线单测。
export function parseBindMids(events, { norm = (s) => String(s), kw = '', urlRe = /bind-video-to-owner/ } = {}) {
  const midByName = new Map();
  let sawBind = false;
  for (const ev of events || []) {
    if (urlRe && !urlRe.test((ev && ev.url) || '')) continue;
    let req = null, resp = null;
    try { req = JSON.parse(ev.reqBody); } catch (e) {}
    try { resp = JSON.parse(ev.respBody); } catch (e) {}
    const vids = req && Array.isArray(req.vids) ? req.vids : [];
    const midMap = (resp && resp.data && resp.data.vidToMidMap && typeof resp.data.vidToMidMap === 'object') ? resp.data.vidToMidMap : {};
    // vid→mid 大小写不敏感表（resp key 与 req video_id 大小写不一致）
    const lcMap = {};
    for (const k of Object.keys(midMap)) lcMap[String(k).toLowerCase()] = midMap[k];
    for (const v of vids) {
      if (!v || v.file_name == null || v.video_id == null) continue;
      if (kw && !String(v.file_name).includes(kw)) continue;
      const mid = lcMap[String(v.video_id).toLowerCase()];
      if (mid != null) { sawBind = true; midByName.set(norm(v.file_name), String(mid)); }
    }
  }
  return { midByName, sawBind };
}

// 合并两个 name→mid Map：primary 覆盖 secondary（primary 胜、secondary 填补）。纯函数。
export function mergeMids(primary, secondary) {
  const out = new Map(secondary || []);
  for (const [k, v] of (primary || [])) out.set(k, v);
  return out;
}
