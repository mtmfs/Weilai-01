# Weilai-01 — 千川双通道过审流水线 CLI 重构方案 (v2)

> 操作者：你（业务主管，不写代码）。维护者：我（AI）。
> v2 已并入你的 11 条反馈 + 三轮代码探查的实测结论。本文件既是审批用 plan，也是批准后种进私库 `Weilai-01` 的设计底稿。

---

## 执行摘要（30 秒速览）

把 `I:\cdp-helper\` 的 138 个散脚本收敛成一个 **配置驱动的 CLI**，三个核心设计动作：

1. **session 改成"状态收敛"三层**（7 探针 + 8 幂等动作 + 1 调度器）——人停在任意页面,跑 `ready` 它自己探"我在哪"、只补缺的步骤,根治最脏最多 bug 的冷启动环节。
2. **上传从"整批门控"改成"解耦 + 逐文件超时 + 延迟挂起"**——实测证实:现状一个龟速件会逼着已传完的 9 个**陪等 5 分钟**(最坏 30 分钟)。改成谁传完谁走、龟速件短超时踢回,并支持"传完先挂起、择时一口气提交"。
3. **新增遥测/监控子系统**——旁路被动记录(不干扰操作),持续统计**分时段的上传用时/审核用时/过审率**,反过来告诉"延迟提交"该在哪个窗口发射。

**语言**：你把语言决定权交给我（按我的维护成本定）。把所有优化项摊开后,它们**全是 CDP 浏览器操作或轻量编排,无 CPU 热点** → **单语言 Node 仍最优**(单工具链、可直接继承现有 .mjs)。形态从"一次性 CLI"演进成"常驻 Node 进程(监控+定时) + CLI"。唯一会推翻的情形＝将来真做 API-direct 高并发上传,届时才引 Go worker(范围外)。

**R&D 命门**：延迟挂起能不能成,取决于"平台能挂多久已传完未提交的素材"——代码查不到,**Phase 1 第一件事就是 TTL 实测探针**;实测出安全窗口才转正,否则退回"逐文件即时提交"(已足够解决拖累)。

**盈利模式(点7)/你跳过的点6**：分别 parked / 待你补。

---

## 一、Context

`I:\cdp-helper\` 是一套 CDP 驱动调试版 Chrome 的 Node(.mjs) 工具集,跑**双通道过审流水线**:捷沅3(免费·推商品·暂停)批量传视频筛"审核通过"→ 捷沅6(真金~49万·推直播间·投放)把过审件搬过去真投放。机器真源是本地 `_video_state.json` 双通道台账。

它**能跑、已闭环**,但形态停在"散脚本 + 人肉串联":138 个 `.mjs`(~70 个 probe 一次性件)、无统一入口、无配置层、重复逻辑遍地、硬编码钉死单一目标、冷启动脆弱、上传慢且会被单个龟速件拖死。本方案把它收敛成可被非程序员安全驱动、可被我低成本维护的 CLI。

---

## 二、现状 + 过时之处（你要求的报告）

**现状**：双通道闭环已验证;台账 **97 个视频**(交付15 / 投放中10 / 封存4 / 测试中13 / 作废55)。flat 根目录 `H:\DD\6-18-魏-指纹\`。

| # | 过时点 | 实情 |
|---|---|---|
| 1 | skill 只列 5 份报告 | 实有第 6 份(`报告_双通道7x3跑_2026-06-23`),CLI 雏形+漂移根因+双实例都在里面 |
| 2 | 账户漂移给的是"校验URL重nav"缓解法 | 根因＝两通道共享浏览器 session 被顶号;根治＝**两个独立 Chrome 实例(9222/9223 各自 profile)** |
| 3 | "约定/护栏"段仍写旧单通道 `ever_passed`/`reject_count` | 与"双通道扩展"章自相矛盾(已被取代但旧文没删) |
| 4 | 记"捷沅6 创意tab 没自动化·靠人工" | R6 已脚本化(点击稳定性待加固) |
| 5 | "固定参数写死脚本顶部" | PORT 散在 ~45 文件、ROOT 23、KW 20、aavid 25——换目标/双实例都得 grep-replace |
| 6 | 脚本清单只列几十个 | 实际 138 个;**8 个模式被复制 3–18 次**(见 §十一);命令行有中文编码坑 |
| 7 | "上传时记 materialId"被反复点名为最优解 | 一直没做(本方案纳入) |

---

## 三、设计决策（已并入你的反馈）

| 决策 | 内容 | 来源 |
|---|---|---|
| 落地＝混合 | 直接**继承**已验证的干净件(lib-cdp/lib-state/md5fix/doctor/login… ),**重构**臃肿/重复件(flat-sync/run-delete/两个submit/enter-plan),**合并**重复(8 个模式提取进 lib),**归档** ~70 个 probe | 你点1 |
| 上传＝解耦+逐文件超时+延迟挂起 | DOM 上传加固;list/审核/删除走 API-direct;**字节传输与提交解耦** | 你点2/8/11 |
| 语言＝单 Node(我定) | 优化项全是 CDP/编排,无热点 → 单语言最省我维护;形态为常驻进程+CLI | 你点3/5,授权我定 |
| 加遥测/监控 | 旁路被动记录 + 分时段统计 → 驱动择时 | 你点10 |
| session 三层收敛 | 探针/动作/调度器,从任意页面收敛到就绪 | 你点4/5 |
| 配置化 | 硬编码全外提 `targets/<name>.json`;argv 绝不传中文 | — |
| 操作者＝非程序员 | 命令好记、破坏性默认 dry-run、失败靠重跑续跑、人看+JSON 双输出 | — |
| skill 后置 | 旧 skill 先不管,CLI 稳定后配新 skill | 你点9 |
| 盈利模式 parked | 见 §十五,后续再议 | 你点7 |

---

## 四、各环节的作用与实现（需求1）

业务步骤 → 解耦环节。除 session(见§五)外的核心环节:

| 环节 | 作用 | 关键实现 | 失败模式 |
|---|---|---|---|
| `sync` | 平台审核现实归一进台账、派生待办 | `Page.reload` 捕签名 list-required/optional → 只改 Offset 翻页(Limit500) → LegoMid 批30 拉审核 → norm 文件名匹配 flat → `observe()` → `recomputeStage` → 渲 index.md+worklist | 签名过期、筛选绑签名、名字匹配漏 |
| `delete` | 删过审+被拒副本腾槽 | 1 次 UI 删抓 set-opt 签名 → `fetch` 批量重放 `{optType:delete,params:{LegoMids,UseLegoMid:true}}`;jie6 用预抓签名纯重放 | ROI 锁置灰、签名过期 |
| `md5fix` | 产哈希异、内容同的副本绕去重 | ffmpeg `-c copy -map_metadata -1 -metadata comment=<UUID> -movflags +faststart` → 批次子目录;**并行 fan-out**;已存在则跳过 | ffmpeg 缺、盘满 |
| `inject` | 把一批文件推进上传控件 | reload→合成click 添加视频→上传tab→`setInterceptFileChooserDialog` 一次+`getDocument` 一次→每批≤9:**真实 clickAt** 拖拽框→`fileChooserOpened` 立刻 `setFileInputFiles(backendNodeId)`→处理"仅前N" | 受信任手势失败、瞬态节点 |
| `submit` | 等传完→确认入计划(见§六重构) | 保活(`setFocusEmulationEnabled`+`bringToFront`)→**逐文件**判完成→点确定→连点"确认添加N个"→返回真提交N | 见§六 |
| `bump` | 把本轮写台账(**唯一 uploads++ 写者**) | `bumpUpload(v,ch,{mid,ts})`:uploads+=真提交N、last_status=3;**记 materialId 进 last_mid**(点7);轮次token 幂等 | 计数源错则双计 |
| `promote`(聚合) | sealed(jie3过审)搬 jie6 | = jie6 的 session+inject+submit+bump,源=stage==sealed | jie6 maxUploads=2、ROI锁 |
| `converge`(编排) | 多轮 sync→md5fix→inject→submit 直到待上传=0 | 编排循环,每轮读台账续跑,轮间审核异步留人控点 | 顽固冻检测 |

---

## 五、★ session = 状态收敛聚合（需求4/5）

**纠正**：session 不是不可拆的叶子。它是一长串动作、且人可能停在任意页面启动。改成**最小拆分 + 最大聚合**的三层:

### 7 个只读探针（判断"我在哪一步",可单独调）
`chrome-port`(9222 在听?) · `login-status`(母账号登了?) · `session-cookie`(`_x_ac_ts` 新鲜?) · `tab`(目标 aavid 标签在?) · `account`(当前标签哪个账户?) · `plan`(计划锁住?行数?) · `view`(素材抽屉/创意tab 开了?)

### 8 个幂等动作（每个先探针、已达成就跳过,可单独调）
`launch-chrome` · `login <email> <pwd>` · `sso-handshake <aavid>`(`agent/redirect/ad?advId=` 种会话+校验新鲜) · `ensure-tab <aavid>`(无则建并锁,**带重试**——修现状 10s 硬等无重试) · `set-mode <mode>` · `lock-plan <aavid> <plan>`(jie6 靠 `detail?adId=` URL 锁绕开 4 同名计划) · `open-view`(抽屉 or 创意tab) · `close-popup`

### 1 个收敛调度器（聚合后的 session）
`ready <target>`：按当前状态**只跑缺的那几步**。覆盖人可能停的 **6 种起始态**:

| 起始态 | 探针命中 | 跑哪些动作 |
|---|---|---|
| 没 Chrome | port✗ | 全链 |
| 没登录 | login✗ | login→handshake→…→open-view |
| 对账户对计划抽屉关 | view✗ | 仅 open-view |
| 错账户 | account≠期望 | ensure-tab→…(或停,防误删有钱账户) |
| 对账户错计划 | plan 行=0 | lock-plan→open-view |
| 已就绪 | 全✓ | 空操作 |

**最脆要加固的步**：SSO 握手(补 cookie 新鲜校验)、模式 tab 选择器漂移、jie6 四同名计划(URL 锁)、素材链接点击、建标签重试。现有 `qc-setup.mjs` 已把 jie3 串到 ~85%,缺的正是这些 + 统一调度器 + jie6 并入。

---

## 六、★ 上传重构：解耦 + 逐文件超时 + 延迟挂起（需求2/8/11）

### 实测根因（你点2,证实且更糙）
所有 submit 脚本都等**整批** `inprog===0`(全 100%)才点确定,**无任何逐文件超时**。一个龟速件卡 87% → 已传完的 9 个**陪等 5 分钟**(25×12s stall)才一起提交,最坏 30 分钟(150×12s)。固定开销:每批 reload+开抽屉 ~16s、提交后 settle+关模态 ~13–15s、批间串行 3.5s、12s 轮询太粗。**纯检测+时间分配问题,与拥挤无关。**

### 三层修法
**A. 逐文件独立计时（必做,直接解拖累）**：每个文件单独跟踪;谁到 100% 谁进"可提交集";龟速件超过 per-file 短超时(如 90s 无进度)→踢回重传队列,不拖整批;到点提交"可提交集"、丢弃卡死。把"一个拖死全批"压成"每文件独立、互不影响"。

**B. 批间流水线（提速）**：上一批在传字节时就注入下一批(不等上批传完),共享带宽并行爬;最后统一等+提交。省掉串行间隔与"传完才动下一批"的空转。

**C. ★延迟挂起 + 择时一口气提交（你点11,需 R&D 确认）**：把字节**传完即挂起、不点确定**,静默等待,到点(由§七遥测算出的最佳窗口)**批量秒提交**。它从根上绕开拖累(提交是瞬时的,不受龟速件影响)。
- **实测可行性(Agent1)**：抽屉能挂住"100% 未提交"的素材、之后再提交,单次提交上限 ~10。
- **★命门(未知)**：能挂多久?(签名/会话/平台 hold 的 TTL,代码查不到,Agent 只能推测签名~30min)。
- **Phase 1 第一件事＝TTL 实测探针**:注入N→挂 10/30/60/120min→试提交,记录每个时长还能否成功。**实测出安全窗口才让延迟上传转正**;否则退回 A(逐文件即时提交,已足够)。

**上传前预校验(点8 附带)**：上传前本地查时长/分辨率/编码,先筛掉必拒件,省审核额度。

---

## 七、★ 遥测 / 监控子系统（需求10）

审核时间不定 → 用数据驱动择时。设计一个**旁路被动**子系统(实测可与操作并存、不干扰):

- **怎么不干扰**：`probe-recorder.mjs` 已证明可在**浏览器级 ws** 用 `Target.attachToTarget(flatten)` 旁挂所有标签被动记录,与操作用的页面级 ws 互不抢占。
- **实时监控**：登录态、关键元素在否、各步耗时、上传进度%(5s 采样)。
- **持续记录**：网络 req/resp(带 `Date.now()` 时间戳)、提交点、审核轮询结果 → JSONL。
- **分时段统计**：按视频名/materialId 串成时间线 → 算 `upload_duration`(start→100%)、`audit_latency`(submit→结果)、`pass_rate`;再按 `hour-of-day` 聚合 → 输出"各时段上传多快/审核多快/过审率多高"。
- **回喂**：把"最佳窗口"喂给 §六C 的延迟提交调度器,实现"挑时段发射"。
- **形态**：一个常驻 Node 监控进程(可随实例起停) + 一个 `stats` 命令读 JSONL 出报表。

---

## 八、解耦契约与幂等续跑（需求2）

**铁律**：*环节只读 C(config)/L(台账)/F(flat)/W(worklist)/P(平台);最多只写 {L,F,W} 之一 + stdout。环节间不互调函数、不共享内存,交接一律落盘产物。*

**单写者**（根治计数 bug）：`uploads/last_status` **仅 `bump` 写**;`passed/scrapped/last_mid` **仅 `sync`(observe) 写**;`stage` 由 recompute 算;`worklist/index.md` 仅 `sync` 写;flat 批次子目录仅 `md5fix` 写。`passed`/`scrapped` **单调钉死**(latch,永不回退)。

**幂等续跑**：每叶子从当前台账+平台重算待办,完成的自动跳过。`bump` 由**轮次 token**(`sha1(ch|plan|round|批文件名)` 存 `ledger.rounds[]`)守护,已存在则空操作。**操作者续跑规则＝重跑同一条命令**;台账即检查点。

---

## 九、聚合命令与四级映射（需求3）

### 业务步骤 → 软件动作 → 局部流水线 → 全局流水线

| 业务步 | 软件动作 | 局部流水线 | 全局角色 |
|---|---|---|---|
| 冷启动 | session 三层(探针+动作+调度) | `ready` | 每周期/每实例起 |
| 同步 | 签名 list + LegoMid 审核 | `prep`/`status` | 每轮闸门 |
| 删除 | set-opt 抓+重放 | `prep`(jie3)/`sweep`(jie6) | 上传前腾槽 |
| 改MD5 | 并行 ffmpeg fan-out | `prep` | 产可传批次 |
| 注入 | DOM 拦截+逐文件 setFileInputFiles | `upload` | 逐批/挂起 |
| 提交 | 逐文件判完成→确认(可延迟) | `upload` | 落定/择时发射 |
| 记账 | bump(+materialId) | `upload` | 提交→台账(检查点) |
| 推送 | jie6 session+inject+submit | `deliver-round` | sealed→delivering |
| 收敛 | 循环叶子 | `cycle` 体 | 多轮直到待上传=0 |

### 命令树

```
全局   cycle <target> [--channel jie3|jie6|both]   编排多轮 + 轮间人控点 + 遥测择时
局部   ├─ ready <target>      = session 三层收敛(从任意页面到就绪)
       ├─ status <target>     = sync(只读) + stage 汇总 + 遥测分时段统计
       ├─ prep <target>       = sync → delete(先dry后apply) → md5fix(并行)
       ├─ upload <target>     = inject(逐文件/流水线) → submit(逐文件超时/可延迟) → bump
       ├─ hold-submit <target> [--at <window>]   = 延迟挂起后择时一口气提交(R&D转正后)
       ├─ test-round(jie3)    = prep + upload(批≤5)
       ├─ deliver-round(jie6) = ready(jie6) + sync取sealed + upload(≤2)
       ├─ sweep(jie6)         = sync → delete
       └─ monitor <target>    = 起旁路遥测记录(常驻,不干扰操作)
