// lib/selectors.mjs —— 平台绑定单一真源（CDP 控制端点 + 平台导航 URL/判据）。
// 设计意图：平台一改（域名/端点/将来 DOM 选择器/中文文案）只改这一文件，不再 grep 散落各处。
// 范围说明：现含 ① CDP 控制端点（M7/M8）② 平台导航 URL + URL 判据正则（P1）。
//   DOM 选择器(P2)/中文按钮文案(P3) 高风险、价值虚（止痛不治本），留待平台真改版触发时作为本模块新 section 落。

// ── ① CDP 控制端点（本机调试 Chrome 控制面，非业务平台）─────────────
export const CDP_HOST = '127.0.0.1'; // 本机调试固有（M8）
export const CDP_PORT = 9222;        // 默认端口兜底（M7；真实端口来自 channels/*.json 的 target.port）
export const cdpList    = (port = CDP_PORT, host = CDP_HOST) => `http://${host}:${port}/json/list`;
export const cdpVersion = (port = CDP_PORT, host = CDP_HOST) => `http://${host}:${port}/json/version`;

// ── ② 平台导航 URL（千川/巨量 业务页面；插值 aavid/planId/advId）──────
// 注：批 B 落地（P1）。builder 输出须与原硬编码字面量逐字符相同（行为字节等价）。
export const URLS = {
  login:     'https://business.oceanengine.com/login',
  agentHome: 'https://agent.oceanengine.com',
  ssoRedirect:   (advId) => `https://agent.oceanengine.com/agent/redirect/ad?advId=${advId}`,
  uniProm:       (aavid) => `https://qianchuan.jinritemai.com/uni-prom?aavid=${aavid}`,
  uniPromDetail: (aavid, planId) => `https://qianchuan.jinritemai.com/uni-prom/detail?aavid=${aavid}&adId=${planId}`,
};

// ── ② 平台 URL 判据正则（Node 侧 .test() 用；平台改版同处一起改）──
export const URL_RE = {
  sessionCold:  /\/login|from_qc_login=1|passport/,            // probeSessionWarm / assertIdentity：被弹回登录=会话冷
  loginExact:   /business\.oceanengine\.com\/login/,           // login()：是否已在登录页
  uniPromPath:  /uni-prom/,                                    // ready 收敛：是否在 uni-prom 页
  detailPage:   /uni-prom\/detail/,                            // lockPlan：是否在 detail 页
  telemetryBiz: /uni-promotion|\/api\/|\/ad\/|oceanengine|qianchuan|jinritemai/, // 遥测"业务请求"判据
  // ★jie6 mid 捕获（批次3）：提交期绑定视频请求。2026-07-02 真号 jie6 确认：
  //   req {vids:[{file_name,video_id}]} + resp {data:{vidToMidMap:{VID:MID}}}（一个请求即含 name↔vid↔mid）。
  bindVideo: /bind-video-to-owner/,
};

// bind 请求 URL 正则：优先 system.json.selectors.bindVideoRe 覆盖（真号上调正则=改配置不改代码），否则回退 URL_RE.bindVideo。
export function bindUrlRe(system) {
  const custom = system && system.selectors && system.selectors.bindVideoRe;
  if (custom) { try { return new RegExp(custom); } catch (e) {} }
  return URL_RE.bindVideo;
}
// 注：probeLoginStatus 的 looksLogin 判据是页内注入(cdp.j)字符串、跑在浏览器侧，引用不到本 Node 常量，按设计留原处。
