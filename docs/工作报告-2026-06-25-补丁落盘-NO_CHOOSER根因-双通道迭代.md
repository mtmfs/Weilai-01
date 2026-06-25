# 工作报告 — 2026-06-25 补丁落盘 · NO_CHOOSER 根因 · 双通道迭代

> 本程范围：精读代码 → 三源交叉验证落盘状态 → 把一批未提交补丁分逻辑落盘 → live 验证 → jie3 两轮生产上传 + 收割 + 对账 → jie6 投放 4 件 → **挖到并根治 NO_CHOOSER 真根因** → jie6 迭代 round-2 → Playwright 式视口硬化 → 合并 push main。
> 操作者：业务主管 ｜ 维护：AI ｜ 仓库：`mtmfs/Weilai-01`（已 push）

---

## 一、一句话

把一批未落盘补丁干净提交并 live 验证；jie3 真传 49 件（两轮）；jie6 投放 4 件（2 过审交付 + 2 被拒已重传）；**最大收获＝用 instrument 把困扰项目最久的 NO_CHOOSER 挖到真根因（后台页布局节流→上传框跑屏外→clickAt 点空）并根治+硬化**。全程零误投、零烧冤枉额度。

---

## 二、落盘的 9 个 commit（全已 push origin/main = `88fb212`）

| commit | 类型 | 内容 | 验证 |
|---|---|---|---|
| `24f845b` | fix | **worklist 重传只取被拒** last_status==2（杜绝重传审核中在飞件） | ✅ 离线+live（真台账 13/30/43 精确匹配） |
| `0d5e024` | fix | **上传 fail-loud**（注入0→E_GESTURE）+ 魏文彬 字段锁 | ✅ live（多次 NO_CHOOSER 秒退、台账零动） |
| `9ef8559` | feat | **cycle 多轮收敛**（报告#11·每轮删腾槽）+ `--rounds/--round-wait` | ✅ live（jie3 2 轮·收敛判定对） |
| `d705582` | perf | **sync→delete 共享平台快照**（dry 零 CDP） | ✅ live（cycle apply 穿快照真删18） |
| `f663b9a` | docs | NO_CHOOSER buglog + 刷新 README/SKILL/HANDOFF + 3 报告 | — |
| `a6e727c` | fix | **submit Bug A**（done 不可靠→改 cEn+total/inprogSum 判进度，杜绝 45min 空等） | ✅ live（upload3 进度判据生效） |
| `28cce98` | fix | **★jie6 NO_CHOOSER 根治**（后台抽屉布局不落定→box屏外→clickAt点空） | ✅ 冷启实测 clickAt 弹 chooser |
| `a46818e` | config | jie6 maxUploads 2→3（投放迭代 2-3 轮） | — |
| `88fb212` | harden | **Playwright 式视口钉死**（setDeviceMetricsOverride+setFocusEmulation·仅 upload 路径） | ✅ 冷启 box try1 即屏内 |

---

## 三、解决的核心问题

### ★ NO_CHOOSER 真根因（项目最久卡点·instrument 三层确诊）
| 层 | 现象 | 工具 |
|---|---|---|
| 表层 | clickAt 点到屏外坐标（**操作者直觉对**） | — |
| 中层 | box `getBoundingClientRect` 返回屏外值（cx=2454 > innerWidth=1904） | elementFromPoint / 逐时坐标 / 截图 |
| **根因** | **页面在后台→布局节流→jie6 抽屉停在关闭位（屏外右侧）** | bringToFront 对比测出 |
| **解药** | `Emulation.setFocusEmulationEnabled(true)` 让后台页按聚焦渲染→布局落定→box 回屏内 | 冷启实测 chooser 弹出 ✅ |

**纠错**：此前"上传框可见先于可交互/组件冷加载/C: 盘紧"的诊断**全是误判**（推断、没 instrument）。C: 仅间接（慢渲染拉长未落定窗口）。

### Bug A（submit 拖满 45min）— ✅ 已修
完成件移出列表→`snap().done` 永久≈0→旧踢回判据 `if(done>0)` 形同虚设。改用 `cEn`（确定可点）+ `inprogSum/total` 任一变化判进度。

### Bug B（bump 按注入非提交·台账虚高）— 🟡 手动救了·命令没做
upload1 注入34/提交28、6 卡死件被多记。手写 last_ts 签名脚本 un-bump 救回（含救回李傲奇延伸-9 的末次机会）。**自动化命令未做（见遗留）。**

---

## 四、业务进展（数字）

