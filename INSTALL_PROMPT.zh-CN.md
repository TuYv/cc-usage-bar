# 给朋友发的「一句话」安装提示词

> **复制下面这段发给朋友。他粘到 Claude Code 对话框里就行。**

---

## 一句话版（推荐）

> 帮我装下 cc-usage-bar：先 `npm i -g cc-usage-bar@latest`，再跑 `cc-usage-bar agents` 把里面的步骤一次执行完。我用 macOS / Linux / Windows 都行，按你检测到的平台分叉即可。默认 `bar-countdown` 预设、`auto` 换行、默认配色都行；如果有现有的 statusline 前缀脚本要保留它。

---

## 极简版（朋友想问得更少）

> 装 cc-usage-bar，用 `cc-usage-bar agents` 看说明书然后照办。

---

## 它会自动做什么

朋友的 Claude Code 收到这句话后：

1. `npm i -g cc-usage-bar@latest`（≥ 0.4.1）
2. `cc-usage-bar agents` 拉到完整说明（macOS / Linux / Windows、备份、tee stdin、自适应换行、颜色 ramp、自定义进度条、凭证排障、Windows Credential Manager 全部覆盖）
3. 读朋友现有 `statusLine.command`，剥离旧的 `cc-usage-fetch`、保留前缀脚本
4. 写新命令：`cc-usage-bar-wrap --prefix='<前缀>' --format=bar-time`
5. 自检 + 提醒下次刷新（≤30s）生效

不需要重启 Claude Code。

---

## 朋友想换风格再发一句

| 想法 | 一句话给 AI |
|---|---|
| 想看绝对时间（默认是倒计时） | 改成 `--format=bar-time` |
| 想用 hex 自定义颜色 | 设 `CC_USAGE_COLORS_WK='0:#888,80:#ff3333'` |
| 屏幕窄想极简 | 改成 `--format=compact` |
| Wk 紧迫时要刺眼 | 设环境变量 `CC_USAGE_COLORS_WK='0:gray,80:boldRed'` |
| 想用渐变色块当进度条 | 加 `--bar-spec='{"mode":"tint","text":"████████"}'` |
| 自定义文案想要明显底色 | 加 `--bar-spec='{"mode":"tint","text":"Ciallo~","style":"reverse"}'` |
| 强制单行（窄屏接受截断） | 加 `--layout=single` |

更全的可能性看 `cc-usage-bar agents` 输出的第 5/6/7 节。
