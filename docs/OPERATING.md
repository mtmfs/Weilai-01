# 操作手册（OPERATING）

> 给操作者（业务主管，不写代码）。两条铁律：**破坏性操作默认 dry-run**；**失败就重跑同一条命令**（会自动跳过已完成的，台账即检查点）。

## 只读看现状
```bash
node bin/weilai.mjs status            # 台账分阶段 + 双通道汇总
node bin/weilai.mjs status --json     # 机器可读
```

## 一轮测试通道（jie3）  —— 免费筛过审
1. `weilai ready jie3` —— 把浏览器从任意页面收敛到「上传就绪」。
2. `weilai prep jie3 --dry-run` —— 打印将删除/改MD5/上传的清单，**不动平台**。
3. 核对无误 → `weilai prep jie3 --apply`。
4. `weilai upload jie3` —— 注入 + 提交 + 记账（逐文件超时，不被龟速件拖死）。
5. 审核是异步的（数小时）。过段时间重跑 `weilai status jie3` 看落定；没过的再起一轮。

## 一轮投放通道（jie6）  —— 真金投放
```bash
weilai deliver-round jie6     # ready + 取已过审(sealed) + 上传到捷沅6
# 审核等待 …
weilai sweep jie6             # 删过审 + 被拒副本
```

## 全局编排
```bash
weilai cycle wei-6-18 --channel both
```
多轮自动跑，轮间审核等待会停下来等你（人在环上）。

## 出错了怎么办
- **任何命令失败 → 先重跑同一条**（幂等、自动续跑）。
- 看到 `[E_xxx]` 或退出码 → 查 `RECOVERY.md` 对照动作。
- 弹窗 / 慢传 / 账户漂移由内部 `guard` 自动处理；万一漂到错账户，命令会**停**（不会误删有钱的捷沅6）。
- 需要你亲自在终端登录之类（如 `gh auth login`），在对话里用 `! <命令>` 直接跑。

## 注意
- 命令行只用 ASCII（jie3 / jie6 / wei-6-18）；中文都在 `targets/*.json` 和 `system.json` 里，别在命令行敲中文（会被拒，防编码坑）。
- 删除不可逆（删的是创意，投放学习数据清零）。dry-run 先看清单再 `--apply`。
