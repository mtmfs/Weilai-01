# 优化 Backlog —— C 系列（低层 perf）/ S 系列（深层算法·并发·业务结构）

> ⚠️ **现状权威已收编进 [`docs/工程总报告.md`](工程总报告.md) §6/§9；本文保留 A/C/S 系列细粒度台账作维护参考。** 注意：文中 NO_CHOOSER「待修」段已被其自身的 ★★ 真根因附录取代（后台布局节流→视口硬化已根治）。

> 设计细节与依赖图见 plan 底稿（会话外 `~/.claude/plans/plan-pure-hoare.md`）。本文件是 repo 内的**状态台账**，给下个维护者速查「改了什么、还剩什么、卡在哪」。
> 分支 `perf-roadmap`（基线 `333aca8`）。本文件随该分支演进。

## 一句话现状（截至 2026-06-24）

- **A 系列 10 个 bug**：✅ 全修，离线 12 单测 + live 全链验证（`85d09a1`，部分随 perf 提交）。
- **C2 / C3 / C4 提速**：✅ 完成并 live 验证（`d2aec32`），sync `19s→10.9s`。
- **S5 Thompson bandit + pass-rate 基建**：✅ 模块 + **接线**。`submissions.jsonl`（submit-time materialId→audit 结果）：upload 记提交（★point7 max-mid 捕获，同填 bump.last_mid→解锁 S1 live-audit）、sync 顺带结审（复用已拉 platform·零额外调用）、`passrate` 命令出分时段过审率/时延 + Thompson 建议提交时段（passRateArms 喂臂）。离线全管线 11/11✓。hold-submit 消费待其转正。
- **Phase 1（C1/C5/S8 ready 收敛提速）**：✅ **代码完成并 live 验证**（`4dad860`，2026-06-24 清盘后 jie3 真账户复测）。**冷启动 32.1s**（attempt1 一次过·账户✓·视图开，vs 基线≈39s）｜**热路径 0.9s**（S8 probeSnapshot 空转 skipped）｜**仅抽屉关 1.4s**（C5 `open-view-only`·不重握手）。冷启动未达 ~15s 目标——余下耗时＝Chrome 启动 8s + 冷握手/建标签/等账户 16s（基本不可压、非代码问题）；C1/C5/S8 真实收益在温/热/抽屉关路径：**操作者日常 re-ready 从 ~40s 塌到 ~1s**。同轮只读链路全过（`sync --no-mutate` live=315 / `delete --dry-run` 将删0 / 台账字节·mtime 未变 / `close` 优雅关）。
- **S1（mid 增量同步）**：✅ **完成并 live 验证**。**S1a**（`--incremental` opt-in，默认仍全量）：13 在飞件与全量逐字段一致、查 0.3s vs 全量 3.4s、台账零改动。**S1b**（签名缓存跳 reload）：探针实测 op 签名 TTL≥10min（age 0/2/5/10min 全有效）→ budget 7min；cache 命中 **6s→1s**（跳 reload），失效自动回退现抓（健康判据＝响应须含 `data.materialInfoMap` 形状，SPA/登录页/错误码都会触发回退）。⚠️ 本轮 13 件 last_mid 均 isDel→observed0（轮次间已删），"读 live 审核变更"路径＝同一 observe()，待计划②产出新 live mid 实测。
- **Phase 3 / S3（上传核心·计划②）**：🟢 **核心 live 验证 + 硬化**。`upload.mjs`(瞬态注入 + 编排 runUpload) + `submit.mjs`(逐文件超时 + N 取确认弹窗) + bump + `upload`/`test-round`/`deliver-round` 命令 + cycle 集成。真 jie3 上传 md5fix'd 文件 → **素材创建成功**（id=…946534 audit=3）；bump dry 验证（uploads 4→5·last_status=3·stage 正确）。**硬化**：①**轮次 token 幂等**（同批文件 30min 内重跑→跳过整轮，防重复素材+双计 uploads；逻辑 dry-test 5/5✓）②**openView 冷启动重试**（live 验证：冷启"视图未现→重试2/3"自愈，根治本会话两次 E_SELECTOR；openView waitFor 4s→6s）③test-round/deliver-round 接线。⚠️ 剩：hold-submit 留桩（需 TTL 探针）；Network 事件驱动完成信号=后续精化（现 DOM %-stall）；deliver-round/jie6 未 live（冷 profile 登录未通）；测试素材 测试_12 留平台待审、可后续 delete。
- **S2 及之后**：⬜ 未开始。

## ✅ 头号阻塞已解（2026-06-24）

