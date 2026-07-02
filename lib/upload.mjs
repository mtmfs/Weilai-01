// lib/upload.mjs —— 上传核心·注入 + 编排（计划②/Phase3 实现）。移植 I:\cdp-helper\run-reupload-multi.mjs。
// 核心坑：上传 <input> 是点击时临时创建的瞬态节点 → backendNodeId 极不稳。
// 解法：Page.setInterceptFileChooserDialog + DOM.getDocument 各开一次；每批 clickAt(受信任手势)拖拽框
//       → 80ms×25 轮询 Page.fileChooserOpened(寿命短) → DOM.setFileInputFiles(backendNodeId)。批≤maxPerBatch(9)。
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { connect, norm, hardenViewport, openRequestCollector } from './cdp.mjs';
import { bindUrlRe } from './selectors.mjs';
import { parseBindMids, mergeMids } from './bindmid.mjs';
import { guardEnter } from './guard.mjs';
import { submit, holdSubmit } from './submit.mjs';
import { captureListSigs, pullRows, injectNameFilter } from './sync.mjs';
import { recordSubmissions } from './telemetry.mjs';
import { ensureVideo, bumpUpload } from './state.mjs';
import { createLedger } from './ledger.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function synthClickText(cdp, t) {
  return cdp.j(`const T=${JSON.stringify(t)};
    const el=[...document.querySelectorAll('span,div,button,a,[role=tab]')].filter(e=>__vis(e)&&(e.innerText||'').trim()===T).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
    if(!el)return false; el.scrollIntoView({block:'center'}); return __synthClick(el);`);
}
// ★根因修复（jie6 NO_CHOOSER·三层实测确诊）：① clickAt 点了屏外坐标 ② box 的 getBoundingClientRect 给屏外值
//   ③ 真根因＝页面在后台时抽屉布局未落定，box 卡在屏外右侧（实测 cx=2454 > innerWidth=1904；一 bringToFront 即跳回 1354 屏内）。
//   修法三重：每轮先 Page.bringToFront 前台化(让抽屉布局落定) → 连续两次坐标稳定(±2px) 且 box 中心在视口内才返回 →
//   屏外/未稳则等重测，绝不返回屏外坐标(否则 null→上层重试)。配套 system.json --window-size=1920,1080 钉死宽窗口。
//   注：旧诊断赖的"组件冷加载/C: 紧"是误判，C: 仅间接(慢渲染拉长未落定窗口)。
async function findBox(cdp, { tries = 12, settleMs = 400 } = {}) {
  // ★关键：模拟聚焦。实测——仅 Page.bringToFront 不够，box 仍卡屏外 2454；加 setFocusEmulationEnabled(让后台页也按聚焦渲染)
  //   后抽屉布局立刻落定、box 回 1354 屏内。这是 NO_CHOOSER 的真正解药（submit 里也用它保活）。
  try { await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) {}
  let prev = null;
  for (let i = 0; i < tries; i++) {
    try { await cdp.send('Page.bringToFront'); } catch (e) {}
    const raw = await cdp.j(`
      let z=document.querySelector('.oc-create-upload-select-wrapper')||document.querySelector('.oc-create-material-upload-video-select')||[...document.querySelectorAll('div,span,a')].filter(x=>__vis(x)&&/点击上传/.test(x.innerText||'')).sort((a,b)=>a.querySelectorAll('*').length-b.querySelectorAll('*').length)[0];
      if(!z)return null; z.scrollIntoView({block:'center',inline:'center'}); const r=z.getBoundingClientRect();
      const cx=Math.round(r.x+r.width/2), cy=Math.round(r.y+r.height/2);
      return JSON.stringify({x:cx,y:cy,inView:(r.left>=0&&cx<=innerWidth&&r.top>=0&&cy<=innerHeight&&r.width>0)});`);
    if (!raw) { prev = null; await sleep(settleMs); continue; }
    const cur = JSON.parse(raw);
    if (prev && cur.inView && Math.abs(cur.x - prev.x) <= 2 && Math.abs(cur.y - prev.y) <= 2) return { x: cur.x, y: cur.y }; // 稳定且在视口内
    prev = cur; await sleep(settleMs);
  }
  return prev && prev.inView ? { x: prev.x, y: prev.y } : null; // 兜底：仅返回视口内坐标；屏外宁可 null 让上层重试
}

