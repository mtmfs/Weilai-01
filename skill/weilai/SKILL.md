---
name: weilai
description: 驱动 Weilai-01 CLI 跑千川双通道过审流水线（free 免费号海投筛过审 → paid 付费号投放）。当用户要做这套业务的运营动作——看状态/体检/查件/确保就绪/同步审核/删过审腾槽/改MD5/准备一轮/跑飞轮/关浏览器/登录配置/换机器修配置——时用本技能。封装命令选择、安全默认（delete/clear-local 默认 dry-run）、铁律（绝不杀 chrome）、主管级隔离（paid 烧钱通道需解锁）、诚实边界与已知坑恢复。CLI 在 I:\weilai-01。
---

# Weilai-01 — 千川双通道过审流水线 CLI

用调试版 Chrome（走 CDP）自动跑「千川双通道过审流水线」的命令行工具。

操作者是业务主管（不写代码），维护是 AI。这个技能让我照规矩、安全地替他驱动 CLI。

---

## 目录

1. [这套 CLI 是做什么的](#这套-cli-是做什么的)
2. [怎么跑命令](#怎么跑命令)
3. [安全约定（铁律·必须遵守）](#安全约定铁律必须遵守)
4. [命令参考](#命令参考)
5. [运营任务 → 命令](#运营任务--命令)
6. [免费 vs 付费（主管级闸门）](#免费-vs-付费主管级闸门)
7. [当前能做 / 不能做](#当前能做--不能做)
8. [常见问题与排错](#常见问题与排错)
9. [退出码对照](#退出码对照)
10. [决策原则](#决策原则)

---

## 这套 CLI 是做什么的

把视频素材在**免费测试号**刷过审，再搬到**付费投放号**真投放，省审核额度、控风险。

| 通道 | 命令标签 | 内部角色 | 角色 | 花钱 | 端口 |
|------|------|------|------|------|------|
| 测试端 | `free` | `test` | 海投筛「审核通过」 | ❌ 免费 | 见 `channels/*.json` |
| 投放端 | `paid` | `delivery` | 把过审件搬来真投放 | ✅ 真金 | 见 `channels/*.json` |

**流程**：本地视频 →（传 free 跑过审）→ 过审则封存 →（搬到 paid 投放）→ paid 也过审则交付。被拒的改 MD5 重传，传满仍败则作废。

**机器真源** = 本地双通道台账 `_video_state.json`。命令面用 `free`/`paid` 标签；台账内部键来自本机 `channels/*.json`，当前常见为 `jie3`/`jie6`，但不要把它们当命令语法的首选入口。

> **开工前**：先 `doctor` 体检环境，再读 `I:\weilai-01\docs\工程总报告.md`（唯一权威总览，含现状 / 架构 / 已知 bug）。一切以仓库实况为准。

---

## 怎么跑命令

用当前 shell 跑；PowerShell 例子：

```powershell
node I:\weilai-01\bin\weilai.mjs <命令> [--json] [--apply] [--rounds N] [--as free|paid|<id>]
```

- 默认人看输出（中文日志走 stderr）；加 `--json` 出机器结构化输出（stdout 只有 JSON）。
- 退出码 `0`=成功，非 0 见[退出码对照](#退出码对照)。`--help` 看分组命令；`--help-all` 含主管级/隐藏别名。
- 命名规则：**空格=普通参数；横杠=产品化入口/风险边界**。通道绑定命令不接受裸通道参数：不要跑 `ready jie3`、`run paid`、`upload paid`；用裸命令默认 free，或用 `--as free|paid|<id>`，或用 `upload-paid` / `run-paid` 这类后缀命令。
- **长跑（`run` 飞轮）让用户在自己终端跑**：`! node I:\weilai-01\bin\weilai.mjs run`，`!` 前缀在用户会话里跑、免 AI 后台时限。
- **交互式命令（`login`）让用户终端自跑**：AI 驱动会卡在 prompt。

---

## 安全约定（铁律·必须遵守）

1. **绝不杀 chrome**：禁止 `Stop-Process -Name chrome` / `taskkill /IM chrome.exe`——那会杀光用户正常浏览器，且强杀产生 Crashpad 崩溃转储填满 C 盘。重置调试实例**只用 `weilai close`**（free）/ `weilai close-paid` 或 `weilai close --as paid`（paid·需解锁）。
2. **破坏性操作默认 dry-run**：`delete` / `clear-local` 不加 `--apply` 只打印将做清单。**真删前必须**：先 dry-run 给用户看 → 用户确认 → 才 `--apply`。
3. **paid = 真实花钱通道**：主管级、默认锁定。任何 paid 动作先确认、优先只读；**绝不擅自 `supervisor unlock` 跑 paid**，必须用户明确要求。
4. **命令行只用 ASCII**：中文（账户名/计划）写进 `channels/*.json` 或走 `login`；通道优先用 `free`/`paid` 标签，内部 id 仅在确有需要时用。**例外**：`inspect <名字>` 的搜索词可中文（只读台账，不碰平台）。
5. **不确定就问，别瞎试**：尤其碰浏览器、碰 paid、碰删除时。

---

## 命令参考

> 裸命令默认 **free**（免费测试号，安全）。付费命令为主管级，见[免费 vs 付费](#免费-vs-付费主管级闸门)。

### 看 / 体检（只读）

| 命令 | 别名 | 作用 |
|------|------|------|
| `doctor [--fix]` | preflight | 环境自检：磁盘/ffmpeg/chrome/端口/台账/通道。`--fix` 探测修补 system.json（写本地 +.bak） |
| `status [both\|free\|paid]` | st | 台账分阶段/分通道汇总 |
| `inspect <名字片段>` | show, find | 查名字含某串的视频在台账状态（搜索词可中文） |
| `scan` | ps | 扫各通道调试 Chrome 在不在跑 + aavid 标签是否在位 |
| `whoami` | — | 检查通道标签/会话（账户名探针已禁用，不回填 account） |
| `monitor` / `monitor-report` | stats, traffic | 旁路录制网络请求 / 读录制出分时段报表 |
| `passrate` | — | 分时段过审率 + 建议提交时段 |

### 会话 / 浏览器

| 命令 | 作用 |
|------|------|
| `open` | 只启动 Chrome 实例、不收敛（`ready` 挂了的逃生口） |
| `ready` | session 收敛到上传就绪（可自启 Chrome）。碰浏览器前先确保就绪 |
| `close` | 优雅关该通道调试 Chrome（CDP 优雅关、保登录、零转储） |
| `login` | 交互式录入端口/凭据/双通道标识（让用户终端自跑 `! node …login`） |

### 流水线 / 编排

| 命令 | 别名 | 作用 | 破坏性 |
|------|------|------|--------|
| `sync` | — | 拉平台审核归台账 | 写台账 |
| `delete [--apply]` | — | 删过审 + 被拒副本腾槽 | ⚠️ `--apply` 才删 |
| `md5fix` | — | 对待传/重传清单改 MD5（绕去重·纯本地） | 写 I:\ |
| `upload` | — | 真上传（注入 → 提交 → 记账） | ⚠️ 真写平台 |
| `reconcile [--apply]` | — | 对账 un-bump 幻影上传 | ⚠️ `--apply` 才改台账 |
| `prep [--apply]` | — | sync→delete→md5fix（备料不传） | delete 段同上 |
| `cycle [--rounds N] [--apply]` | test-round | 免费多轮收敛（轮间不死等） | ⚠️ 含真上传 |
| `run` | flywheel | **免费飞轮**（异步连续·日常主力） | ⚠️ 含真上传 |
| `clear-local [--apply]` | — | 清本地源 + md5fix 孤儿副本 | ⚠️ `--apply` 才删 |
| `config get/set ...` | — | 读/改配置旋钮（set 默认 dry-run，`--apply` 落盘） | 写本地 |

### 主管级（需主管 token + `supervisor unlock` 解锁）

| 命令 | 别名 | 作用 | 状态 |
|------|------|------|------|
| `ready-paid` / `open-paid` / `close-paid` / `whoami-paid` | — | paid 会话入口（收敛/开/关/标签检查） | ✅ ⚠️💰 |
| `sync-paid` / `reconcile-paid` | — | paid 同步审核 / 幻影上传对账 | ✅ ⚠️💰 |
| `upload-paid` | — | paid 真上传（注入 → 提交 → 记账） | ✅ ⚠️💰 真烧钱 |
| `monitor-paid` / `monitor-report-paid` | stats-paid, traffic-paid | paid 遥测录制 / 报表 | ✅ ⚠️💰 |
| `run-paid` / `run-both` | — | 付费 / free+paid 双通道飞轮 | ✅ ⚠️💰 真烧钱 |
| `cycle-paid` | deliver-round | 付费多轮 | ✅ ⚠️💰 |
| `delete-paid` | sweep | 付费腾槽 | ✅ ⚠️💰 dry-run 默认 |

---

## 运营任务 → 命令

- **"环境/出问题了 / 换机器"** → `doctor`（开工先体检）；换机器加 `doctor --fix` 自动修配置。
- **"看状态/到哪了"** → 先 `sync` 再 `status`（拿最新平台真相）。
- **"查某人/某件"** → `inspect 张晟钰`。
- **"浏览器开着没 / 标签在不在"** → `scan`；**"当前通道标签是否就位"** → `whoami`。账户名不再由 CLI 探测/回填。
- **"确保就绪 / 打开"** → `ready`（收敛挂了用 `open` 手动开）。
- **"同步审核过了没"** → `sync`。
- **"删掉过审的腾位置"** → `delete`（dry-run 看清单）→ 给用户看 → 确认后 `delete --apply`。
- **"改 MD5"** → `md5fix`（每件约 400MB，注意磁盘）。
- **"持续跑 / 挂着自动跑"** → `run`（免费飞轮，日常主力；长跑让用户 `! node …run` 自跑）。
- **"关掉浏览器"** → `close`（绝不杀进程）。
- **"配置 / 换号"** → 让用户终端自跑 `! node …login`（交互式）。
- **付费投放**（谨慎·主管级）→ 用户明确要求才 `supervisor unlock`（默认 120 分钟；长跑可 `--all-day`）+ 按场景用 `upload-paid` / `run-paid` / `run-both`。

---

## 免费 vs 付费（主管级闸门）

裸命令默认走 **free**（免费测试通道），日常主力、安全。碰 **paid**（真实花钱通道）的命令是主管级、默认锁定：

- 常用 paid 包装命令：`ready-paid/open-paid/close-paid/whoami-paid/sync-paid/upload-paid/reconcile-paid/monitor-paid/monitor-report-paid/run-paid/run-both/cycle-paid/delete-paid`；支持通道绑定的命令也可加 `--as paid`；
- 都需先安装主管 token，再 `supervisor unlock` 解锁；默认 120 分钟，长跑可 `supervisor unlock --all-day` 解锁 24 小时；
- **绝不擅自解锁**，必须用户明确要投放。

`status paid`、`config get paid ...` 这类 raw 参数命令保持空格写法，不支持 `--as`；`scan`、`inspect`、`clear-local` 这类无通道命令也不支持 `--as`。不新增 `status-paid/config-paid/prep-paid/md5fix-paid/passrate-paid`。`free`/`paid` 只是命令面标签，台账内部键来自本机 `channels/*.json`（当前常见为 `jie3`/`jie6`）。

---

## 当前能做 / 不能做

**能稳定用**（前提：free 的 profile 保持登录态）：

- free 测试通道**非上传 + 上传**全流水线：`doctor`/`status`/`inspect`/`scan`/`whoami`/`open`/`ready`/`sync`/`delete`（默认 dry-run）/`md5fix`/`upload`/`hold-submit`/`cycle`/`run`/`clear-local`/`close`/`monitor`/`passrate`。
- `run`（免费飞轮）是日常主力：跨 tick 不死等、md5fix 并行、自适应退避。

**还不能用 / 半残**：

- **paid 仍需谨慎**：`delete-paid` 已支持 creative-tab 腾槽；冷 profile 登录链仍有 bug（靠暖 profile）。`upload-paid`/`run-paid`/`run-both` 机制打通，但长时无人值守未验证。
- `hold-submit` 已转正为显式延迟提交（`--delay-min`，默认 10）；只实测过 10 分钟窗口，更长择时窗口先跑探针。
- `login` 只写端口/凭据/aavid/planId/maxUploads 等配置，不再探测或回填账户名；冷登录失败时配置仍保存，后续用 `scan`/`whoami` 确认标签。

---

## 常见问题与排错

#### Q1：`ready` 失败，报 E_DRIFT / E_SIG

**原因**：多半 session 冷 / 被弹。

**解决**：先 `close` 再重跑 `ready`（带 3 次重试）。若 profile 已登出 → 当前冷登录探测有 bug，请用户手动登录母账号一次再重跑。

#### Q2：`run-paid` / `--as paid` / 任何 paid 命令被拒

**原因**：正常——付费号是主管级。

**解决**：用户明确要投放时，先 `supervisor unlock`；长跑用 `supervisor unlock --all-day`。否则用 `run`（仅免费）。

#### Q3：`delete` 报"将删 0"

**原因**：可能正常（历史轮次已删过，平台无 live 副本可删）。

**解决**：此结果尚存疑——用户说"明明还有"时，拉平台交叉核对。

#### Q4：换机器 / 换盘符后跑不起来

**原因**：`system.json` 里的绝对路径（flatRoot / 台账 / chrome / ffmpeg / md5fix 输出）指向旧机器。

**解决**：跑 `doctor --fix`——自动探测回填 chrome/ffmpeg、补 md5fix 缺省；机器私有数据路径它不猜，会打印精确的 `config set system <key> "X:\..." --apply` 让你逐条改。改完再 `doctor` 复检全 ✓。注意 Chrome 调试 profile 的登录态绑在原盘，换机要重新 `ready` 登录（冷登录有 bug，见 Q1）。

#### Q5：长跑（飞轮）停了，想知道为什么

**解决**：`run`/`run-paid`/`run-both` 默认把带时间戳的运行日志落 `I:\weilai-01\logs\run-<日期>.log`（控制台照常）。飞轮停了 / 熔断 / 挂了，去这里翻原因。`WEILAI_LOG_FILE` 环境变量可改路径。

#### Q6：磁盘 / 端口

- **磁盘**：`md5fix` 全量约 40GB，分批跑、批间 `clear-local --apply` 清孤儿。台账盘 H:、输出盘 I: 要有空间，`doctor` 会报余量。
- **端口**：以 `channels/*.json` 为准（`login` 可改）。`scan` 报端口占用 / 缺目标标签。

---

## 退出码对照

| 码 | 名 | 含义 |
|----|----|------|
| 0 | OK | 成功 |
| 2 | E_USAGE | 用法错（传了中文 / 主管未解锁） |
| 10 | E_DRIFT | aavid/计划/会话漂移 |
| 11 | E_LOGIN | 掉登录 |
| 12 | E_SIG | 会话冷 / 签名失效 |
| 14 | E_SELECTOR | 选择器漂移（需人修） |
| 16 | E_FREEZE_SKIP | 上传冻结跳过（非致命） |
| 20 | E_CONFIG | 配置/环境错（如缺 md5fix） |
| 64 | E_NOT_IMPL | 未实现命令 |

---

## 决策原则

1. **free 优先**：free 日常用是硬目标；paid 后推（除非用户明确要、且主管解锁）。
2. **破坏性先 dry-run + 问**：delete/clear-local 的 `--apply`、任何 paid 写操作，先看清单、先确认。
3. **碰浏览器先 `doctor`/`ready`**：sync/delete/upload 前确保环境 + 就绪。
4. **报告如实**：失败就贴退出码 + 日志；没验证过的别说"成功"；不确定标"存疑"。
5. **深挖看文档**：`docs/工程总报告.md`（唯一权威总览·现状/架构/已知bug/路线）。