磁盘已清至可操作（C: ~1.1G / H: ~2.7G / I: 59G）。Phase 1 冷启动 live 复测**全程无 WerFault**、ready attempt1 一次过——满盘阻塞解除。铁律不变：绝不 `taskkill chrome`（触发 Crashpad 转储反噬 C:），只用 `weilai close <ch>`。⚠️ 注：真上传（计划②）写盘量大（md5fix 单件 ~400MB、全量 ~40GB），届时仍须先腾更多 C:/H:。

---

## C 系列

| 编号 | 内容 | 改动量 | 架构 | 状态 |
|---|---|---|---|---|
| C1 | 盲等 sleep → `waitFor` 轮询（session.mjs 6+ 处 nav/点击后固定 sleep） | 中 | 局部 | ✅ **live 验证**（冷启 32s<39s 基线·各段早返；超时兜底=原值不退化） |
| C2 | sync 审核批 串行 → 4 并发 | 小 | 无 | ✅ 完成 |
| C3 | `captureListSigs` 捕到即返回（14s→~3-5s） | 小 | 无 | ✅ 完成 |
| C4 | `md5short` 整文件读 → 流式哈希 | 小 | 无 | ✅ 完成 |
| C5 | ready 热路径加「抽屉关 → 只 openView」轻量分支 | 小-中 | 局部 | ✅ **live 验证**（仅抽屉关 1.4s·`open-view-only`·不重握手） |

## S 系列

| 编号 | 内容 | 改动量 | 架构 | 状态 / 前置 |
|---|---|---|---|---|
| **S1** ★ | mid 增量同步：按台账 `last_mid` 批量查 `list-optional`，O(在飞)；根治 norm 脆弱 + 30s 天花板 | 中 | 中 | ✅ **完成·live 验证**。S1a：13 在飞件与全量逐字段一致·查 0.3s vs 3.4s。S1b 签名缓存：TTL≥10min→budget7min·cache命中 6s→1s·失效回退自愈 |
| S2 | 连续流水线：常驻调度拉满 WIP，上传期/审核期重叠（Little 定律） | 大 | 重大 | ⬜ 需 S1+S3 |
| S3 | 逐文件超时提交 + 填 upload/submit 桩（替整批门控） | 中 | 局部-中 | 🟢 **核心 live 验证**（移植瞬态注入 + 逐文件超时改造 + N 取弹窗；真 jie3 创建素材✓·bump dry✓）。轮次token幂等/Network 事件驱动＝后续 |
| S4 | 双通道并行 cycle（`both`，两独立实例 `Promise.allSettled`） | 小-中 | 局部 | ⬜ 受阻于 jie6 冷 profile 登录 |
| **S5** | Thompson 采样择时（Beta-Bernoulli，24 时段臂）+ pass-rate 基建 | 小 | 局部 | ✅ **完成+接线**（submissions.jsonl 旁车·upload 记/sync 结审/`passrate` 命令·passRateArms 喂臂；离线 11/11）。hold-submit 消费待转正 |
| S6 | 上传前 ffprobe 预校验筛必拒件 | 小-中 | 局部 | ⬜ 需平台必拒阈值（领域数据） |
| S7 | 重试预算 maxUploads 固定 → 按 pass_rate 优化广度/深度 | 小 | 局部 | ⬜ 需 pass_rate 数据 |
| S8 | 探针合并 `probeSnapshot`（一次往返拿 acc/url/view/plan） | 小 | 无-局部 | ✅ **live 验证**（热路径 0.9s 空转 skipped） |
| S9 | API-direct 上传（复现 VOD 签名并行推字节，替代串行 DOM 文件选择器） | 大 | 重大 | ⬜ 最高天花板/风险，长期 R&D |

---

## 阶段路线图（按依赖/风险）

1. **Phase 1 = C1+C5+S8**（ready 收敛提速）→ ✅ **已 live 验证**（2026-06-24 清盘后 jie3 真账户，`backup/verify-phase1.mjs` 分段计时：冷启 32.1s / 热 0.9s / 抽屉关 1.4s）。冷启动短于 15s 目标的部分＝Chrome 启动+冷握手不可压；温/热路径已塌到 ~1s。**Phase 1 收官，下一步＝ Phase 2（S1 mid 增量同步）**。
2. **Phase 2 = S1**（mid 增量同步）→ ✅ **完成**（S1a 增量+对账一致·查询快 11×；S1b 签名缓存：实测 op 签名 TTL≥10min→budget 7min·cache 命中 6s→1s·失效回退自愈）。**Phase 2 收官，下一步＝ Phase 3（计划②上传核心，S1 的 live-audit 路径在此被实测）**。
3. **Phase 3 = S3 → S2**（上传核心=计划②）→ 🟢 **S3 核心落地·live 验证 + 硬化 + point7 mid 捕获**（真 jie3 创建素材；inject+submit+bump+轮次token幂等+openView重试+test-round/deliver-round+cycle）。剩：S2 连续流水线 / hold-submit(TTL 探针) / deliver-round live(待 jie6 登录)。**pass-rate 基建已建**（见 S5）。先 jie3 后 jie6。
4. **Phase 4 = S5 接线 + S7 + S6**（数据驱动）→ 🟢 **S5 接线 + pass-rate 基建落地**（submissions.jsonl + `passrate` + bandit arms；离线 11/11 验）。剩：S7 重试预算 / S6 ffprobe 预校验（均需积累真实 pass-rate 数据）+ hold-submit 接 bandit 择时。
5. **Phase 5 = S4 + S9**（受阻/长期）。