// openUploadPanel：就绪视图（添加视频可见，由 ready 保证）→ 点「添加视频」→「上传视频」tab → 拦截+getDocument 各一次。
export async function openUploadPanel(cdp, cfg, { log } = {}) {
  const L = log || { step() {}, ok() {}, warn() {} };
  if (!await cdp.j(`return __byText(/^添加视频$/).length>0;`)) return { ready: false, reason: 'NO_ADD_VIDEO（先 ready）' };
  await synthClickText(cdp, '添加视频'); await sleep(2500);
  await synthClickText(cdp, '上传视频'); await sleep(2500);
  await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true }); // 只开一次
  await cdp.send('DOM.getDocument', { depth: -1, pierce: true });          // 初始化 DOM 跟踪一次
  const box = await findBox(cdp);
  if (box) L.ok('上传面板就绪（点击上传框可见）');
  return { ready: !!box };
}

// inject：files(绝对路径数组) 按 maxPerBatch 分批注入。返回 {injected:[...路径], batches}。★不提交。
export async function inject(cdp, cfg, files, { maxPerBatch, log } = {}) {
  const L = log || { step() {}, ok() {}, warn() {} };
  const per = maxPerBatch || (cfg.system.batch && cfg.system.batch.maxPerBatch) || 10;
  const batches = [];
  for (let i = 0; i < files.length; i += per) batches.push(files.slice(i, i + per));
  const events = [];
  const off = cdp.onEvent(m => { if (m.method === 'Page.fileChooserOpened') events.push(m); });
  const injected = [];
  try {
    for (let bi = 0; bi < batches.length; bi++) {
      L.step(`注入 batch${bi + 1}/${batches.length}（${batches[bi].length} 个）`);
      if (await injectBatch(cdp, batches[bi], bi + 1, events, L)) injected.push(...batches[bi]);
      else { L.warn(`batch${bi + 1} 6 次重试均失败，停止`); break; }
      await sleep(3500);
    }
  } finally { off(); }
  return { injected, batches: batches.length };
}

async function injectBatch(cdp, files, idx, events, L) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const box = await findBox(cdp);
    if (!box) { L.warn(`  b${idx} try${attempt}: NO_BOX`); await sleep(1800); continue; }
    await sleep(250);
    const evLen = events.length;
    await cdp.clickAt(box.x, box.y); // 受信任手势
    let fc = null;
    for (let w = 0; w < 25; w++) { fc = events.slice(evLen).pop(); if (fc) break; await sleep(80); } // 瞬态：早发现早灌
    if (!fc) { L.warn(`  b${idx} try${attempt}: NO_CHOOSER`); await sleep(1500); continue; }
    try {
      await cdp.send('DOM.setFileInputFiles', { backendNodeId: fc.params.backendNodeId, files });
    } catch (e) {
      try { await cdp.send('DOM.getDocument', { depth: -1, pierce: true }); await cdp.send('DOM.setFileInputFiles', { backendNodeId: fc.params.backendNodeId, files }); }
      catch (e2) { L.warn(`  b${idx} try${attempt}: SET_ERR ${String(e2.message || e2).slice(0, 40)}`); await sleep(1200); continue; }
    }
    await sleep(2600);
    const modal = await cdp.j(`const m=[...document.querySelectorAll('.ovui-modal__wrap,.oc-modal-wrap,[role=dialog]')].filter(__vis).pop(); return m?(m.innerText||'').replace(/\\s+/g,' ').slice(0,80):null;`);
    if (modal && /仅前|超过|最多|个视频/.test(modal)) {
      await cdp.j(`const m=[...document.querySelectorAll('.ovui-modal__wrap,.oc-modal-wrap,.ovui-modal,[role=dialog]')].filter(__vis).pop(); if(m){const b=[...m.querySelectorAll('button')].filter(x=>__vis(x)&&/^(确定|继续|确认)$/.test((x.innerText||'').trim()))[0]; if(b)__synthClick(b);}`);
      await sleep(1500);
      L.step(`  b${idx} 确认"仅前N个": ${modal}`);
    }
    L.ok(`  b${idx} 注入 ${files.length} 个 ✓ (try${attempt})`);
    return true;
  }
  return false;
}

