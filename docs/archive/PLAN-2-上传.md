# 计划② — 上传核心（后做·纯增量）

> ⚠️ **已被 [`docs/工程总报告.md`](工程总报告.md) 取代，仅留作设计/历史追溯。** 上传核心已 live 落地（仅 hold-submit 仍为桩）；现状以总报告 §0/§5 为准。

> 派生自 `docs/PLAN.md` §六/§十四。本计划 = 把 `upload`→`submit`→`bump` 的真实实现**填进计划①预留的接口桩**，**不改计划①任何模块**。计划① 五条标准全绿后才动。

## 代码缝（接口契约，计划①已留桩 `E_NOT_IMPL`）
- `lib/upload.mjs`：
  - `openUploadPanel(cdp, cfg)` → 在已就绪视图打开「添加视频→上传视频」面板，返回 `{ready}`。
  - `inject(cdp, cfg, files, opts)` → 逐文件/流水线灌文件（滑动窗口、卡死踢回），返回 `{injected:[name],window:n}`；不提交。
- `lib/submit.mjs`：
  - `submit(cdp, cfg, opts)` → ★逐文件超时(谁传完谁走、龟速件短超时踢回，不整批门控) → 点确定 → 连点「确认添加 N 个」→ 返回 `{submitted:N, mids:[...]}`。
  - `holdSubmit(cdp, cfg, {at})` → 已 100% 未提交的挂起，到遥测窗口择时一口气提交。
- `bump`：调 `state.bumpUpload(v, ch, {mid, ts})`（已在 lib/state）+ **记 materialId 进 last_mid**（point7）。N 只来自 submit 的真提交数。

## 上传重构要点（§六，混沌测试外的核心优化）
- **A 逐文件独立超时**（必做）：现状是整批门控——一个龟速件逼已传完的 9 个陪等 5 分钟（实测）。改成逐文件、龟速件 ~90s 无进度踢回队列。
- **B 批间流水线**：上批在传时就注入下批。
- **C ★延迟挂起 + 择时秒提交**：字节传完即挂起、不提交，到遥测最佳窗口批量秒提交（绕开龟速拖累）。
- **上传前预校验**：本地查时长/分辨率/编码，先筛掉必拒件省审核额度。

## R&D 第一件事
- **延迟挂起 TTL 实测探针**：注入 N 个 → 挂 10/30/60/120 分钟 → 试提交，记录每个时长还能否成功 → 出「能挂多久」安全窗口。**实测过才让 hold-submit 转正**；否则退回 A（逐文件即时提交，已足够解拖累）。

## 复用计划①的现成件
- `ready`（就绪）、`guard`（韧性）、`sync`/`delete`（拉取/删除）、`md5fix`（产可传批次）、`telemetry`（择时数据）、`cdp` 的受信任手势 `clickAt`(上传拖拽框必须用) + 文件框拦截原语。
- 重构源：`I:\cdp-helper\run-reupload-multi.mjs`(inject) / `run-reupload-wait-submit.mjs`+`patient-submit.mjs`(submit，并入逐文件超时)。

## ②通过标准
- jie3 取含 1 个人为限速件的小批 → 跑 `test-round` → **已传完的不再陪等 5 分钟**（对比现状）。
- 双通道 `cycle` 完整闭环（jie3 筛过审 → 推 jie6 投放）。
