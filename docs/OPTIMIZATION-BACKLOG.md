# 优化 Backlog —— C 系列（低层 perf）/ S 系列（深层算法·并发·业务结构）

> 设计细节与依赖图见 plan 底稿（会话外 `~/.claude/plans/plan-pure-hoare.md`）。本文件是 repo 内的**状态台账**，给下个维护者速查「改了什么、还剩什么、卡在哪」。
> 分支 `perf-roadmap`（基线 `333aca8`）。本文件随该分支演进。

## 一句话现状（截至 2026-06-24）

- **A 系列 10 个 bug**：✅ 全修，离线 12 单测 + live 全链验证（`85d09a1`，部分随 perf 提交）。
- **C2 / C3 / C4 提速**：✅ 完成并 live 验证（`d2aec32`），sync `19s→10.9s`。
- **S5 Thompson bandit**：✅ 模块完成、离线单测 7/7（`13ad129`）；**未接线**（消费方=hold-submit，Phase 3/4）。
- **Phase 1（C1/C5/S8 ready 收敛提速）**：✅ **代码完成并 live 验证**（`4dad860`，2026-06-24 清盘后 jie3 真账户复测）。**冷启动 32.1s**（attempt1 一次过·账户✓·视图开，vs 基线≈39s）｜**热路径 0.9s**（S8 probeSnapshot 空转 skipped）｜**仅抽屉关 1.4s**（C5 `open-view-only`·不重握手）。冷启动未达 ~15s 目标——余下耗时＝Chrome 启动 8s + 冷握手/建标签/等账户 16s（基本不可压、非代码问题）；C1/C5/S8 真实收益在温/热/抽屉关路径：**操作者日常 re-ready 从 ~40s 塌到 ~1s**。同轮只读链路全过（`sync --no-mutate` live=315 / `delete --dry-run` 将删0 / 台账字节·mtime 未变 / `close` 优雅关）。
- **S1a（mid 增量同步）**：✅ **完成并 live 对账验证**（`--incremental` opt-in，默认仍全量）。13 在飞件与全量逐字段一致、查 0.3s vs 全量 3.4s、台账零改动。⚠️ 本轮 13 件 last_mid 均 isDel→observed0（轮次间已删），"读 live 审核变更"路径＝同一 observe()，待计划②产出新 live mid 实测。S1b（签名缓存跳 reload）⬜ 待做。
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
| **S1** ★ | mid 增量同步：按台账 `last_mid` 批量查 `list-optional`，O(在飞)；根治 norm 脆弱 + 30s 天花板 | 中 | 中 | 🟢 **S1a 完成·live 对账验证**（`pullRowsByMid`+`runSyncIncremental`+`--incremental`；13 在飞件与全量逐字段一致·0.3s vs 3.4s；本轮均 isDel→observed0，live-audit 路径待计划②）。S1b 签名缓存 ⬜ |
| S2 | 连续流水线：常驻调度拉满 WIP，上传期/审核期重叠（Little 定律） | 大 | 重大 | ⬜ 需 S1+S3 |
| S3 | 事件驱动提交 + 逐文件超时（监听 Network 完成信号，替代 12s 刮 DOM%）；填 upload/submit 桩 | 中 | 局部-中 | ⬜ 计划②；碰真上传 |
| S4 | 双通道并行 cycle（`both`，两独立实例 `Promise.allSettled`） | 小-中 | 局部 | ⬜ 受阻于 jie6 冷 profile 登录 |
| **S5** | Thompson 采样择时（Beta-Bernoulli，24 时段臂） | 小 | 局部 | ✅ **模块完成**（`lib/bandit.mjs`，离线验）；待接 hold-submit |
| S6 | 上传前 ffprobe 预校验筛必拒件 | 小-中 | 局部 | ⬜ 需平台必拒阈值（领域数据） |
| S7 | 重试预算 maxUploads 固定 → 按 pass_rate 优化广度/深度 | 小 | 局部 | ⬜ 需 pass_rate 数据 |
| S8 | 探针合并 `probeSnapshot`（一次往返拿 acc/url/view/plan） | 小 | 无-局部 | ✅ **live 验证**（热路径 0.9s 空转 skipped） |
| S9 | API-direct 上传（复现 VOD 签名并行推字节，替代串行 DOM 文件选择器） | 大 | 重大 | ⬜ 最高天花板/风险，长期 R&D |

---

## 阶段路线图（按依赖/风险）

1. **Phase 1 = C1+C5+S8**（ready 收敛提速）→ ✅ **已 live 验证**（2026-06-24 清盘后 jie3 真账户，`backup/verify-phase1.mjs` 分段计时：冷启 32.1s / 热 0.9s / 抽屉关 1.4s）。冷启动短于 15s 目标的部分＝Chrome 启动+冷握手不可压；温/热路径已塌到 ~1s。**Phase 1 收官，下一步＝ Phase 2（S1 mid 增量同步）**。
2. **Phase 2 = S1**（mid 增量同步）→ 🟢 **S1a 落地**（opt-in `--incremental`，对账与全量一致、查询快 11×）。剩 S1b（签名缓存跳 reload，需先 `probe-sig-ttl` 实测 list-optional 签名 TTL）。
3. **Phase 3 = S3 → S2**（上传核心=计划②）+ 建 `submissions.jsonl` pass-rate 基建。碰真上传，先 jie3 后 jie6。
4. **Phase 4 = S5 接线 + S7 + S6**（数据驱动，依赖 Phase 3 产出 pass-rate）。
5. **Phase 5 = S4 + S9**（受阻/长期）。

依赖：`Phase1`、`S1`、`S3` 各自独立；`S2` 需 S1+S3；`S5/S6/S7` 需 Phase3 的 pass-rate；`S4` 需 jie6 登录修复。

## 验证铁律（本会话已遵循）

- 离线纯函数单测放仓库**外** `I:\weilai-01-backup\`（`verify-*.mjs`），不入 git。
- live 只读优先：`ready jie3`（计时）→ `sync jie3 --no-mutate` → `delete jie3 --dry-run` → `weilai close jie3`；每轮复核 `H:\DD\6-18-魏-指纹\_video_state.json` 字节/mtime/97 未变。
- 回滚：`git checkout .`。

## 已结案的疑点

- **bug #1「delete 将删 0」= 正确行为**（已用平台数据交叉核实：13 待重传 + 4 sealed 在平台无 live 副本，无可删）。