叶子   每个探针/动作/sync/delete/md5fix/inject/submit/bump 都可单独调(调试/手动收尾)
```

---

## 十、韧性层 guard()（需求4）

每个碰浏览器的叶子跑在 `guard()` 里;纯本地叶子跳过。

| 检测 | 怎么测 | 动作 | 二次失败 |
|---|---|---|---|
| 弹窗遮罩 | 探 `tools-vmok-plugin-modal__close-icon` | 合成click关(黑名单破坏性叉) | 继续 |
| **账户漂移** | 断言 URL aavid&plan & `QC_AAVID` 锁 | 重握手→重nav | 退 E_DRIFT |
| 掉登录 | URL 含 `/login`/`from_qc_login=1` | login母账号→重握手→续跑 | 退 E_LOGIN |
| 签名/SSO 过期 | `_x_ac_ts` 年龄/鉴权错 | 重触发已签名请求重抓 | 退 E_SIG |
| ROI 锁置灰 | 探增删按钮 disabled+ROI>上限 | 提示降 ROI、拦破坏性 | 退 E_ROI |
| 选择器漂移 | 目标为 null | **大声失败**+给选择器提示 | 退 E_SELECTOR |
| 上传冻结 | 逐文件无进度超时 | 踢龟速件、提交已完成 | 整批重试1次→跳过 |

**退出码**：0 OK / 10 E_DRIFT / 11 E_LOGIN / 12 E_SIG / 13 E_ROI / 14 E_SELECTOR(需我修) / 15 E_GESTURE / 16 E_FREEZE_SKIP(非致命) / 20 E_CONFIG / 2 E_USAGE(传了中文)。

**双实例＝结构性根治**：jie3→9222 / jie6→9223,各自 profile。有钱的 jie6 被顶号也漂不到 jie3。guard 漂移恢复是二级网。

---

## 十一、继承 vs 重构清单（需求1,带理由）

### 文件级裁决

| 文件 | 行 | 裁决 | 理由 |
|---|---|---|---|
| **lib-cdp.mjs** | 43 | **直接继承** | 极简、3 导出无硬编码、零重复 |
| **lib-state.mjs** | 84 | **直接继承**⚠ | 分层优秀;aavid/planId 是配置默认非bug;⚠补 ms 级上传完成时间戳(供遥测) |
| md5fix / doctor / login / open-sucai / delete-jie6-replay / bump-jie3round | 16–35 | **继承** | 单一职责、精简 |
| close-popup | 41 | **继承→提为lib** | 设计好(黑名单+模态上下文),提成 `dismissAllPopups()` |
| flat-sync | 131 | **重构** | 含 6 个重复模式 + 硬编码,提取后 ~80 行 |
| flatsync-jie6 | 79 | **并入 flat-sync** | 与 flat-sync 70% 重叠,参数化合一 |
| run-delete | 141 | **重构** | 含审核拉取重复 + 45 行 reopenDrawer 可提取 |
| run-reupload-multi | 83 | **重构** | injectBatch 可提取为 lib |
| run-reupload-wait-submit + patient-submit | 41+44 | **合并** | 近乎相同,合成 `submitWaitLoop({method})`,并入§六逐文件逻辑 |
| enter-plan / enter-1868 | 85 | **重构** | 4 断言可提取;并入§五 session 动作 |
| bump-jie6round | 16 | **并入 bump-jie3round** | 逻辑相同,参数化 channel |
| ~70 个 probe-*.mjs | — | **归档** | 一次性件,留 archive/ 不加载 |

### ★ 8 个跨文件重复模式 → 提取进 lib（最大去重）

| 模式 | 出现 | 提取为 |
|---|---|---|
| 可见性 `vis(el)` | **18+ 文件** | `isVisible` |
| 合成 click | **15+ 文件** | `synthClick` |
| React 输入框赋值 | **10+ 文件** | `setInputValue` |
| 关模态循环 | **8+ 文件** | `dismissModal` |
| 翻页触发 | 3 文件 | `triggerNextPage` |
| 加视频→上传tab→灌文件 | 3 文件 | `uploadFilesViaChooser` |
| 审核快照(list+翻页+去重) | 5 文件 | `auditStatusSnapshot` |
| 签名抓+重放 | 3 文件 | `replaySignature` |

---

## 十二、语言决策（需求3/5）—— 单 Node（你授权我定）

你说语言交给我、按我的维护成本定。把所有优化项摊开后的结论:

| 优化项 | 本质 | 需要别的语言吗 |
|---|---|---|
| 逐文件计时/延迟挂起 | CDP 浏览器观测 | 否,Node 主场 |
| 遥测监控(旁路 recorder) | CDP browser-ws | 否,已是 Node |
| 分时段统计 | 读 JSONL 算 | 否,任意语言皆可,Node 够 |
| 并行 ffmpeg | child_process fan-out | 否 |
| 并发 API(审核/删除) | Promise.all+限流 | 否 |
| 常驻监控+定时提交 | 长跑进程+调度 | 否,Node 长跑进程即可 |

**全是 CDP 操作或轻量编排,无 CPU 密集热点。** → **定:单语言 Node。** 单工具链、可直接继承现有 .mjs、对我维护成本最低。形态从"一次性 CLI"演进成"常驻 Node 进程(监控+定时) + CLI"。**唯一会推翻的情形**＝将来真做 API-direct 高并发上传(重签名/字节流),那时才值得引一个 Go worker——但那是范围外 R&D。**你想推翻随时说。**

---

## 十三、仓库 / 模块布局

```
weilai-01/
├─ bin/weilai.mjs            新  CLI 入口(解析argv、分发、--dry-run、--json、拒中文argv)
│  └─ cmds/                  新  薄子命令(探针/动作/各聚合 各一个)
├─ lib/
│  ├─ cdp.mjs               继承 + 吸收 8 个去重模式(isVisible/synthClick/setInputValue/dismissModal/triggerNextPage/uploadFilesViaChooser/auditStatusSnapshot/replaySignature)
│  ├─ state.mjs             继承(补 ms 级时间戳)
│  ├─ config.mjs            新  载入 targets/*.json+system.json、校验
│  ├─ guard.mjs             新  §十 韧性包装+退出码
│  ├─ session.mjs           新  §五 探针+动作+ready 调度器(吸收 enter-plan/open-sucai/qc-setup)
│  ├─ sync.mjs              重构合并 flat-sync+flatsync-jie6
│  ├─ upload.mjs            重构 §六 inject(逐文件/流水线)
│  ├─ submit.mjs            重构合并两 submit(逐文件超时+可延迟挂起)
│  ├─ delete.mjs            重构合并 run-delete+delete-jie6-replay
│  ├─ md5fix.mjs            重构(并行 fan-out)
│  ├─ telemetry.mjs         新  §七 旁路 recorder + 分时段统计(吸收 probe-recorder/netwatch/tabwatch)
│  ├─ concurrency.mjs       新  p-limit 限流
│  └─ log.mjs               新  人看 stderr + 机器 JSON stdout
├─ targets/{jie3,jie6}.json 新  aavid/planId/advId/port/maxUploads/ui/kw/flatRoot/md5Dir/ffmpeg/channel
├─ system.json             新  chromePath/端口/ledgerPath/并发/超时/per-file 超时
├─ docs/                   新  OPERATING.md / RECOVERY.md / ARCHITECTURE.md
├─ archive/                归档  ~70 probe-*.mjs
├─ package.json            新  ESM、bin:weilai、无运行时依赖(原生 WS)
└─ .gitignore             新  台账/md5产物/secrets/profile
```

---

## 十四、执行路线（批准后做）

**Phase 0 — 立即交付（批准后第一步）**：`gh auth status` 验证 → `gh repo create Weilai-01 --private` → 种入 README + docs(自本 plan 派生) + 可编译骨架(config/CLI 分发/targets/system.json) → 跑通 `weilai status --json`(只读)。

**Phase 1 — R&D + 配置骨架**：① **延迟挂起 TTL 实测探针**(决定点11能否转正);② config 载入/校验、CLI 分发、`--dry-run`/`--json`、拒中文 argv。
**Phase 2 — 继承 + 去重 + 重构核心**：吸收 8 个重复模式进 lib;重构 sync/upload/submit/delete/md5fix;session 三层(探针+动作+ready)。
**Phase 3 — guard + 聚合 + 上传新逻辑**：guard+退出码;`ready`/`prep`/`upload`(逐文件超时+流水线)/`test-round`/`sweep`/`status`。
**Phase 4 — 双实例 + 遥测 + cycle**：9222/9223;telemetry 旁路记录+分时段统计;`monitor`;延迟提交择时;`cycle` 全局闭环;记 materialId。

**里程碑**：M1 `status` 只读跑通 → M2 TTL 探针出安全窗口 + `test-round --dry` → M3 jie3 实跑一轮(逐文件超时验证不再被拖累) → M4 双实例+遥测分时段报表 → M5 `cycle`+延迟择时闭环。

---

## 十五、其他观察 / 提议 + 盈利模式（需求6/7）

**点6**：你跳过了,等你补。
**点7 盈利模式[parked]**：① 你的"内置便宜AI key"风险是 key 被扒 → 必须配反逆向 + **服务端代理转发 key**(绝不落客户端);② 更稳是 **SaaS 服务端化**(核心编排跑你服务器、客户端只当浏览器桥,按量/席位计费,天然防逆向且控量);③ 令牌按**成功过审数/上传量**计费(与客户收益挂钩,比纯时长好卖);④ 审计日志/水印做合规卖点。后续详议。

**附带改进**：① **记 materialId 进台账**(点7最优解,已纳入 bump/sync)——之后直接按 mid 查审核,绕开 list 筛选脆弱性;② 台账**原子写(临时文件→rename)+备份**(现状覆盖写不抗崩溃);③ **选择器集中 + `weilai selftest`**(破坏性运行前先验选择器漂移);④ **凭据不进仓库**(母账号密码放本地未跟踪 secrets/环境变量)。

**v1 范围外**：API-direct 上传、Go/Rust、SQLite(JSON 够用)、最外层"7×3 全自动"(稳在轮级、人在环)。

---

## 十六、验证方法（端到端）

1. **只读自检** `weilai status --json` → doctor 全✓、台账与现状 97 件一致。
2. **TTL 探针** Phase1:注入N挂不同时长试提交 → 出"能挂多久"安全窗口(延迟上传转正依据)。
3. **dry-run** `weilai prep jie3 --dry-run` 打印清单不动平台 → 核对后 `--apply`。
4. **逐文件超时验证** jie3 取含 1 个人为限速件的小批 → 跑 `test-round` → **已传完的不再陪等 5 分钟**(对比现状)。
5. **韧性** 手动弹"AI修复"遮罩→guard 自动扫;手动导到 jie6→guard 报 E_DRIFT 而非误删。
6. **遥测** 跑一轮 → `status` 出分时段上传/审核/过审率报表。
7. **双实例** 9222 起 jie3、9223 起 jie6,`cycle --channel both`,顶号其一不漂另一。

---

## 关键文件（重构来源,在 `I:\cdp-helper\`）

- `lib-cdp.mjs`(43L,**继承**+吸收8模式)、`lib-state.mjs`(84L,**继承**+补时间戳)
- `flat-sync.mjs`(131L)+`flatsync-jie6.mjs`(79L) **重构合并**→lib/sync.mjs
- `run-reupload-multi.mjs`(83L) **重构**→lib/upload.mjs;`run-reupload-wait-submit.mjs`+`run-reupload-patient-submit.mjs` **合并**→lib/submit.mjs(并入逐文件超时)
- `run-delete.mjs`(141L)+`delete-jie6-replay.mjs` **重构合并**→lib/delete.mjs
- `enter-plan.mjs`/`enter-1868.mjs`/`open-sucai.mjs`/`qc-setup.mjs` **重构**→lib/session.mjs(探针+动作+ready)
- `probe-recorder.mjs`/`probe-netwatch.mjs`/`probe-tabwatch.mjs` **吸收**→lib/telemetry.mjs
- `报告_双通道7x3跑_2026-06-23.md` §九(CLI 雏形,本方案在其上重构)
