# HANDOFF — Weilai-01 交接文档

> 截至 **2026-06-23 ~18:50**，最新提交 **`b0c95d7`**。**工作区干净、所有代码已提交，没有半改残留。**
> 下个 agent：先读这份，再读 `docs/PLAN.md`（设计底稿）。

---

## ⚠️ 接手前必读（最重要）

1. **磁盘满 → 冷启动会"假崩"，这不是代码 bug。**
   - 实测：**C: 仅 0.2 GB(0.3%)、H: ~0 GB、D: 0.1 GB**（I: 26 GB 尚可）。
   - 后果：Chrome renderer 进程写不了 cache/temp → 冷启动 `ready`（全新 Chrome→握手→新建捷沅3标签→收敛）时，**新建标签的 renderer 不响应 CDP**（`Page.enable`/`Runtime.evaluate` 超时）。看起来像 ready 坏了，**其实是 C 盘满**。
   - **必做**：先清 **C: 和 H:**（各腾几 G），再测冷启动，大概率自愈。
2. **台账在满盘 H: 上**：`H:\DD\6-18-魏-指纹\_video_state.json`。`saveState` 已用**原子写(临时文件→rename)+ `.bak` 备份**，最坏是「新状态存不进」而非「毁掉旧台账」，但 **H: 满会让任何记账(bump/observe 落盘)报错**。清 H: 后才能跑写台账的流程。
3. **热路径是好的**：当 Chrome 已开、捷沅3(1849)标签已加载好时，`weilai ready jie3` 空转/收敛都正确（已实测）。问题**只**在冷启动新建标签 + 磁盘满。
4. **不要在没清盘前怀疑 ready 的代码**——它已被混沌测试验证、并修过 3 轮 bug。
5. **★铁律：绝不用 `Stop-Process chrome` / `taskkill /IM chrome.exe` 重置浏览器。** 它会杀光用户的**正常 Chrome**（不止调试实例），且 `-Force` 强杀触发 Chrome **Crashpad 崩溃转储**狂写 C 盘——这正是本次 C 盘被填满 + renderer 挂死的**人为推手**。要重置调试实例只用 **`weilai close <target>`**（CDP `Browser.close`，只关该 port、保登录态、零崩溃转储）或直接重起。CLI/测试代码本身**不含任何杀进程逻辑**，这条只针对人/agent 的临时命令。

---

## 一句话现状

