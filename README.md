# Weilai-01

千川双通道过审流水线 CLI：用 **free 免费测试通道**批量筛「审核通过」，再把过审素材交给 **paid 付费投放通道**真投放。

这个仓库目前是**内部本机工具**，不是已完成分发的产品。README 只写日常操作和维护入口；完整现状、架构、数据模型、已知问题以 [`docs/工程总报告.md`](docs/工程总报告.md) 为准。

---

## 目录

1. [项目定位](#项目定位)
2. [当前状态](#当前状态)
3. [命令模型](#命令模型)
4. [日常操作](#日常操作)
5. [命令清单](#命令清单)
6. [配置与数据](#配置与数据)
7. [安全边界](#安全边界)
8. [开发与验证](#开发与验证)
9. [项目结构](#项目结构)

---

## 项目定位

Weilai-01 把「素材过审」拆成一组可重跑、可对账、可被 AI/非程序员安全驱动的 CLI 命令：

1. **free 筛选**：把本地视频传到免费测试通道，批量筛出过审素材。
2. **台账追踪**：用 `_video_state.json` 记录每个视频在每个通道的上传次数、审核状态、阶段。
3. **MD5 重试**：被拒素材通过 ffmpeg 重封装改哈希，再重新上传。
4. **paid 投放**：把 free 已过审素材推到付费投放通道。
5. **旁路遥测**：录制上传/审核请求，统计时延、错误率、过审率。

核心原则：**平台是真实副作用，本地台账是机器真源，命令必须有清楚的风险边界。**

---

## 当前状态

| 能力 | 状态 | 说明 |
|------|------|------|
| free 流水线 | 可日常用 | `ready` / `sync` / `delete` / `md5fix` / `upload` / `run` |
| paid 上传 | 可用但谨慎 | `upload-paid` / `run-paid` 走主管级闸，真烧钱 |
| paid 删除 | 可用但谨慎 | `delete-paid` / `sweep`，dry-run 默认，真删需 `--apply` |
| 冷登录 | 半残 | 仍依赖暖 profile，详见工程总报告 |
| 分发 | 未产品化 | example 配置已准备，真实 `system.json` / `channels/*.json` 本机持有 |
| 主管锁 | 已实装轻量版 | 签名主管 token + 临时 session；默认解锁 120 分钟，可 `--all-day` 全天解锁 |

---

## 命令模型

### free / paid 标签

| 标签 | 配置角色 | 用途 | 风险 |
|------|----------|------|------|
| `free` | `role="test"` | 免费测试通道，筛过审 | 默认通道 |
| `paid` | `role="delivery"` | 付费投放通道，真投放 | 主管级，默认锁定 |

`free` / `paid` 是命令层标签；台账内部键来自本机 `channels/*.json`，当前常见为 `jie3` / `jie6`。不要把 `jie3` / `jie6` 当成日常命令入口。

### 空格 vs 横杠

规则固定为：**空格=普通参数；横杠=产品化入口/风险边界**。

正确：

```powershell
node bin/weilai.mjs upload
node bin/weilai.mjs upload-paid
node bin/weilai.mjs status paid
node bin/weilai.mjs config get paid maxUploads
```

错误：

```powershell
node bin/weilai.mjs upload paid
node bin/weilai.mjs ready paid
node bin/weilai.mjs sync paid
```

这些裸组合会在进入业务逻辑前返回 `E_USAGE=2`。

### paid 主管闸

任何 paid 操作都要先安装主管 token，再显式解锁：

```powershell
node bin/weilai.mjs supervisor install-token <token>
node bin/weilai.mjs supervisor unlock
node bin/weilai.mjs upload-paid
```

`supervisor unlock` 默认解锁 120 分钟；主管需要长跑时可用 `supervisor unlock --all-day` 解锁 24 小时。跑完可用 `supervisor lock` 手动上锁。

普通 `--help` 不显示主管级命令；查看全集：

```powershell
node bin/weilai.mjs --help-all
```

---

## 日常操作

### 只读体检

```powershell
node bin/weilai.mjs doctor
node bin/weilai.mjs scan
node bin/weilai.mjs status
```

- `doctor`：检查磁盘、Chrome、ffmpeg、端口、台账、通道配置。
- `scan`：查看调试 Chrome 是否在跑、标签是否在位。
- `status`：读取本地台账汇总，不碰平台。

### free 日常跑量

```powershell
node bin/weilai.mjs run
```

`run` 默认只走 free，是日常主力。长跑日志会落到 `logs/run-<日期>.log`。

### free 手动一轮

```powershell
node bin/weilai.mjs ready
node bin/weilai.mjs sync
node bin/weilai.mjs delete
node bin/weilai.mjs delete --apply
node bin/weilai.mjs md5fix
node bin/weilai.mjs upload
node bin/weilai.mjs sync
node bin/weilai.mjs status
```

`delete` 默认 dry-run，确认清单后再加 `--apply`。

### paid 投放

```powershell
node bin/weilai.mjs supervisor unlock
node bin/weilai.mjs ready-paid
node bin/weilai.mjs sync-paid
node bin/weilai.mjs upload-paid
```

持续跑 paid：

```powershell
node bin/weilai.mjs supervisor unlock --all-day
node bin/weilai.mjs run-paid
```

free + paid 双通道：

```powershell
node bin/weilai.mjs supervisor unlock --all-day
node bin/weilai.mjs run-both
```

### 排查单件

```powershell
node bin/weilai.mjs inspect 张晟钰
node bin/weilai.mjs whoami
node bin/weilai.mjs monitor-report
```

`inspect <名字片段>` 是只读台账搜索，允许中文；其他命令行参数保持 ASCII。

---

## 命令清单

### 看 / 体检

| 命令 | 别名 | 作用 |
|------|------|------|
| `doctor [--fix]` | `preflight` | 环境自检；`--fix` 尝试修补机器配置 |
| `status [both/free/paid]` | `st` | 台账分阶段/分通道汇总 |
| `inspect <名字片段>` | `show`, `find` | 查某个视频在台账里的状态 |
| `scan` | `ps` | 扫调试 Chrome 和目标标签 |
| `whoami` | - | 检查 free 标签/会话 |
| `monitor` | - | 录 free 遥测 |
| `monitor-report` | `stats`, `traffic` | 读 free 遥测报表 |
| `passrate` | - | 分时段过审率和建议提交时段 |

### 会话 / 流水线

| 命令 | 别名 | 作用 | 风险 |
|------|------|------|------|
| `open` | - | 启动 free 调试 Chrome，不收敛 | 浏览器 |
| `ready` | - | 收敛 free 到上传就绪 | 浏览器 |
| `close` | - | 优雅关闭 free 调试 Chrome | 浏览器 |
| `login` | - | 交互式录入端口、凭据、通道标识 | 写配置 |
| `sync` | - | 拉 free 审核归台账 | 写台账 |
| `delete [--apply]` | - | 删除过审/被拒副本腾槽 | 默认 dry-run |
| `md5fix` | - | 对待传/重传清单改 MD5 | 写本地 |
| `upload` | - | free 真上传 | 写平台 |
| `hold-submit [--delay-min N]` | - | free 上传后挂起，延迟确认提交 | 写平台 |
| `reconcile [--apply]` | - | 对账幻影上传并 un-bump | 默认 dry-run |
| `prep [--apply]` | - | `sync -> delete -> md5fix` | delete 段默认 dry-run |
| `cycle [--rounds N] [--apply]` | `test-round` | free 多轮收敛 | 写平台 |
| `run` | `flywheel` | free 飞轮 | 写平台 |
| `clear-local [--apply]` | - | 清本地源和 md5fix 孤儿副本 | 默认 dry-run |
| `config get/set ...` | - | 读写配置旋钮 | set 默认 dry-run |
| `supervisor <status|install-token|unlock|lock>` | - | 主管 token 与临时解锁 | 默认 120 分钟，`--all-day` 为 24 小时 |

### 主管级 paid

| 命令 | 别名 | 作用 | 状态 |
|------|------|------|------|
| `ready-paid` | - | 收敛 paid 到上传就绪 | 可用 |
| `open-paid` | - | 启动 paid 调试 Chrome | 可用 |
| `close-paid` | - | 关闭 paid 调试 Chrome | 可用 |
| `whoami-paid` | - | 检查 paid 标签/会话 | 可用 |
| `sync-paid` | - | 拉 paid 审核归台账 | 可用 |
| `upload-paid` | - | paid 真上传 | 可用，真烧钱 |
| `hold-submit-paid [--delay-min N]` | - | paid 上传后挂起，延迟确认提交 | 可用，真烧钱 |
| `reconcile-paid` | - | paid 幻影上传对账 | 可用 |
| `monitor-paid` | - | 录 paid 遥测 | 可用 |
| `monitor-report-paid` | `stats-paid`, `traffic-paid` | 读 paid 遥测报表 | 可用 |
| `run-paid` | - | paid 飞轮 | 可用，真烧钱 |
| `run-both` | - | free + paid 双通道飞轮 | 可用，真烧钱 |
| `cycle-paid` | `deliver-round` | paid 多轮 | 可用，真烧钱 |
| `delete-paid` | `sweep` | paid 腾槽 | 可用，dry-run 默认 |

不新增：`status-paid`、`config-paid`、`prep-paid`、`md5fix-paid`、`passrate-paid`。

---

## 配置与数据

### 入库模板

| 文件 | 作用 |
|------|------|
| `system.example.json` | 机器/项目级配置模板 |
| `channels/jie3.example.json` | free/test 通道模板 |
| `channels/jie6.example.json` | paid/delivery 通道模板 |

### 本机真实文件

| 文件 | 作用 |
|------|------|
| `system.json` | 本机真实路径、关键词、Chrome、ffmpeg、超时、并发 |
| `channels/*.json` | 本机真实通道：aavid、planId、port、role、ui、maxUploads |
| `secrets.json` | 母账号凭据，或用环境变量替代 |
| `_video_state.json` | 机器真源台账，位置由 `system.json.project.ledgerPath` 决定 |

真实配置和凭据不入库。换机器时先跑：

```powershell
node bin/weilai.mjs doctor --fix
```

配置旋钮可以用命令读写，写入默认 dry-run：

```powershell
node bin/weilai.mjs config get system daemon.pollFloorSec
node bin/weilai.mjs config set free maxUploads 7
node bin/weilai.mjs config set free maxUploads 7 --apply
```

中文账户名、中文计划名等不要走命令行，写 JSON。

---

## 安全边界

1. **绝不杀 Chrome**：不要用 `Stop-Process chrome` 或 `taskkill /IM chrome.exe`。只用 `close` / `close-paid`。
2. **先 dry-run 再 apply**：`delete`、`clear-local`、`reconcile` 默认只打印清单。
3. **paid 必须解锁**：任何 paid 操作都要主管 token + session；默认 `supervisor unlock` 120 分钟，长跑用 `--all-day`，跑完可 `supervisor lock`。
4. **命令行保持 ASCII**：中文业务值写 JSON；`inspect <名字>` 是只读例外。
5. **失败靠重跑续跑**：台账是检查点，不要靠手改平台状态“修复”。
6. **挂起提交先小窗口验证**：`hold-submit` 当前按 `--delay-min` 明确延迟，已实测 10 分钟窗口；更长择时窗口要先跑探针。

---

## 开发与验证

语法检查：

```powershell
Get-ChildItem -Recurse -Filter *.mjs | ForEach-Object { node --check $_.FullName }
```

离线测试：

```powershell
node test/cli-behavior-test.mjs
node test/config-test.mjs
node test/sysrepair-test.mjs
node test/reconcile-test.mjs
node test/ledger-concurrency.mjs
node test/leaf-ledger-integration.mjs
node test/render-artifacts-test.mjs
node test/log-file-test.mjs
```

开发约定：

- `bin/weilai.mjs` 的 `COMMANDS` 是命令注册表单一真源。
- `channels/*.json` 是通道事实真源。
- `lib/state.mjs` 是台账状态机。
- 真平台能力必须有 dry-run、主管闸或明确风险边界。
- 手工探针脚本放 `test/manual/`，不参与标准测试。

---

## 项目结构

```
weilai-01/
├── bin/
│   ├── weilai.mjs              # CLI 入口、命令注册表、通道解析、主管闸
│   └── cmds/                   # 子命令
├── lib/                        # CDP、session、guard、state、sync、upload、flywheel 等共享库
├── channels/                   # 通道 example 配置；真实 *.json 本机持有
├── docs/
│   ├── 工程总报告.md           # 当前唯一权威总览
│   ├── PLAN.md                 # 历史设计底稿
│   └── archive/                # 旧日报和参考文档
├── skill/weilai/SKILL.md       # 给 AI/Codex 使用的操作技能说明
├── test/                       # 自动化离线测试
├── test/manual/                # 手工压测/探针脚本
├── system.example.json
├── package.json
└── README.md
```

运行时本机文件：

```
system.json
channels/*.json
secrets.json
logs/
telemetry-out/
```
