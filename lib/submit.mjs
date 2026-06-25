// lib/submit.mjs —— 上传核心·提交（计划②/Phase3 实现）。
// 改造 I:\cdp-helper\run-reupload-patient-submit.mjs 的【整批门控】→【逐文件超时】：
//   现状：等全批 inprog===0 才点确定 → 一个龟速件逼已传完的陪等 5min（最长 45min）。
//   改后：传完(done>0)且龟速件 % 停滞 perFileNoProgressSec(90s) → 立刻提交已完成的、踢回未完成的，不陪等。
// 保活 setFocusEmulationEnabled + bringToFront；提交=点底部确定(y>850)→连点「确认添加N个」弹窗。返回真提交数 N。
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 快照：每进度条 %，done/inprog 计数，inprog 件 % 之和（判龟速件是否在动），底部确定按钮是否启用。
async function snap(cdp) {
  const s = await cdp.j(`
    const a=[...document.querySelectorAll('.oc-progress-content')].filter(__vis).map(e=>(e.innerText||'').trim());
    const pcts=a.map(t=>{const m=t.match(/(\\d+)%/);return m?+m[1]:(t==='100%'?100:0);});
    const btn=[...document.querySelectorAll('button')].filter(b=>__vis(b)&&(b.innerText||'').trim()==='确定'&&b.getBoundingClientRect().y>850)[0];
    return JSON.stringify({total:a.length,inprog:pcts.filter(p=>p<100).length,done:pcts.filter(p=>p===100).length,inprogSum:pcts.filter(p=>p<100).reduce((s,x)=>s+x,0),cEn:btn?!btn.disabled:false});`);
  return JSON.parse(s);
}

export async function submit(cdp, cfg, { perFileNoProgressSec, patientMaxMin, pollSec, log } = {}) {
  const L = log || { step() {}, ok() {}, warn() {}, info() {} };
  const T = cfg.system.timeouts || {};
  const noProg = (perFileNoProgressSec || T.perFileNoProgressSec || 90) * 1000;
  const maxMs = (patientMaxMin || T.patientMaxMin || 45) * 60 * 1000;
  const poll = (pollSec || T.pollSec || 8) * 1000;
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

  // ★防御短路（双保险）：上传面板里没有任何上传项（total==0）→ 立即返回，绝不进 maxMs(45min) 耐心等。
  //   配合 upload.runUpload 的 fail-loud；杜绝"空面板傻等 45min"的静默空转失败模式。
  const s0 = await snap(cdp);
  if (s0.total === 0) { L.warn('submit: 上传面板无任何项（total=0）→ 立即返回 submitted=0，不等待'); return { submitted: 0, stragglers: 0, click: 'EMPTY' }; }

  const t0 = Date.now();
  let prevInprogSum = -1, prevTotal = -1, stallMs = 0, s = null;
  while (Date.now() - t0 < maxMs) {
    await cdp.send('Page.bringToFront');
    s = await snap(cdp);
    L.info(`  传输 done=${s.done} inprog=${s.inprog} inprogSum=${s.inprogSum} total=${s.total} 确定=${s.cEn}`);
    if (s.inprog === 0 && s.cEn) { L.ok('全部传完'); break; } // 最佳：全完成
    // ★Bug A 修：完成件会移出列表 → s.done 永久≈0，旧判据 `s.done>0` 形同虚设、龟速件能拖满 45min(实测)。
    //   改用 s.cEn（确定可点=已有完成件可提交）当"有完成件"信号；进度=inprogSum 或 total 任一变化
    //   （total 减少=有件完成离场，也算进度）。龟速件 noProg 无进度 → 提交已完成、踢回未完成。
    if (s.cEn) {
      const progressed = s.inprogSum !== prevInprogSum || s.total !== prevTotal;
      stallMs = progressed ? 0 : stallMs + poll;
      if (stallMs >= noProg) { L.warn(`龟速件 ${Math.round(noProg / 1000)}s 无进度 → 提交已完成、踢回 ${s.inprog} 个`); break; }
    } else stallMs = 0;
    prevInprogSum = s.inprogSum; prevTotal = s.total;
    await sleep(poll);
  }
  // 真提交数 N：完成件进度条会移出列表（s.done 不可靠），改用平台确认弹窗自报的「…N 个素材…」为准；兜底 s.done。
  let N = s ? s.done : 0;

  await cdp.send('Page.bringToFront');
  const f = await cdp.j(`const b=[...document.querySelectorAll('button')].filter(b=>__vis(b)&&(b.innerText||'').trim()==='确定'&&b.getBoundingClientRect().y>850)[0]; return b?(__synthClick(b),'CLICKED'):'NOBTN';`);
  L.step(`底部确定: ${f}`); await sleep(2200);
  for (let k = 0; k < 5; k++) {
    const m = await cdp.j(`const modal=[...document.querySelectorAll('.ovui-modal__wrap,.oc-modal-wrap,.ovui-modal,[role=dialog]')].filter(__vis).pop(); if(!modal)return null;
      const txt=(modal.innerText||'').replace(/\\s+/g,' ').slice(0,90);
      const b=[...modal.querySelectorAll('button')].filter(x=>__vis(x)&&/^(确定|继续|确认|确认添加|是|仍然添加|继续添加)$/.test((x.innerText||'').trim()))[0];
      if(!b)return JSON.stringify({txt,btn:'NOAFFIRM'}); __synthClick(b); return JSON.stringify({txt,btn:(b.innerText||'').trim()});`);
    if (!m) break;
    try { const mn = (JSON.parse(m).txt || '').match(/(\d+)\s*个素材/); if (mn) N = +mn[1]; } catch (e) {} // ★平台自报真提交数
    L.info(`确认弹窗${k + 1}: ${m}`); await sleep(1800);
  }
  await sleep(2000);
  const post = await cdp.j(`return JSON.stringify({modalOpen:[...document.querySelectorAll('.ovui-modal__wrap,.oc-modal-wrap')].some(__vis),uploadBoxOpen:[...document.querySelectorAll('*')].some(e=>/将文件拖拽到此处|点击上传/.test(e.innerText||'')&&__vis(e))});`);
  L.ok(`提交完成：真提交 ${N} 个 | ${post}`);
  return { submitted: N, stragglers: s ? s.inprog : 0, click: f };
}

// holdSubmit：延迟挂起→择时秒提交。待延迟挂起 TTL 探针实测后转正；逐文件即时提交已解拖累，暂留桩。
export async function holdSubmit(/* cdp, cfg, opts */) {
  throw Object.assign(new Error('submit.holdSubmit 未实现（需先做延迟挂起 TTL 探针；逐文件即时提交已足够解拖累）'), { code: 'E_NOT_IMPL' });
}
