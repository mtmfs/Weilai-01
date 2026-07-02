# Weilai-01 AI 快速上下文

本文件给 AI 开工冷读用，避免每次吞完整工程总报告。

## 当前定位

Weilai-01 是千川双通道过审流水线 CLI：先用 `free` 免费测试通道筛过审，再把过审素材交给 `paid` 付费投放通道。操作者是业务主管，AI 负责维护和安全驱动。

## 日常入口

- 只读状态：`node bin/weilai.mjs status --json`
- 环境体检：`node bin/weilai.mjs doctor`
- 免费通道就绪：`node bin/weilai.mjs ready`
- 免费飞轮：`node bin/weilai.mjs run`
- 运行产物清理：`node bin/weilai.mjs clean-artifacts`，真删加 `--apply`

## 安全边界

- 绝不杀普通 Chrome；调试实例只用 `weilai close` / `close-paid`。
- `delete`、`clear-local`、`clean-artifacts` 默认 dry-run，真做必须 `--apply`。
- `paid` 是真实花钱通道，必须用户明确要求并解锁。
- 命令行保持 ASCII；中文账户名/计划写 JSON 或走 `login`。

## 读文档策略

- 普通运营/小修：先读本文件、README 的相关段落、目标源码。
- 架构变更、历史排障、已知 bug 判断：再读 `docs/工程总报告.md`。
- 旧设计溯源才读 `docs/PLAN.md` 或 `docs/archive/*`。

## 运行产物

- `telemetry-out/`、`test-out/`、`logs/` 都是可再生运行产物，不是关键资产。
- 搜索/读取时默认排除这些目录；需要排障时只看具体小文件或摘要。
