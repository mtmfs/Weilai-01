// lib/bindmid.mjs —— jie6 上传 mid 捕获：从提交期 bind-video-to-owner（及 material/create）请求解析
//   file_name ↔ video_id ↔ materialId 的可靠映射，替代"reload 取 max-mid"对提交瞬间名字解析的依赖。
//
// ★真号待填（见 plan §3.4）：字段路径 BIND_FIELDS 与 URL 正则 selectors.URL_RE.bindVideo 必须在 ~49 万有钱号抓包确认。
//   控制流（getPath/extractPairs/parseBindMids/mergeMids）纯函数、不随字段变 → 可离线单测；真号只改这两处数据。
//
// 根因（为何需要）：平台提交瞬间按 materialId 给素材命名、几小时后才解析回文件名；jie6 更因 injectNameFilter 用 kw
//   过滤把"ID 名"的新素材过滤掉 → reload 取 max-mid 抓不到（27 件仅 2 有 mid）。bind 请求在提交期携带真实 file_name，名字无关。

// 字段路径（'' 表 body 根即数组；mid=null 表该请求不含 mid、走 vid→mid join）。★TODO real-account 确认。
export const BIND_FIELDS = {
  bind:   { list: 'materials', name: 'file_name', vid: 'video_id', mid: null },
  create: { list: 'materials', vid: 'video_id',   mid: 'material_id' },
};

// 点分键取值：''/null 返 obj 自身；中途缺返 undefined。纯函数。
export function getPath(obj, path) {
  if (path == null || path === '') return obj;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

// 从一条请求的 reqBody/respBody（string 或已解析对象）按 fields 抽 [{name,vid,mid}]。坏 body 安全跳过。纯函数。
export function extractPairs(reqBody, respBody, fields = BIND_FIELDS.bind) {
  const out = [];
  for (const raw of [reqBody, respBody]) {
    if (raw == null) continue;
    let body = raw;
    if (typeof raw === 'string') { try { body = JSON.parse(raw); } catch (e) { continue; } }
    const list = getPath(body, fields.list);
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item == null || typeof item !== 'object') continue;
      const name = fields.name != null ? getPath(item, fields.name) : undefined;
      const vid = fields.vid != null ? getPath(item, fields.vid) : undefined;
      const mid = fields.mid != null ? getPath(item, fields.mid) : undefined;
      if (name == null && vid == null && mid == null) continue;
      out.push({ name: name == null ? null : String(name), vid: vid == null ? null : String(vid), mid: mid == null ? null : String(mid) });
    }
  }
  return out;
}

// 从收集到的请求事件解析 name→mid 映射。events=[{url,reqBody,respBody,...}]（openRequestCollector 产出）。
// 两跳 join：bind 给 name↔vid(↔mid?)；mid 缺时用 create/list 的 vid↔mid 补。norm 归一文件名为台账键；kw 过滤。纯函数。
export function parseBindMids(events, { norm = (s) => String(s), kw = '', fields = BIND_FIELDS } = {}) {
  const nameToVid = new Map(), nameToMid = new Map(), vidToMid = new Map();
  let sawBind = false;
  for (const ev of events || []) {
    for (const p of extractPairs(ev && ev.reqBody, ev && ev.respBody, fields.bind)) {
      if (p.name == null) continue;
      if (kw && !p.name.includes(kw)) continue;
      sawBind = true;
      const k = norm(p.name);
      if (p.vid != null) nameToVid.set(k, p.vid);
      if (p.mid != null) nameToMid.set(k, p.mid);
    }
    if (fields.create) {
      for (const p of extractPairs(ev && ev.reqBody, ev && ev.respBody, fields.create)) {
        if (p.vid != null && p.mid != null) vidToMid.set(p.vid, p.mid);
      }
    }
  }
  const midByName = new Map();
  for (const [k, mid] of nameToMid) midByName.set(k, mid);            // bind 直接给的 mid 优先
  for (const [k, vid] of nameToVid) if (!midByName.has(k) && vidToMid.has(vid)) midByName.set(k, vidToMid.get(vid)); // 两跳 join 补
  return { midByName, vidByName: nameToVid, sawBind };
}

// 合并两个 name→mid Map：primary 覆盖 secondary（primary 胜、secondary 填补）。纯函数。
export function mergeMids(primary, secondary) {
  const out = new Map(secondary || []);
  for (const [k, v] of (primary || [])) out.set(k, v);
  return out;
}
