# 计划① — 自治基建 + 非上传业务（先做·先测）

> ⚠️ **已被 [`docs/工程总报告.md`](工程总报告.md) 取代，仅留作设计/历史追溯。** 下方模块状态表是计划①时的快照、已过时（如"上传桩/cycle 骨架"——实际上传核心已 live、cycle 已多轮收敛）；现状以总报告 §0/§4/§9 为准。

> 派生自 `docs/PLAN.md` §十四。本计划 = 交付「可自启动 / 可自修复 / 可完全托管」的工程外壳 + 所有**不碰上传**的安全操作。与计划②的代码缝 = `upload`/`submit` 接口桩。

## 范围
- **横切层**：`ready`(自启动·session 7探针+8动作收敛) / `guard`(自修复·身份断言+恢复+退出码) / `monitor`+`telemetry`(可托管·旁路录制+分时段统计)
- **框架**：cdp / state / config / log / concurrency
- **非上传业务**：`sync`(拉审核归台账) / `delete`(set-opt 重放·默认dry-run) / `md5fix`(并行ffmpeg) / `status`(只读汇总)
- **编排外壳**：`cycle`(--skip-upload 空转到上传桩) + 双实例(9222/9223)
- **上传接口桩**：`upload.mjs`/`submit.mjs` = `E_NOT_IMPL`（计划②填，不改①）

## 模块状态（截至 3b9ce41）
| 模块/命令 | 状态 | live 验证 |
|---|---|---|
| lib/cdp（+P1 超时） · state（原子写） · config · log · concurrency | ✅ 建 | status/concurrency ✓ |
| lib/session `ready`（+P2 重试/P5 清标签） | ✅ 建 | 热路径 ✓；**冷启动待清盘验** |
| lib/guard | ✅ 建 | 混沌测试间接验 ✓ |
| lib/sync | ✅ 建 | **未 live（待清盘）** |
| lib/delete（默认 dry-run·destructive） | ✅ 建 | **未 live（待清盘）** |
| lib/md5fix（并行 fan-out） | ✅ 建 | **✅ live（3 真视频）** |
| lib/telemetry `monitor`/`stats` | ✅ 建 | stats ✓；record 未 live |
| lib/upload·submit（接口桩） | ✅ 桩 | 抛 E_NOT_IMPL ✓ |
| bin/cmds：status/ready/close/sync/delete/md5fix/prep/cycle/monitor/stats | ✅ 接入 | — |

## ①通过标准（全绿才动计划②）
1. 冷态 `weilai ready jie3` 自启动到就绪。
2. `guard` 自修复：人为造 漂移/弹窗/掉登录 → 自动恢复或正确 E_码停。**（混沌测试已验：43 ready×95 干扰→0 误操作错账户）**
3. `sync` / `delete --dry-run` / `md5fix` / `status` / `monitor` 全跑通。
4. `cycle --skip-upload` 空转完整骨架到上传桩优雅停。
5. 双实例 9222/9223 各自 profile，顶号其一不漂另一。

## ⚠️ 当前阻塞
- **C 盘满** → 冷启动 `ready`/`sync`/`delete` 的 live 验证被卡（Chrome renderer 写不了盘）。清盘后跑 任务#12 验收。
- 铁律：重置 Chrome 只用 `weilai close`，**绝不 `Stop-Process chrome`**（见 HANDOFF）。

## 命令速查
`weilai ready|status|sync|delete[--apply]|md5fix|prep[--apply]|cycle[--skip-upload]|monitor|stats|close <jie3|jie6>`
