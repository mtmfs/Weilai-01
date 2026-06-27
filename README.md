# Weilai-01

> ⚠️ **接手 / 下个 agent：先读 [`docs/工程总报告.md`](docs/工程总报告.md)** —— 项目唯一权威总览（现状 / 架构 / 数据模型 / 已知坑 / 路线）。旧日报已归档于 `docs/archive/`。

千川双通道过审流水线 CLI。把 `I:\cdp-helper\` 的 138 个散脚本收敛成一个**配置驱动、可被非程序员安全驱动、可被维护者低成本演进**的 CLI。

- **测试通道 free**（= jie3 · 捷沅3 · 推商品 · 免费）：批量传视频筛「审核通过」。
- **投放通道 paid**（= jie6 · 捷沅6 · 推直播间 · 真金 · 投放中 · **主管级**）：把过审件搬过去真投放。
- **机器真源** = 本地双通道台账 `_video_state.json`。

## 当前状态
**双通道闭环已 live 跑通**（free 筛过审 → paid 真投放）。命令面 2026-06 重构：**裸命令默认 free**、付费 `paid` 通道主管级隔离（`WEILAI_SUPERVISOR=1` 解锁），旧名（test-round/deliver-round/stats/sweep…）全保留为别名。新增 `doctor/scan/whoami/open/inspect/login`。**paid 投放通道半残**（删除未实现、靠暖 profile 登录，见总报告 §6）。**现状以 `docs/工程总报告.md` 为准。**

## 快速上手
```bash
node bin/weilai.mjs doctor            # 环境自检（开工先跑）
node bin/weilai.mjs status            # 只读：台账分阶段/分通道汇总（默认 both）
node bin/weilai.mjs status free       # 只看 free(=jie3)
node bin/weilai.mjs --help            # 分组命令总览（--help-all 含主管级/别名）
```

## 目录结构
```
bin/weilai.mjs      CLI 入口 / 声明式命令注册表 / 别名 / 主管闸 / 通道解析 / argv 护栏（拒中文）
bin/cmds/           各子命令（看/会话/流水线/编排/维护/主管 六组；旧名保留为别名）
lib/                共享库：config/state/cdp/session/guard/sync/upload/submit/delete/md5fix/clearlocal/telemetry/bandit/concurrency/tier/config-write/selectors/log
channels/           通道配置 jie3.json(free) / jie6.json(paid)（账户/计划/端口 24601-2/模式/maxUploads）
system.json         机器 + 项目级配置（项目根、关键词、chrome、ffmpeg、路径、超时、并发）
docs/               工程总报告（权威总览）/ PLAN（设计底稿）/ archive（旧日报 + 已并入报告的参考文档）
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
