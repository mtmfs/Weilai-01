// lib/ledger.mjs —— 串行化台账提交器（actor）。根治双 worker 并发写台账的"陈旧快照丢失更新"。
//
// 真因（已逐行核实）：四个写者 upload/sync/delete/reconcile 的"突变段"（loadState→…→saveState）
//   本就是同步无 await 的；lost-update 不是临界区被打断，而是写者在动作开始时（最长 45min 前）
//   就 loadState 了一份陈旧快照，等慢活（CDP/平台）跑完才 saveState，把这期间别人写的连同陈旧快照拍回磁盘。
//
// 解法：① 慢活全部留在锁外并发跑；② 只把"结果 delta"经本提交器做
//   「提交时刻新鲜 loadState → 应用本通道 delta → recomputeAll → 原子写」，临界区全同步无 await
//   （JS run-to-completion 天然原子）；actor 尾链 promise 串行化所有 read/commit。
//
// 不变量（调用方务必遵守）：deltaFn 必须是同步函数、只改 v.ch[channel] 自己的字段、
//   绝不调 recomputeStage、绝不碰 state.channels/pipeline —— stage 与 channels 由提交器统一负责。
//
// 单发 CLI 透明回退：叶子 `opts.ledger || createLedger(ledgerPath)` 即可；transient ledger 的尾链从已 resolve 开始，
//   read/commit 顺序立即执行，行为与旧版等价、且更正确（提交时才 load，连带修掉 upload.mjs 复用陈旧 state 的潜伏 bug）。
import { loadState, saveState, syncChannels, recomputeAll, worklists } from './state.mjs';
import { loadChannels } from './config.mjs';
import { withFileLock } from './lockfile.mjs';

export function createLedger(ledgerPath, { onCommit } = {}) {
  const lockPath = ledgerPath + '.lock'; // 跨进程互斥锁（与 .tmp/.bak 同目录同卷、不冲突）
  let tail = Promise.resolve(); // actor 邮箱：尾链串行化所有 read/commit（进程内）
  let frozen = null;            // 台账损坏后冻结（fail-safe：宁可停写，绝不用坏/空数据覆盖好台账）

  // 同步配方（全程无 await）：新鲜读 → channels 唯一真源覆盖 → 应用 delta → 重算 stage → 原子写。
  function applySync(label, deltaFn) {
    const state = loadState(ledgerPath);            // ★提交时刻新鲜读，消灭陈旧快照
    const chs = loadChannels();
    syncChannels(state, chs.channels, chs.pipeline);
    if (deltaFn) deltaFn(state);                    // 只动 ch[channel]，纯同步
    recomputeAll(state);                            // 读两通道算 stage（单一真相）
    saveState(ledgerPath, state);                   // tmp→.bak→rename 原子
    if (onCommit) { try { onCommit(label, state); } catch (e) {} }
    return worklists(state);                         // 回派生工作清单给调用方决策
  }

  // 把 job 排进 actor 尾链；返回 job 的真实结果 promise，但尾链吞掉失败（一笔失败不阻塞后续）。
  function enqueue(job) {
    const p = tail.then(job, job); // 不论前一笔成败都继续排队
    tail = p.catch(() => {});      // 尾链不被单笔失败污染
    return p;
  }

  return {
    // 串行提交本通道 delta；解析为最新 worklists（决策用）。
    commit(label, deltaFn) {
      return enqueue(async () => {
        if (frozen) throw frozen;
        // ★跨进程互斥：把整段同步临界区（fresh load→delta→recompute→原子写）套文件锁，根治两进程 lost-update。
        // 临界区仍全同步（run-to-completion 原子）；acquire→fn 之间无 await 交错。
        return await withFileLock(lockPath, () => {
          try { return applySync(label, deltaFn); }
          catch (e) { if (e && e.code === 'E_CONFIG') frozen = e; throw e; } // 仅 E_CONFIG 冻结；E_LOCK(锁超时)不冻结、仅本笔失败
        }, { label });
      });
    },
    // 串行读一致快照（rounds 去重 / computeTargets / 派生 worklist）。fn 应短、纯计算、不写。
    read(fn) {
      return enqueue(() => fn(loadState(ledgerPath)));
    },
    isFrozen() { return !!frozen; },
  };
}
