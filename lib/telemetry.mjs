// lib/telemetry.mjs —— 横切层·遥测（可托管）。
// record: browser-ws 旁路被动录制（跨所有标签记 Network req/resp + nav → JSONL，不 reload/不点击，与操作并存）。
// computeStats/statsFromFile: 读 JSONL → 分时段(hour-of-day) 请求数/各端点/错误率/req→resp 时长。
// 吸收 I:\cdp-helper\probe-recorder.mjs。
// 注：富指标 upload_duration/audit_latency/pass_rate 需"上传时记 materialId"的跨会话关联(point7，计划②补)；本模块先出基础分时段统计。
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { connectBrowser } from './cdp.mjs';
import { update, chooseArm, posteriorMean } from './bandit.mjs';

// 只记 API/文档类，跳过静态资源
const interesting = (url, type) =>
  (/uni-promotion|\/api\/|\/ad\/|oceanengine|qianchuan|jinritemai/.test(url) && !/\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|css|ico)(\?|$)/i.test(url))
  && (type === 'XHR' || type === 'Fetch' || type === 'Document' || type === 'Other' || !type);

export async function record(port, { seconds = 1800, outFile, log, signal } = {}) {
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
  // ★#6 常驻：到 seconds 或被 abort(守护停机) 即收尾——让 telemetry 能随飞轮 daemon 长跑到优雅停。
  await new Promise(r => { const t = setTimeout(r, seconds * 1000); if (signal) signal.addEventListener('abort', () => { clearTimeout(t); r(); }, { once: true }); });
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

// ════════════════ pass-rate 基建（submissions.jsonl：submit-time materialId → audit 结果）════════════════
// 旁车在台账旁（H:\，非 git 仓库内）。事件：{k:'s',ts,ch,mid,name}（提交）/ {k:'r',ts,mid,res,sts}（结审 res=1过/2拒，sts=submit ts）。
// 消费：分时段过审率 + audit latency（驱动 S5 bandit 择时）。submit 由 upload 记，resolve 由 sync 顺带（复用其已拉 platform，零额外平台调用）。
export const submissionsPath = (ledgerPath) => ledgerPath + '.submissions.jsonl';
const readJsonl = (p) => existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean) : [];

// 记本轮提交（point7：上传时记 materialId）。items=[{mid,name}]。
export function recordSubmissions(ledgerPath, channel, items, ts) {
  const p = submissionsPath(ledgerPath); let n = 0;
  for (const it of items || []) { if (!it.mid) continue; appendFileSync(p, JSON.stringify({ k: 's', ts: ts || 0, ch: channel, mid: String(it.mid), name: it.name }) + '\n', 'utf8'); n++; }
  return n;
}

// 用 sync 已拉的 platform 数组解析待结提交（终态 1/2）→ 追加 resolve 事件。返回新结审数。
export function resolveFromPlatform(ledgerPath, platform, ts) {
  const p = submissionsPath(ledgerPath);
  const events = readJsonl(p); if (!events.length) return 0;
  const submitted = new Map(), resolved = new Set();
  for (const e of events) { if (e.k === 's') submitted.set(e.mid, e); else if (e.k === 'r') resolved.add(e.mid); }
  const auditByMid = new Map();
  for (const row of platform || []) if (row.id != null) auditByMid.set(String(row.id), row.audit);
  let n = 0;
  for (const [mid, sub] of submitted) {
    if (resolved.has(mid)) continue;
    const audit = auditByMid.get(mid);
    if (audit === 1 || audit === 2) { appendFileSync(p, JSON.stringify({ k: 'r', ts: ts || 0, mid, res: audit, sts: sub.ts }) + '\n', 'utf8'); n++; }
  }
  return n;
}

// 分时段过审率 + audit latency（hour-of-day = 提交时刻）。
export function passRateStats(ledgerPath) {
  const events = readJsonl(submissionsPath(ledgerPath));
  const submits = new Map(), resolves = new Map();
  for (const e of events) { if (e.k === 's') submits.set(e.mid, e); else if (e.k === 'r') resolves.set(e.mid, e); }
  const byHour = {};
  const hb = h => byHour[h] || (byHour[h] = { submitted: 0, passed: 0, rejected: 0, pending: 0, latSum: 0, latN: 0 });
  let passed = 0, rejected = 0;
  for (const [mid, s] of submits) {
    const b = hb(new Date(s.ts).getHours()); b.submitted++;
    const r = resolves.get(mid);
    if (!r) { b.pending++; continue; }
    if (r.res === 1) { b.passed++; passed++; } else { b.rejected++; rejected++; }
    if (r.ts && s.ts) { b.latSum += (r.ts - s.ts); b.latN++; }
  }
  for (const h of Object.keys(byHour)) { const b = byHour[h]; const tot = b.passed + b.rejected; b.passRate = tot ? +(b.passed / tot).toFixed(3) : null; b.avgLatencyMin = b.latN ? Math.round(b.latSum / b.latN / 60000) : null; delete b.latSum; delete b.latN; }
  const totRes = passed + rejected;
  return { submissions: submits.size, resolved: totRes, passRate: totRes ? +(passed / totRes).toFixed(3) : null, byHour };
}

// 用已结提交喂 S5 bandit：arm=提交 hour-of-day，success=过审。返回 {arms, best(Thompson采样建议时段), posterior(确定性均值)}。
export function passRateArms(ledgerPath) {
  const events = readJsonl(submissionsPath(ledgerPath));
  const submits = new Map(); for (const e of events) if (e.k === 's') submits.set(e.mid, e);
  const arms = {};
  for (const e of events) { if (e.k !== 'r') continue; const s = submits.get(e.mid); if (!s) continue; update(arms, String(new Date(s.ts).getHours()), e.res === 1); }
  return { arms, best: chooseArm(arms), posterior: posteriorMean(arms) };
}
