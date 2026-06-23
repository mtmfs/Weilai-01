// lib/telemetry.mjs —— 横切层·遥测（可托管）。
// record: browser-ws 旁路被动录制（跨所有标签记 Network req/resp + nav → JSONL，不 reload/不点击，与操作并存）。
// computeStats/statsFromFile: 读 JSONL → 分时段(hour-of-day) 请求数/各端点/错误率/req→resp 时长。
// 吸收 I:\cdp-helper\probe-recorder.mjs。
// 注：富指标 upload_duration/audit_latency/pass_rate 需"上传时记 materialId"的跨会话关联(point7，计划②补)；本模块先出基础分时段统计。
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { connectBrowser } from './cdp.mjs';

// 只记 API/文档类，跳过静态资源
const interesting = (url, type) =>
  (/uni-promotion|\/api\/|\/ad\/|oceanengine|qianchuan|jinritemai/.test(url) && !/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|css|ico)(\?|$)/i.test(url))
  && (type === 'XHR' || type === 'Fetch' || type === 'Document' || type === 'Other' || !type);

export async function record(port, { seconds = 1800, outFile, log } = {}) {
  const L = log || { ok() {}, info() {} };
  mkdirSync(dirname(outFile), { recursive: true });
  const write = o => appendFileSync(outFile, JSON.stringify(o) + '\n', 'utf8');
  const b = await connectBrowser(port);
  const sessions = new Map();
  b.onEvent(async m => {
    const sid = m.sessionId;
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = m.params; sessions.set(sessionId, targetInfo);
      if (targetInfo.type === 'page') { write({ ts: Date.now(), kind: 'attach', sid: sessionId, url: targetInfo.url }); try { await b.send('Network.enable', {}, sessionId); await b.send('Page.enable', {}, sessionId); } catch (e) {} }
      return;
    }
    if (m.method === 'Target.detachedFromTarget') { sessions.delete(m.params.sessionId); return; }
    if (m.method === 'Network.requestWillBeSent') { const r = m.params.request, type = m.params.type; if (!interesting(r.url, type)) return; write({ ts: Date.now(), kind: 'req', sid, tab: (sessions.get(sid) || {}).url || '', type, method: r.method, url: r.url }); return; }
    if (m.method === 'Network.responseReceived') { const resp = m.params.response, type = m.params.type; if (!interesting(resp.url, type)) return; write({ ts: Date.now(), kind: 'resp', sid, status: resp.status, url: resp.url }); return; }
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) { write({ ts: Date.now(), kind: 'nav', sid, url: m.params.frame.url }); const s = sessions.get(sid); if (s) s.url = m.params.frame.url; return; }
  });
  await b.send('Target.setDiscoverTargets', { discover: true });
  const tg = await b.send('Target.getTargets');
  for (const t of ((tg.result || {}).targetInfos || [])) if (t.type === 'page') { try { await b.send('Target.attachToTarget', { targetId: t.targetId, flatten: true }); } catch (e) {} }
  await b.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  write({ ts: Date.now(), kind: 'mark', note: 'start' });
  L.ok(`旁路录制 → ${outFile}（${seconds}s，跨所有标签被动观察，不干扰操作）`);
  await new Promise(r => setTimeout(r, seconds * 1000));
  write({ ts: Date.now(), kind: 'mark', note: 'end' });
  b.close();
  return { outFile, seconds };
}

const endpointOf = url => {
  if (/material\/list/.test(url)) return 'list';
  if (/material\/set-opt/.test(url)) return 'delete';
  if (/upload|\/material\/create|file|vod/.test(url)) return 'upload';
  if (/audit|review|materialInfo/.test(url)) return 'audit';
  return 'other';
};

export function computeStats(events) {
  const byHour = {};
  const hb = h => byHour[h] || (byHour[h] = { reqs: 0, errs: 0, byEp: {} });
  const lastReq = new Map(); const durs = {};
  for (const e of events) {
    if (e.kind === 'req') {
      const b = hb(new Date(e.ts).getHours()); const ep = endpointOf(e.url || '');
      b.reqs++; b.byEp[ep] = (b.byEp[ep] || 0) + 1; lastReq.set(e.url, e.ts);
    } else if (e.kind === 'resp') {
      if ((e.status || 0) >= 400) hb(new Date(e.ts).getHours()).errs++;
      const t0 = lastReq.get(e.url);
      if (t0 != null) { const ep = endpointOf(e.url || ''); const d = durs[ep] || (durs[ep] = { n: 0, sum: 0 }); d.n++; d.sum += (e.ts - t0); lastReq.delete(e.url); }
    }
  }
  const endpointAvgMs = Object.fromEntries(Object.entries(durs).map(([ep, d]) => [ep, Math.round(d.sum / d.n)]));
  return { hours: byHour, endpointAvgMs };
}

export function statsFromFile(jsonlPath) {
  if (!existsSync(jsonlPath)) throw Object.assign(new Error('无录制文件: ' + jsonlPath), { code: 'E_CONFIG' });
  const events = readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  return { events: events.length, ...computeStats(events) };
}