**计划①「自治基建」代码已全部建完（~95%，仅剩 live 验证）**：横切层(ready/guard/monitor+telemetry) + 框架(cdp/state/config/log/concurrency) + 非上传业务(sync/delete/md5fix) + 上传接口桩 + 全部命令(ready/status/sync/delete/md5fix/prep/cycle/monitor/stats/close) + cycle 骨架(--skip-upload) + 两份子计划文档(`PLAN-1-基建.md`/`PLAN-2-上传.md`) 均已建、已提交。**仅剩：① 清盘后 live 验证 ready/sync/delete(任务#9/#12) ② 计划②(上传核心)。**

**★ live 验证状态（重要）**：`status` ✓ / `md5fix` ✓(实测改过 3 个真视频·400MB/个·并行) / `weilai close` ✓ / 热路径 `ready` ✓。**未 live 验证：`sync`、`delete`、冷启动 `ready`**（C 盘满一直阻塞浏览器测试）。清盘后**先只读跑 `sync jie3` + `delete jie3 --dry-run` 核对清单，再 `--apply`**。sync/delete 是 flat-sync/run-delete 的忠实移植，但**没在真平台跑过，可能有签名捕获/选择器的小偏差**。

整体架构＝**两份计划，先①后②**（见 `docs/PLAN.md`）：① 自治基建+非上传业务（本阶段）；② 上传核心（upload/submit/bump/hold-submit，只填①预留的 `E_NOT_IMPL` 接口桩，不改①）。

---

## 已建并提交（计划①，b0c95d7）

| 文件 | 内容 | 状态 |
|---|---|---|
| `lib/cdp.mjs` | 继承 lib-cdp + port/aavid 可配（双实例）+ 页内去重助手(isVisible/synthClick/setInput/dismissModal/nextPage) + 捕签名/重放。**★P1: WS-open 超时 + send 超时 + 断开拒绝在途请求** | ✅ |
| `lib/state.mjs` | 继承 lib-state 全套(observe/recompute/bumpUpload/worklists/单调钉死) + **原子写+备份** + summarize + syncChannels(config桥) | ✅ |
| `lib/config.mjs` | system.json + targets/*.json 载入校验 + loadChannels + loadSecrets(凭据不入库) | ✅ |
| `lib/log.mjs` / `concurrency.mjs` | 人看 stderr / 机器 JSON stdout；p-limit 限流 | ✅ |
| `lib/session.mjs` | **7 探针 + 8 动作 + ready 收敛调度器**。**★P2: 收敛重试3次**(E_DRIFT/E_SIG/transient)、**★P5: 成功后清残留标签**、P6 已回退 | ✅(冷启动受磁盘影响) |
| `lib/guard.mjs` | 身份断言(漂移/掉登录/签名)+恢复1次+**退出码契约**(EXIT/CODE_TO_EXIT) | ✅ |
| `lib/upload.mjs` / `submit.mjs` | **接口桩，全抛 `E_NOT_IMPL`** = 计划①/②的代码缝。计划②填实现、不改① | ✅(桩) |
| `bin/weilai.mjs` | CLI 入口/分发 + argv 护栏(拒中文) + e.code→退出码 | ✅ |
| `bin/cmds/status.mjs` | 只读台账分阶段/双通道汇总(支持 --json) | ✅ 实测过 |
| `bin/cmds/ready.mjs` | 横切层 ready 命令 | ✅(同上磁盘限制) |
| `targets/{jie3,jie6}.json` + `system.json` | 通道配置 + 机器/项目配置(硬编码全外提) | ✅ |
| `test/{chaos,operator,interferer,monitor}.mjs` + `CHAOS-REPORT-2026-06-23.md` | 混沌测试 harness + 报告 | ✅ |

---

## 混沌测试结论（已跑完，详见 `test/CHAOS-REPORT-2026-06-23.md`）

- 三并发 worker（operator 不断冷启动 / interferer 不定期干扰 / monitor 监控）跑 ~60min：**43 次 ready × 95 次干扰 → 0 次误操作错账户**。**安全性铁打**（双重佐证：monitor 0 DANGER + operator 全程主动拒绝）。
- **P3 不可解**：单实例共享浏览器下、有人持续导航工作标签 → ready 收敛不了（客户端挡不住另一个客户端导航同页）。靠**双实例 + 专用 profile 隔离**兜底（设计已含）。偶发干扰则可解（已加 P2 重试）。
- 修复：P1(超时·根治无限挂死) / P2(重试) / P5(清标签)；P6 回退(误判——长等待是冷加载时间，`waitAccount` 命中即早返回)。
- **附带白捡**：P1 的超时正是把「无限挂死」变「超时抛错」、让我们定位出「磁盘满」根因的功臣。

---

## 下一步（计划①剩余，按序）

0. **先清 C: 和 H: 磁盘** → 验 `weilai ready jie3` 冷启动自愈。
1. **`lib/sync.mjs`**：合并 flat-sync + flatsync-jie6。流程：`Page.reload` 捕签名 list-required/optional → 改 `PageParams{Limit:500,Offset}` 翻页 → `LegoMidList` 批30 拉 `materialAuditStatus`/`isDel` → `norm` 文件名匹配本地 KW 件 → 代表副本择优 `observe` → `recomputeAll` → 渲 index.md/worklist。**源已读懂**：`I:\cdp-helper\flat-sync.mjs`（上传部分 uploadFiles 归计划②，sync 不碰）。
2. **`lib/delete.mjs`**：合并 run-delete + delete-jie6-replay。1 次 UI 删抓 set-opt 签名 → `fetch` 批量重放 `{optType:delete,params:{LegoMids,UseLegoMid:true}}`。**默认 dry-run**。
3. **`lib/md5fix.mjs`**：并行 ffmpeg fan-out（`-c copy -map_metadata -1 -metadata comment=<UUID> -movflags +faststart`），跳过已存在。源 `I:\cdp-helper\md5fix.mjs`。
4. **`lib/telemetry.mjs`**：browser-ws 旁挂被动记录(吸收 probe-recorder/netwatch/tabwatch) → JSONL → 分时段统计。
5. **`bin/cmds/` + cycle 骨架**：prep/sweep/monitor/cycle(`--skip-upload` 空转到上传桩)。双实例 9222/9223。
6. **测计划①五条标准**（见 PLAN §十四）→ **拆 `docs/PLAN-1-基建.md` / `PLAN-2-上传.md`**。

计划②（上传核心）后做，只填 `lib/upload.mjs`/`submit.mjs` 的桩 + bump 调用，**不改计划①任何模块**。

---

## 任务台账（TaskList）

- ✅ #1 cdp+state / #2 框架 / #3 session / #4 guard / #7 上传桩 / #11 修混沌bug。
- ⬜ #5 sync+delete+md5fix（下一个）/ #6 telemetry / #8 命令+cycle骨架 / #9 测5标准 / #10 提交+拆PLAN文档。

## 环境/约定备忘

- **git push 走代理**：仓库已配 `http.proxy=http://127.0.0.1:7897`（直连 GitHub 被中国网络重置）。`gh` 已认证(mtmfs)。
- **私库**：https://github.com/mtmfs/Weilai-01 （private）。
- **重构源**：`I:\cdp-helper\`（lib-cdp/lib-state 直接继承；flat-sync/run-delete/run-reupload-*/enter-1868/qc-setup 等重构）。
- **凭据**：母账号密码**不入库**；session.login 从 `secrets.json` 或环境变量 `QC_MOTHER_EMAIL/PWD` 读（目前没配，profile 通常已登录所以冷启动跳过 login）。
- **退出码**：见 `lib/guard.mjs` EXIT/CODE_TO_EXIT（10 E_DRIFT/11 E_LOGIN/12 E_SIG/13 E_ROI/14 E_SELECTOR/20 E_CONFIG/64 E_NOT_IMPL…）。
- **当前状态**：用户主动暂停，等清磁盘后继续。
