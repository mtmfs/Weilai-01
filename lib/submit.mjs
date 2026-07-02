// lib/submit.mjs - upload submit core.
// Flow: wait until the platform confirm button is safe to click, click bottom confirm,
// then accept any platform confirmation modals and return the submitted count.
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function snap(cdp) {
  const s = await cdp.j(`
    const a=[...document.querySelectorAll('.oc-progress-content')].filter(__vis).map(e=>(e.innerText||'').trim());
    const pcts=a.map(t=>{const m=t.match(/(\\d+)%/);return m?+m[1]:(t==='100%'?100:0);});
    const btn=[...document.querySelectorAll('button')].filter(b=>__vis(b)&&(b.innerText||'').trim()==='确定'&&b.getBoundingClientRect().y>850)[0];
    return JSON.stringify({total:a.length,inprog:pcts.filter(p=>p<100).length,done:pcts.filter(p=>p===100).length,inprogSum:pcts.filter(p=>p<100).reduce((s,x)=>s+x,0),cEn:btn?!btn.disabled:false});`);
  return JSON.parse(s);
}

async function waitSubmittable(cdp, cfg, { perFileNoProgressSec, patientMaxMin, pollSec, log } = {}) {
  const L = log || { step() {}, ok() {}, warn() {}, info() {} };
  const T = cfg.system.timeouts || {};
  const noProg = (perFileNoProgressSec || T.perFileNoProgressSec || 90) * 1000;
  const maxMs = (patientMaxMin || T.patientMaxMin || 45) * 60 * 1000;
  const poll = (pollSec || T.pollSec || 8) * 1000;

  const s0 = await snap(cdp);
  if (s0.total === 0 && !s0.cEn) {
    L.warn('submit: 上传面板无任何项（total=0）→ 立即返回 submitted=0，不等待');
    return { ready: false, snap: s0, submitted: 0, stragglers: 0, click: 'EMPTY' };
  }

  const t0 = Date.now();
  let prevInprogSum = -1, prevTotal = -1, stallMs = 0, s = s0;
  while (Date.now() - t0 < maxMs) {
    await cdp.send('Page.bringToFront');
    s = await snap(cdp);
    L.info(`  传输 done=${s.done} inprog=${s.inprog} inprogSum=${s.inprogSum} total=${s.total} 确定=${s.cEn}`);
    if (s.inprog === 0 && s.cEn) { L.ok('全部传完'); return { ready: true, snap: s }; }
    if (s.cEn) {
      const progressed = s.inprogSum !== prevInprogSum || s.total !== prevTotal;
      stallMs = progressed ? 0 : stallMs + poll;
      if (stallMs >= noProg) {
        L.warn(`龟速件 ${Math.round(noProg / 1000)}s 无进度 → 提交已完成、踢回 ${s.inprog} 个`);
        return { ready: true, snap: s };
      }
    } else {
      stallMs = 0;
    }
    prevInprogSum = s.inprogSum;
    prevTotal = s.total;
    await sleep(poll);
  }
  return { ready: true, snap: s };
}

async function clickSubmitConfirm(cdp, s, { log } = {}) {
  const L = log || { step() {}, ok() {}, warn() {}, info() {} };
  let N = s ? s.done : 0;

  await cdp.send('Page.bringToFront');
  const f = await cdp.j(`const b=[...document.querySelectorAll('button')].filter(b=>__vis(b)&&(b.innerText||'').trim()==='确定'&&b.getBoundingClientRect().y>850)[0]; return b?(__synthClick(b),'CLICKED'):'NOBTN';`);
  L.step(`底部确定: ${f}`);
  if (f !== 'CLICKED') {
    L.warn('submit: 未找到可点击的底部确定按钮，停止提交且不记账');
    return { submitted: 0, stragglers: s ? s.inprog : 0, click: f };
  }
  await sleep(2200);

  for (let k = 0; k < 5; k++) {
    const m = await cdp.j(`const modal=[...document.querySelectorAll('.ovui-modal__wrap,.oc-modal-wrap,.ovui-modal,[role=dialog]')].filter(__vis).pop(); if(!modal)return null;
      const txt=(modal.innerText||'').replace(/\\s+/g,' ').slice(0,90);
      const b=[...modal.querySelectorAll('button')].filter(x=>__vis(x)&&/^(确定|继续|确认|确认添加|是|仍然添加|继续添加)$/.test((x.innerText||'').trim()))[0];
      if(!b)return JSON.stringify({txt,btn:'NOAFFIRM'}); __synthClick(b); return JSON.stringify({txt,btn:(b.innerText||'').trim()});`);
    if (!m) break;
    try {
      const mn = (JSON.parse(m).txt || '').match(/(\d+)\s*个素材/);
      if (mn) N = +mn[1];
    } catch (e) {}
    L.info(`确认弹窗${k + 1}: ${m}`);
    await sleep(1800);
  }

  await sleep(2000);
  const post = await cdp.j(`return JSON.stringify({modalOpen:[...document.querySelectorAll('.ovui-modal__wrap,.oc-modal-wrap')].some(__vis),uploadBoxOpen:[...document.querySelectorAll('*')].some(e=>/将文件拖拽到此处|点击上传/.test(e.innerText||'')&&__vis(e))});`);
  L.ok(`提交完成：真提交 ${N} 个 | ${post}`);
  return { submitted: N, stragglers: s ? s.inprog : 0, click: f };
}

export async function submit(cdp, cfg, { perFileNoProgressSec, patientMaxMin, pollSec, log, onTransferDone } = {}) {
  const L = log || { step() {}, ok() {}, warn() {}, info() {} };
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const gate = await waitSubmittable(cdp, cfg, { perFileNoProgressSec, patientMaxMin, pollSec, log: L });
  if (!gate.ready) return { submitted: gate.submitted || 0, stragglers: gate.stragglers || 0, click: gate.click || 'EMPTY' };
  if (onTransferDone) { try { await onTransferDone(); } catch (e) {} } // ★传输完成后钩子：在此才开 bind collector（Network.enable），绝不贯穿大文件传输窗口（否则 CDP 事件洪流 OOM）
  return clickSubmitConfirm(cdp, gate.snap, { log: L });
}

export async function holdSubmit(cdp, cfg, { delayMin = 10, perFileNoProgressSec, patientMaxMin, pollSec, log, onTransferDone } = {}) {
  const L = log || { step() {}, ok() {}, warn() {}, info() {} };
  const mins = Number(delayMin);
  if (!Number.isFinite(mins) || mins < 0) throw Object.assign(new Error('--delay-min 必须是非负数字'), { code: 'E_USAGE' });

  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const gate = await waitSubmittable(cdp, cfg, { perFileNoProgressSec, patientMaxMin, pollSec, log: L });
  if (!gate.ready) return { submitted: gate.submitted || 0, stragglers: gate.stragglers || 0, click: gate.click || 'EMPTY', held: false };

  if (mins > 0) {
    L.ok(`上传已到可提交状态，挂起 ${mins} 分钟后再确认`);
    await sleep(mins * 60 * 1000);
  } else {
    L.ok('上传已到可提交状态，立即确认（delay=0）');
  }

  await cdp.send('Page.bringToFront');
  const after = await snap(cdp);
  if (!after.cEn) throw Object.assign(new Error('挂起后确认按钮不可用，停止提交以避免误记账'), { code: 'E_GESTURE' });
  if (onTransferDone) { try { await onTransferDone(); } catch (e) {} } // ★同 submit：确定前才开 collector，避开传输窗口
  const res = await clickSubmitConfirm(cdp, after, { log: L });
  return { ...res, held: true, delayMin: mins };
}