依赖：`Phase1`、`S1`、`S3` 各自独立；`S2` 需 S1+S3；`S5/S6/S7` 需 Phase3 的 pass-rate；`S4` 需 jie6 登录修复。

## 验证铁律（本会话已遵循）

- 离线纯函数单测放仓库**外** `I:\weilai-01-backup\`（`verify-*.mjs`），不入 git。
- live 只读优先：`ready jie3`（计时）→ `sync jie3 --no-mutate` → `delete jie3 --dry-run` → `weilai close jie3`；每轮复核 `H:\DD\6-18-魏-指纹\_video_state.json` 字节/mtime/97 未变。
- 回滚：`git checkout .`。

## 已结案的疑点

- **bug #1「delete 将删 0」= 正确行为**（已用平台数据交叉核实：13 待重传 + 4 sealed 在平台无 live 副本，无可删）。

---

## ★ 上传冷启首开竞速 + 静默空转 bug（2026-06-25 真跑揪出·⬜待修）

**现象**：冷启动 Chrome 后**首次**上传，inject 第 1 批 `NO_CHOOSER` ×6 → 注入 0 个 → submit 拿空面板**空转到 45min 超时** → 返回 `injected:0/submitted:0`、**不抛错、退出码 0**。

**根因 = 上传框"可见"先于"可交互"**：千川上传框是点击时临时建 `<input type=file>` 的 React 组件。冷启首开时框已渲染（`findBox` 命中、日志报"点击上传框可见"），但点击处理器**还没挂载完** → `clickAt` 点空 → 不建瞬态 input → 不弹 `Page.fileChooserOpened` → `NO_CHOOSER`。**满盘 C:（1.2G）** 挤压磁盘缓存 → 组件 JS 冷加载慢 → 处理器绑定窗口 **> inject 的 6×~24s 重试预算** → 输掉竞速。组件 JS 进 profile 磁盘缓存后（被打开过一次）秒绑、恢复正常。铁证：预热后同坐标 `clickAt` 一点即触发 chooser（chooser=1）。

**与代码改动无关**：纯平台前端冷加载时序；inject/openUploadPanel 逻辑本身没问题（06-24 暖态单件上传验证过）。delete 平台快照改动等也无关。

**★ 无人值守的真正危害 = 静默空转**：`NO_CHOOSER` 是 warn 不是 error；inject 返回空后 runUpload **照调 submit**、submit 对空面板**傻等 45min**、injected=0 不 bump、台账零变化、**退出码 0**。纯自动化 7 轮通宵跑 → "跑一夜、0 上传、无报错、无告警"——最坏的失败：看着像跑完、其实啥也没干、没人喊救命。

**修复（按重要性）**：
1. **大声失败（无人值守命门）**：inject 产 0 → runUpload 抛 `E_GESTURE`，别返回 `{injected:0}` 往下走；submit 开头**判空短路**（面板没东西就立刻返回，绝不进 45min 等）。把"静默 45min 空转"变"秒级 `E_GESTURE` 退出码"，让 cycle 能接住（重跑 ready/告警/停）。
2. **判"可交互"非"可见"**：`openUploadPanel` 加预热探测——test-click 确认 `fileChooserOpened` 能触发才算 ready；不能就等+重开（带上限）。
3. **冷启重试重开面板**（重挂组件）而非死点同一框 + 首批延长预算。
4. **ready 阶段预热**：ready 顺手开一次上传面板把组件 JS 灌进缓存，真上传首开即热（最干净、不留挂起 chooser）。

最佳组合 = **1（安全网）+ 4（预防）**。

**修复进度（2026-06-25）**：
- 🟡 **①② 已修 + 离线验证**（`lib/upload.mjs` runUpload 注入0→抛 `E_GESTURE`；`lib/submit.mjs` 空面板 total=0→1ms 短路返回，实测）。**失败模式已根治**：从"静默 45min 空转、退出码0"变成"秒级 `E_GESTURE`/退出15、编排器可接住"。注：这修的是**失败模式**（静默→大声），不是**根因**（冷启竞速仍可能发生，但现在大声失败可恢复，且让 iterate 驱动的 try/catch 真正生效）。
- ⬜ ~~③④ 根因预防（warm-up）~~ **作废——根因不是"冷加载"，见下方真根因**。
- ✅ ①② 相关改动均已提交（branch `fix-uncommitted-batch`）。

### ★★ NO_CHOOSER 真根因（2026-06-25 instrument 三层确诊·已根治）

之前"上传框可见先于可交互/组件冷加载/C: 紧"的诊断**全错**（是推断、没 instrument）。用 `elementFromPoint`/逐时坐标/截图/`Page.captureScreenshot` 钉死真因：

- **三层链**：① clickAt(`Input.dispatchMouseEvent`) 点到屏外坐标 → ② `findBox` 的 `getBoundingClientRect` 返回屏外值（实测 cx=2454 > innerWidth=1904；jie6 抽屉宽 ~1100 比窄窗口还宽）→ ③ **真根因＝页面在后台时抽屉布局不落定，box 卡在关闭位(屏外右侧)**。
- **解药＝`Emulation.setFocusEmulationEnabled(true)`**：让后台页按"聚焦"渲染→抽屉布局立刻落定→box 回 1354 屏内。**实测：仅 `Page.bringToFront` 不够（box 仍 2454）；加 setFocusEmulation 后 box→1354 屏内、clickAt 即弹 chooser**（冷启 jie6 终验通过 ✅）。
- **修法（三重·已提交+验证）**：`lib/upload.mjs::findBox` ① 先 `setFocusEmulationEnabled(true)`（真解药）+ 每轮 `bringToFront` ② 连续两次坐标稳定(±2px)且 `inView` 才返回、屏外宁可 null 让上层重试（防御） ③ `system.json --window-size=1920,1080` 钉死宽窗口（防御，抽屉落定后能容下）。
- **为何 jie3 多数没事 / 偶发(upload2)中招**：jie3 抽屉窄、且操作时多在前台；jie6 创意tab 抽屉宽、易在后台测坐标→中招。C: 仅间接（慢渲染拉长未落定窗口），非根因。
- **致谢**：是操作者一句"我手动点就正常弹、会不会是 click 的问题"把方向从"组件"扳到"坐标/手势"，才挖到真根因。

---

## ★ 生产级 34 大批量上传暴露的 2 个 submit/bump bug（2026-06-25 真跑）

首次 jie3「34 件一次性真上传」（≤18 小批从没触发）暴露两个真问题。结果：注入 34 / 平台确认 28 / 6 卡 0%。

**Bug A — submit 逐文件超时形同虚设（拖满 45min）✅ 已修**
完成的文件进度条会**移出列表** → `snap().done` 永久≈0 → 旧踢回判据 `if (s.done>0)` 永不触发 → 6 个卡 0% 件把整批拖到 `maxMs`(45min) 硬超时才提交，而非 `perFileNoProgressSec`(90s) 踢回。
- **修法**（`lib/submit.mjs`）：改用 `s.cEn`（底部确定可点=已有完成件可提交）当"有完成件"信号；进度判据=`inprogSum` 或 `total` 任一变化（total 减少=有件完成离场也算进度）。龟速件 90s 无进度 → 提交已完成、踢回未完成。

**Bug B — bump 按"注入"而非"提交"记账（台账虚高）⬜ 待修·有恢复手段**
`runUpload` 给所有**注入**的 34 件 `uploads++`，但只有 28 个真提交 → 6 卡死件被多记 1 次（含 1 个 uploads=4→5 被冤到作废边缘）。
- **为何难根治**：submit 只知**数量**（28）不知**身份**；上传瞬间平台素材名还是 ID（未解析回文件名），inline 关联不可靠。bump-only-captured 会**漏记真提交**（更糟：漏记→重传→平台重复件）。故**保留 bump-all-injected**（过记方向可恢复），靠**事后对账**纠偏。
- **恢复手段（已验证有效）**：本轮 34 件共享同一 `last_ts`（runUpload 同一 `now`）。sync 后凡 `last_ts` 未被更新者=没传上平台的卡死件 → un-bump（`uploads-1`、`last_status`→2/null、清 `last_mid`/`last_ts`）。本轮据此精准恢复 6 件、0 误伤。
- **待办**：把这套对账做成 `weilai reconcile <ch>`（grace 期后按 last_ts 签名 + 平台素材缺失判定 un-bump），让台账自愈，免手工脚本。