// ── 编排：openUploadPanel → inject → submit → bump（计划②的 upload 环节）──────────────
// names=台账视频名数组；取 I:\md5fix\<name>（须先 md5fix）。connect+guardEnter 防上传到错标签。
// ★bump 是唯一 uploads++ 写者：对注入件 uploads++、last_status=3；last_mid 由下次 sync 回填。
// ★轮次 token 幂等（M4 generation-keying）：token = sha1(通道 | 各文件 name@mtime)。把 mtime 纳入 →
//   md5fix 重产新哈希(rename 更新 mtime) → token 变 → 合法新哈希重传不被误判 dedup；
//   而真·误重跑(同名同文件、mtime 不变) → token 不变 → 仍正确 dedup。30min 窗退居纯防呆 backstop。
const REBUMP_WINDOW_DEFAULT_MIN = 30; // 默认窗口（分钟）；可由 system.json.timeouts.rebumpWindowMin 覆盖
const roundToken = (channel, items) => createHash('sha1').update(`${channel}|${[...items].sort().join(',')}`).digest('hex').slice(0, 16);

// ★mid 比较：长度优先再字典序 = 非负整数数值序，修旧「String>String」字典序跨位数选错（"999">"1000"）。导出供单测。
export const cmpMid = (a, b) => {
  const A = String(a), B = String(b);
  if (/^\d+$/.test(A) && /^\d+$/.test(B)) return A.length !== B.length ? A.length - B.length : (A < B ? -1 : A > B ? 1 : 0);
  return A < B ? -1 : A > B ? 1 : 0;
};
// ★point7：取每个注入名的 max-mid live 副本 = 刚提交件（snowflake mid 时间序）。导出供单测。
export function pickSubmittedMids(platform, injNorms) {
  const set = new Set(injNorms);
  const byName = new Map();
  for (const p of platform) {
    if (p.isDel === true || p.id == null) continue;
    const k = norm(p.name || ''); if (!set.has(k)) continue;
    const cur = byName.get(k);
    if (!cur || cmpMid(p.id, cur) > 0) byName.set(k, String(p.id));
  }
  return byName;
}

