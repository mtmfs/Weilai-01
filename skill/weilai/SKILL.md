---
name: weilai
description: 驱动 Weilai-01 CLI 跑千川双通道过审流水线（jie3 海投筛过审 → jie6 投放）。当用户要做这套业务的运营动作——看状态/确保就绪/同步审核/删过审腾槽/改MD5/准备一轮/关浏览器——时用本技能。封装命令选择、安全默认(delete 默认 dry-run)、铁律(绝不杀 chrome)、诚实边界与已知坑恢复。CLI 在 I:\weilai-01。
---

# Weilai-01 —— 千川双通道过审流水线 CLI 操作技能

操作者是业务主管（不写代码），维护是 AI。这个技能让我照规矩、安全地替他驱动 CLI。

**业务**：捷沅3(`jie3`，免费测试号·推商品) 批量传视频筛"审核通过" → 捷沅6(`jie6`，真金~49万·推直播间·投放中) 把过审件搬过去真投放。机器真源是本地双通道台账。

**开工前**：要掌握最新现状，先读 `I:\weilai-01\docs\工作报告-*.md`（最新一份）和 `docs/HANDOFF.md`——代码在演进，以本仓库实况为准，别只依赖本技能的快照。

---

## ⛔ 铁律（每次都守，不可破）

1. **绝不杀 chrome**：禁止 `Stop-Process -Name chrome` / `taskkill /IM chrome.exe`。那会杀光用户**正常浏览器**，且强杀产生 Crashpad 崩溃转储填满 C 盘。要重置调试实例**只用 `weilai close <target>`**（CDP 优雅关、保登录、零转储）。
2. **破坏性默认 dry-run**：`delete` 不加 `--apply` 只打印将删清单。**真删前必须**：先 dry-run 给用户看清单 → 用户确认 → 才 `--apply`。
3. **jie6 = 有钱账户**（投放中~49万）：任何 jie6 动作先确认再做；优先只读。本程实验扰动过 jie6 会话，更要谨慎。
4. **上传还没实现**：`upload`/`submit`/`bump`/`hold-submit` 是桩（抛 `E_NOT_IMPL`，计划②才填）。**别承诺能上传**；`cycle` 要加 `--skip-upload`。
5. **不确定就问，别瞎试**：尤其碰浏览器、碰 jie6、碰删除时。

---

## 怎么跑命令

用 Bash 工具跑：
```
node /i/weilai-01/bin/weilai.mjs <命令> <jie3|jie6> [--json] [--apply] [--skip-upload]
```
- 默认人看输出（中文日志走 stderr）；加 `--json` 出机器结构化输出（取字段时用）。
- argv 只传 ASCII，**绝不传中文参数**（CLI 会拒）。
- 退出码 0=成功；非 0 见末尾对照。

---

## 命令速查 + 何时用

| 命令 | 作用 | 何时用 | 破坏性 |
|---|---|---|---|
| `status [jie3\|jie6\|both]` | 只读台账分阶段汇总 | "看状态/进度" | 无 |
| `ready <t>` | session 收敛到就绪（可自启动） | 碰浏览器前先确保就绪；"打开/准备" | 无(只读+导航) |
| `sync <t>` | 拉平台审核归台账+派生清单 | "同步审核情况/看过了没" | 写台账，不动平台 |
| `delete <t> [--apply]` | 删过审+被拒副本腾槽 | "删掉腾位置" | ⚠️ --apply 才删 |
| `md5fix [t]` | 对待传/重传清单改 MD5 | "改MD5/防去重" | 仅写输出目录 |
| `prep <t> [--apply]` | sync→delete→md5fix | "准备一轮（不含上传）" | delete 段同上 |
| `cycle <t> --skip-upload` | 全骨架空转(ready→sync→delete→md5fix) | "跑一整轮（跳过上传）" | delete 段同上 |
| `monitor <t>` | 旁路遥测录制（常驻不干扰） | "记录/统计用" | 无 |
| `stats <t>` | 读录制出分时段报表 | "出统计" | 无 |
| `close <t>` | 优雅关该实例调试 Chrome | 重置浏览器（替代杀进程） | 无(保登录) |

---

## 运营任务 → 命令映射

- **"看状态/到哪了"** → `status both`（先 sync 再 status 能拿最新平台真相）。
- **"确保就绪 / 打开 jie3"** → `ready jie3`。
- **"同步一下审核过了没"** → `sync jie3`（会更新台账 + 出待重传/待传清单）。
- **"删掉过审的腾位置"** → 先 `delete jie3`（dry-run 看清单）→ 给用户看 → 确认后 `delete jie3 --apply`。
- **"改 MD5"** → `md5fix jie3`（读台账派生清单；磁盘注意：每个~400MB）。
- **"准备/跑一轮"** → `cycle jie3 --skip-upload`（上传那步还没实现）。
- **"关掉浏览器"** → `close jie3`（绝不杀进程）。

---

## 当前能做 / 不能做（诚实边界·2026-06-23）

**能稳定用**（前提：jie3 的 profile 保持登录态）：
- jie3 测试通道的**非上传**操作：`status`/`ready`/`sync`/`delete --dry`/`md5fix`/`cycle --skip-upload`/`close`/`stats`。
- 覆盖流水线前半段"海投筛过审"的日常。

**还不能用**：
- **上传**（upload/submit/bump/hold-submit = 桩，计划②）。
- **jie6 收敛**（冷 profile 登录探测 + 创意tab 未通）。
- **双实例同时跑**（#5，从没真测）。
- 依赖上传的命令：`test-round`/`deliver-round`/`hold-submit`（桩）。

---

## 已知坑 + 恢复

- **`ready` 失败 E_DRIFT/E_SIG（账户=?）**：多半是 session 冷/被弹。先 `close <t>` 再重跑 `ready`（带 3 次重试）。jie3 的 advId 已修，冷会话现也能收敛。
- **jie3 卡在登录（始终 E_DRIFT）**：说明那个 profile **登出了**——当前登录探测在登出 profile 上不触发 login（已知 bug）。处理：请用户用 `! ` 在 9222 手动登录母账号一次，再重跑 `ready`；或等登录链修好。
- **`delete` 报"将删 0"**：可能正常（被拒/过审副本历史轮次已删过），但**此结果尚存疑、未核实**。若用户说"明明还有该删的"，需拉平台数据交叉核对，别当然认为是对的。
- **磁盘**：`md5fix` 全量 97 件≈40GB；分批跑、批间清输出目录。台账盘 H:、输出盘 I: 要有空间。
- **退出码**：0 OK / 10 E_DRIFT(账户漂移) / 11 E_LOGIN / 12 E_SIG(会话冷) / 13 E_ROI / 14 E_SELECTOR(选择器漂移·需我修) / 16 E_FREEZE_SKIP(非致命) / 20 E_CONFIG / 64 E_NOT_IMPL(上传桩) / 2 E_USAGE(传了中文)。

---

## 决策原则

1. **jie3 优先**：jie3 能正常用是硬目标；jie6 后推（除非用户明确要）。
2. **破坏性先 dry-run + 问**：delete/--apply、任何 jie6 写操作，先看清单、先确认。
3. **碰浏览器先 `ready`**：sync/delete 前确保就绪。
4. **报告如实**：失败就贴退出码+日志；没验证过的别说"成功"；不确定标"存疑"。
5. **深挖看文档**：`docs/工作报告-*.md`(现状/已知bug) / `docs/HANDOFF.md`(技术交接) / `docs/PLAN-1-基建.md`·`PLAN-2-上传.md`(设计)。
