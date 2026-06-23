# 架构（ARCHITECTURE）

完整设计与决策见 `PLAN.md`。本文给维护者速查。

## 三个核心设计动作
1. **session = 状态收敛三层**
   - 7 探针（只读判「我在哪一步」）：`chrome-port` / `login-status` / `session-cookie`(_x_ac_ts 新鲜) / `tab` / `account` / `plan` / `view`。
   - 8 幂等动作（先探针、已达成即跳过）：`launch-chrome` / `login` / `sso-handshake` / `ensure-tab`(带重试) / `set-mode` / `lock-plan`(jie6 靠 detail?adId 绕 4 同名计划) / `open-view` / `close-popup`。
   - 1 调度器 `ready <target>`：按当前状态只跑缺的步，覆盖 6 种起始态（没Chrome/没登录/抽屉关/错账户/错计划/已就绪）。
2. **上传解耦**：字节传输与提交分离；逐文件超时（无进度 90s 踢回，不拖整批 ←现状一个龟速件逼全批等 5 分钟）；批间流水线；延迟挂起 + 择时秒提交（待 TTL 实测转正）。
3. **旁路遥测**：browser-ws 被动记录（与操作页面级 ws 不抢占）→ 分时段统计 `upload_duration` / `audit_latency` / `pass_rate` → 回喂择时。

## 解耦契约
环节只读 config / 台账 / flat / worklist / 平台；最多写其一 + stdout；交接靠落盘产物，不互调函数。
**单写者**：`uploads/last_status` 仅 `bump`；`passed/scrapped/last_mid` 仅 `sync`(observe)；`stage` 由 recompute。`passed`/`scrapped` 单调钉死。
**幂等续跑** = 重跑同一条命令；`bump` 由轮次 token 防双计；台账即检查点。

## 模块映射（继承 / 重构 / 新建）
| 模块 | 职责 | 来源 |
|---|---|---|
| lib/cdp | CDP 原语 + 8 个去重模式 | 继承 lib-cdp + 吸收 |
| lib/state | 台账 observe/recompute/bump/worklists | 继承 lib-state（补 ms 时间戳） |
| lib/config | system.json + targets/*.json 载入校验 | 新 |
| lib/session | 探针 + 动作 + ready | 重构 enter-plan/open-sucai/qc-setup |
| lib/sync | 拉审核归一台账 | 合并 flat-sync + flatsync-jie6 |
| lib/upload | inject 逐文件 / 流水线 | 重构 run-reupload-multi |
| lib/submit | 逐文件超时 + 可延迟挂起 | 合并两 submit |
| lib/delete | set-opt 抓 + 重放 | 合并 run-delete + delete-jie6-replay |
| lib/md5fix | 并行 ffmpeg fan-out | 重构 md5fix |
| lib/telemetry | 旁路记录 + 分时段统计 | 吸收 probe-recorder/netwatch/tabwatch |
| lib/guard | 韧性包装 + 退出码 | 新 |

### 8 个跨文件重复模式 → 提取进 lib/cdp
`isVisible`(18+) · `synthClick`(15+) · `setInputValue`(10+) · `dismissModal`(8+) · `triggerNextPage`(3) · `uploadFilesViaChooser`(3) · `auditStatusSnapshot`(5) · `replaySignature`(3)

## 双通道
| | jie3 | jie6 |
|---|---|---|
| 角色 | 测试 · 免费 · 暂停 | 投放 · 真金 · 投放中 |
| aavid | 1849209213181706 | 1862076853297476 |
| 计划 adId | 1868230520126939 | 1864536448309275 |
| 模式 | 推商品（抽屉） | 推直播间（创意 tab） |
| 端口 | 9222 | 9223（双实例根治漂移） |
| maxUploads | 5 | 2 |

## 语言
单语言 Node（ESM，无运行时依赖，CDP 走原生 WebSocket）。所有优化项均为 CDP 操作或轻量编排、无 CPU 热点，故单语言对维护者最省。形态：常驻 Node 进程（监控 + 定时） + CLI。
