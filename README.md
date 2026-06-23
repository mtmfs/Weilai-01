# Weilai-01

> ⚠️ **接手 / 下个 agent：先读 [`docs/HANDOFF.md`](docs/HANDOFF.md)** —— 当前进度、磁盘满导致的"假崩"、下一步。

千川双通道过审流水线 CLI。把 `I:\cdp-helper\` 的 138 个散脚本收敛成一个**配置驱动、可被非程序员安全驱动、可被维护者低成本演进**的 CLI。

- **测试通道 jie3**（捷沅3 · 推商品 · 免费 · 暂停计划）：批量传视频筛「审核通过」。
- **投放通道 jie6**（捷沅6 · 推直播间 · 真金 · 投放中）：把过审件搬过去真投放。
- **机器真源** = 本地双通道台账 `_video_state.json`。

## 当前状态
**Phase 0（骨架）**。`status` 命令可用（只读，读真实台账出汇总）；其余命令为占位，按 `docs/PLAN.md` 的 Phase 1–4 推进。

## 快速上手
```bash
node bin/weilai.mjs status --json     # 只读：台账分阶段/分通道汇总
node bin/weilai.mjs status jie3       # 只看 jie3
node bin/weilai.mjs --help            # 命令总览
```

## 目录结构
```
bin/weilai.mjs      CLI 入口 / 分发 / argv 护栏（拒中文）
bin/cmds/           各子命令（status 已实现，余为 Phase 1–4）
lib/                共享库：config / state（Phase 2 起补 cdp/session/sync/upload/submit/delete/telemetry/guard）
targets/            通道配置 jie3.json / jie6.json（账户/计划/端口/模式/maxUploads）
system.json         机器 + 项目级配置（项目根、关键词、chrome、ffmpeg、路径、超时、并发）
docs/               PLAN（设计底稿）/ ARCHITECTURE / OPERATING / RECOVERY
archive/            旧 probe 一次性件归档
```

## 设计速读（详见 `docs/PLAN.md`）
三个核心设计动作：
1. **session = 状态收敛三层**（7 探针 + 8 幂等动作 + 1 调度器 `ready`）——人停在任意页面也能收敛到上传就绪。
2. **上传解耦**——字节传输与提交分离；逐文件超时（龟速件踢回、不拖整批）；延迟挂起 + 择时秒提交。
3. **旁路遥测**——被动记录不干扰操作，分时段统计上传/审核/过审率，回喂择时。

## 安全约定
- 破坏性操作（删除）**默认 dry-run**，`--apply` 才动平台。
- 失败靠**重跑同一条命令**续跑（台账即检查点）。
- 只动含项目关键词的文件；账户/计划由配置锁定，漂移即停（不误删有钱账户）。
- 凭据**不入库**（见 `.gitignore`）。