export async function runUpload(cfg, { names, log, mutate = true, ledger, md5dir, holdDelayMin = null } = {}) {
  const L = log || { step() {}, ok() {}, warn() {}, info() {} };
  const { system, target } = cfg;
  const channel = target.id;
  const md5Dir = md5dir || system.md5fix.outDir; // ★per-channel 子目录可由飞轮传入，根除同名跨通道撞文件
  const kw = system.project.kw; // ★字段锁：上传与 delete/md5fix 共用同一关键词闸门
  const rebumpMs = ((system.timeouts && system.timeouts.rebumpWindowMin) || REBUMP_WINDOW_DEFAULT_MIN) * 60000;

  const flatRoot = system.project.flatRoot; // ★源真源（对齐 md5fix/飞轮 hasLocal）
  const files = [];
  for (const n of names || []) {
    // ★关键词硬闸门（对齐 md5fix:35 / delete.computeTargets）：绝不上传非 kw(魏文彬) 文件。
    // 堵住"绕过台账、用错字段批量误传"——即便有人直接以任意 names 调本函数也拦下。
    if (kw && !n.includes(kw)) { L.warn(`GUARD-SKIP(非${kw}，拒上传): ${n}`); continue; }
    // ★源校验（对齐 md5fix:43 / 飞轮 hasLocal）：源已删但 I:\md5fix\ 旧副本残留时，绝不把过期产物当新件传——
    //   否则静默传错内容 + 白烧一个 maxUploads 槽 + 污染台账（06-27 实跑曾把 10 个旧件当新批传）。源不在即跳过。
    if (!existsSync(join(flatRoot, n))) { L.warn(`跳过(本地无源，疑陈旧副本): ${n}`); continue; }
    const p = join(md5Dir, n); if (existsSync(p)) files.push(p); else L.warn(`跳过(无 md5fix 文件，先 md5fix): ${n}`);
  }
  if (!files.length) { L.warn('无可上传文件'); return { injected: 0, submitted: 0 }; }

  // ★M4: token 纳入文件 mtime（md5fix 重产新哈希会更新 mtime）→ 合法新哈希重传不被 30min 窗误判 dedup。
  const targetItems = files.map(f => { let g = 0; try { g = Math.floor(statSync(f).mtimeMs); } catch (e) {} return `${f.split(/[\\/]/).pop()}@${g}`; });
  const token = roundToken(channel, targetItems);

  // 前置幂等护栏：同批文件近窗已上传 → 跳过整轮（在碰平台/创建素材之前）。
  const led = ledger || createLedger(system.project.ledgerPath);
  if (mutate) {
    const prev = await led.read((s) => (s.rounds || {})[token]);
    if (prev && Date.now() - prev.ts < rebumpMs) {
      L.warn(`疑似重跑（同批 ${Math.round((Date.now() - prev.ts) / 60000)}min 前已上传）→ 跳过整轮，防重复素材+双计 uploads。确为新一轮请待审核更新后再传。`);
      return { injected: 0, submitted: 0, dedup: true };
    }
  }

  const cdp = await connect({ port: target.port, aavid: target.aavid });
  let injected = [], N = 0, submitResult = { submitted: 0, stragglers: 0, click: 'EMPTY' }, midByName = new Map();
  let collector = null;
  try {
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable'); await cdp.send('DOM.enable'); await cdp.send('Page.bringToFront');
    await hardenViewport(cdp, system.chrome.viewport); // ★视口硬化（根治 NO_CHOOSER 环境层）：钉死虚拟视口（system.chrome.viewport，默认 1920×1080）+ 模拟聚焦，坐标恒定（详见 cdp.mjs）
    await guardEnter(cdp, cfg, { log: L }); // 身份断言：绝不上传到错标签（尤其有钱的 delivery）
    const panel = await openUploadPanel(cdp, cfg, { log: L });
    if (!panel.ready) throw Object.assign(new Error('上传面板未就绪（先跑 ready）'), { code: 'E_SELECTOR' });
    injected = (await inject(cdp, cfg, files, { log: L })).injected;
    // ★fail-loud（修上传冷启首开竞速的"静默空转"失败模式）：有文件却一个都没注入成功
    //   （多半冷启首开竞速/上传框未就绪）→ 大声抛 E_GESTURE，绝不往下 submit 对空面板傻等 45min。
    //   无人值守时这是命门：原先静默返回 0、退出码 0；现在秒级带 code 失败，编排器/cycle 可接住重试或告警。
    if (!injected.length) throw Object.assign(new Error(`注入 0/${files.length} 失败（上传框未弹文件框；疑冷启首开竞速 → 重跑 ready 预热后再传）`), { code: 'E_GESTURE' });
    // ★bind collector 移到"传输完成后"才开（onTransferDone）：Network.enable 只覆盖提交确认+bind（几秒、无大数据），
    //   绝不贯穿大文件传输窗口——10 个几百 MB 文件传输期开 Network.enable 会让 CDP 事件洪流撑爆 node 内存（曾致 OOM）。
    const onTransferDone = async () => { try { collector = await openRequestCollector(cdp, { urlRe: bindUrlRe(system) }); } catch (e) {} };
    submitResult = holdDelayMin == null
      ? await submit(cdp, cfg, { log: L, onTransferDone })
      : await holdSubmit(cdp, cfg, { delayMin: holdDelayMin, log: L, onTransferDone });
    N = submitResult.submitted || 0;
    // ★捕本轮 materialId → 喂 bump.last_mid + submissions.jsonl。主路径=提交期 bind 请求解析（名字无关、修 jie6 根因）；
    //   按 UI 分流合并 reload+max-mid：creative-tab(jie6) bind 主 + max-mid 兜底；drawer(jie3) max-mid 主 + bind 补（零回归）。
    if (injected.length && submitResult.click === 'CLICKED') {
      await new Promise(r => setTimeout(r, 3000)); // settle：让最后的 bind/create 的 loadingFinished 落地
      const injNorms = injected.map(f => norm(f.split(/[\\/]/).pop()));
      const bind = parseBindMids(collector ? collector.events : [], { norm, kw }); // 主路径（真号填 BIND_FIELDS + selectors.bindVideo 后生效）
      const isCreative = target.ui === 'creative-tab';
      let maxMidMap = new Map();
      // drawer 总取 max-mid（已验证主路径）；creative-tab 仅在 bind 未集齐时兜底（避免全量拉超时）。
      if (!isCreative || bind.midByName.size < injNorms.length) {
        try {
          const { rq, op } = await captureListSigs(cdp, { ui: target.ui });   // creative-tab 补点素材触发列表
          if (isCreative) injectNameFilter(rq, kw);                            // jie6 素材海量→只拉 kw 件
          const platform = await pullRows(cdp, rq, op);
          maxMidMap = pickSubmittedMids(platform, injNorms);
        } catch (e) { L.warn(`max-mid 兜底失败（不致命，bind/后续 sync 兜底）: ${String(e.message || e).slice(0, 50)}`); }
      }
      midByName = isCreative ? mergeMids(bind.midByName, maxMidMap) : mergeMids(maxMidMap, bind.midByName);
      L.info(`捕 mid: ${midByName.size}/${injected.length}（bind ${bind.midByName.size} / max-mid ${maxMidMap.size} · ui=${target.ui}）`);
    }
  } finally { if (collector) collector.stop(); cdp.close(); }

  if (mutate && injected.length && submitResult.click === 'CLICKED') {
    const now = Date.now();
    const injNames = injected.map(f => f.split(/[\\/]/).pop());
    await led.commit('upload:' + channel, (state) => {
      for (const n of injNames) bumpUpload(ensureVideo(state, norm(n), n), channel, { mid: midByName.get(norm(n)), ts: now });
      state.rounds = state.rounds || {};
      for (const k of Object.keys(state.rounds)) if (now - (state.rounds[k].ts || 0) >= rebumpMs) delete state.rounds[k]; // ★裁剪过期 token（防 rounds 无界增长；过 rebumpMs 后 upload 自身也不再认它，删之无害）
      state.rounds[token] = { ts: now, n: injNames.length }; // 记轮次 token（防 30min 内误重跑双计）
    });
    // ★pass-rate 基建：记本轮提交（submit-time + materialId）；audit 结果由后续 sync 顺带 resolve。
    const subItems = injNames.map(n => ({ mid: midByName.get(norm(n)), name: n })).filter(it => it.mid);
    const rec = subItems.length ? recordSubmissions(system.project.ledgerPath, channel, subItems, now) : 0;
    L.ok(`upload ${channel}: 注入 ${injNames.length} / 平台确认 ${N} / 捕 mid ${midByName.size} → bump + 记 submissions ${rec}（uploads++、last_mid 已填）`);
  }
  return { injected: injected.length, submitted: N, click: submitResult.click, stragglers: submitResult.stragglers || 0, held: holdDelayMin != null, delayMin: holdDelayMin == null ? undefined : Number(holdDelayMin) };
}