| 通道 | 动作 | 结果 |
|---|---|---|
| **jie3** | 两轮真传 49 件（upload1 注入34/提交28；upload3 注入21/提交21）+ 收割 + 对账 6 | 过审累计 **71** ｜ 6 卡死件已救回 |
| **jie6** | 投放 round-1 4 件 → 2 过审交付 + 2 被拒；round-2 重传 2 件（修复代码·冷启 try1 一次过） | **delivered=28** ｜ 13+2 件审核中 |

**台账快照（最终）**：`testing=34 / sealed=0 / delivering=15 / delivered=28 / scrapped=66`（总 143）。

---

## 五、遗留待改（清楚分级·避免编号混淆）

> 编号说明：A/C/S 系列 = `OPTIMIZATION-BACKLOG.md` 正式编号；「报告#N」= 工作报告里的任务/坑号；下表「待办①②…」= 本报告临时序号。

### 高优先（正确性 / 会复发）
| 待办 | 是什么 | 状态 |
|---|---|---|
| ① **reconcile 命令** | 把 Bug B 的手动 un-bump 救法做成 `weilai reconcile <ch>`（grace 期后按 last_ts 签名+平台素材缺失自动修台账） | ⬜ 现只能手写脚本（跨轮即清） |
| ② **视口硬化扩到 delete/ready** | 这次只给 **upload** 加了 setDeviceMetricsOverride/setFocusEmulation；delete(`reopenDrawer`)、ready(`lockPlan`) 也按坐标点击、会踩 NO_CHOOSER 同款坑 | ⬜ upload 已做、delete/ready 未做 |

### 中（功能缺口）
| 待办 | 是什么 | 状态 |
|---|---|---|
| ③ **jie6 delete/sweep** | `runDelete` 对 jie6(creative-tab) 直接抛 E_CONFIG；jie6 腾槽删不了，含本次造的 4 个重复素材 | ⬜ 未实现 |
| ④ **delete 单目标行 E_SELECTOR** | 只 1 个删除目标时抽屉搜索结果不渲染该行→抓不到签名→停 | ⬜ 需翻页/重试兜底 |
| ⑤ **jie6 冷 profile 登录链**（报告#2/#3/#5） | 现靠暖 profile 绕过；登出后 ready jie6 不会自动登录 | ⬜ 探测链有 bug |
| ⑥ **mid 捕获不全** | 命名延迟致 submissions.jsonl 记录不全（jie6=0）→pass-rate 数据偏 | 🟡 sync 回填 last_mid，统计仍偏 |

### 低 / 长期
| 待办 | 是什么 | 状态 |
|---|---|---|
| ⑦ **hold-submit**（桩）+ 接 S5 bandit 择时 | 需延迟挂起 TTL 探针 | ⬜ E_NOT_IMPL |
| ⑧ **S2 飞轮**（双实例并行+台账锁+后台md5fix池） | 现串行防台账竞写 | ⬜ |
| ⑨ **S6 ffprobe 预校验 / S7 按 pass_rate 调重试预算** | 需积累真实过审数据 | ⬜ |
| ⑩ 文档：PLAN-1/2 模块状态表过时；`fix-uncommitted-batch` 分支已合并可删 | housekeeping | ⬜ 小 |

### 待验证（不是待改·悬着）
- 21 件 jie3 + round-2 的 2 件 jie6 + 13 件在飞，全审核中 → 几小时后 `sync` 收割。
- 本次造的 4 个 jie6 重复素材（同哈希）结局没核实，且删不掉（见 ③）。

---

## 六、编号系统总览（一次说清，免再混）

| 编号体系 | 出处 | 例 | 状态 |
|---|---|---|---|
| **A1–A9** | OPTIMIZATION-BACKLOG | 早期 10 个 bug | ✅ 全修(85d09a1) |
| **C1–C5** | OPTIMIZATION-BACKLOG | 低层提速 | ✅ 完成 |
| **S1–S9** | OPTIMIZATION-BACKLOG | S1增量同步✅(06-24)/S2飞轮⬜/S5 bandit✅/S6S7S9⬜ | 部分 |
| **报告#N** | 工作报告 | #11 cycle多轮(本次✅) / #2#3#5 jie6登录链(⬜) | 散 |
| **本报告待办①–⑩** | 本文 §五 | 临时序号，非正式系列 | 见上 |

---

## 七、安全合规
全程 fail-loud 兜底：多次 NO_CHOOSER + 超时 + 我两个 bash 低级错（反斜杠重定向 / scratchpad 跨轮清），**每次都台账零误动、零烧额度、零误投错号**。jie6 写操作前 guardEnter 断言捷沅6；delete 默认 dry-run+魏文彬闸门；绝不 taskkill chrome（只 weilai close）。
