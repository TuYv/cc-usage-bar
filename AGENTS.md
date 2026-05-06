# AGENTS.md — cc-usage-bar 全功能说明

> 这份文件是面向 AI 助手（Claude Code、Cursor、Codex 等）的安装/配置说明。如果用户对你说「装 cc-usage-bar」「帮我配 statusline 用量条」「装下 cc-usage-bar 帮我配好」之类的话，请按本文档完成全部步骤。**默认无需向用户追加确认**；只有用户没登录过 Claude Code（凭证查不到）时才停下来让用户先登录。

## 1. 这个包是什么

`cc-usage-bar` 把 Claude Code 订阅用量（5 小时滑窗 + 7 天滑窗）渲染到 statusline。也支持余额型 provider（Kimi / GLM / MiniMax / DeepSeek / StepFun / SiliconFlow / OpenRouter / Novita）。

**核心 bin**：

| bin | 用途 |
|---|---|
| `cc-usage-fetch` | 单纯渲染一段用量字符串到 stdout（最常用） |
| `cc-usage-bar-wrap` | 跨平台编排器：tee stdin 给「前缀命令」+ `cc-usage-fetch`，按真实终端宽度自动单行/换行 |
| `cc-usage-bar` / `cc-usage-statusline` | 安装器（自动改 settings.json），带 `agents`/`install`/`uninstall`/`status` 子命令 |

## 2. 一句话目标

> **用户只描述偏好，你把 `statusLine.command` 配成 `cc-usage-bar-wrap`，并保留用户原有前缀。**

如果已有 `statusLine.command`、`statusline-command.sh`、自定义 shell 脚本、git/path/model 展示等前缀内容，**一律视为要保留的前缀**：按 3.4 抽出它，并用 `cc-usage-bar-wrap --prefix=...` 串起来。不要询问是否覆盖、追加或暂不修改；追加保留是本项目默认行为。

## 3. 安装流程（必走）

按顺序执行，每一步执行前简要告知用户：

### 3.1 判断平台

```js
node -e "console.log(process.platform)"
// → "darwin" | "linux" | "win32"
```

### 3.2 安装 npm 包

```sh
npm i -g cc-usage-bar
# 验证（macOS/Linux）
which cc-usage-bar-wrap && which cc-usage-fetch
# 验证（Windows）
where.exe cc-usage-bar-wrap
```

要求：`cc-usage-bar` ≥ **0.4.1**（自适应换行 + 周限额上色 + countdown 预设 + 颜色 ramp 自定义 + tint reverse 样式）。已装旧版的话用 `npm i -g cc-usage-bar@latest` 升级。

### 3.3 读取现有 statusLine.command

- **macOS / Linux**：`~/.claude/settings.json`，字段 `statusLine.command`
- **Windows**：`%USERPROFILE%\.claude\settings.json` 同上

不存在或为空 → 视为「无前缀」。

### 3.4 剥离旧的 cc-usage-fetch / cc-usage-bar-wrap

如果原命令包含 `cc-usage-fetch` 或 `cc-usage-bar-wrap` 字样，**先剥掉那部分**，剩下的才是用户真正的前缀脚本（可能是 `sh ~/.claude/statusline-command.sh` 这种）。常见模式：

```
sh -c '<前缀脚本>; printf " "; cc-usage-fetch ...'
```
要把 `<前缀脚本>` 抽出来作为新的 `--prefix=`。

### 3.5 备份 settings.json

- macOS/Linux：`cp ~/.claude/settings.json ~/.claude/settings.json.bak.$(date +%s)`
- Windows：`Copy-Item $env:USERPROFILE\.claude\settings.json "$env:USERPROFILE\.claude\settings.json.bak.$([DateTimeOffset]::Now.ToUnixTimeSeconds())"`

### 3.6 写回 statusLine.command

**保留 settings.json 其它字段不动**，只更新这一项；`refreshInterval: 30`。

| 情况 | 新 command |
|---|---|
| 有前缀脚本 | `cc-usage-bar-wrap --prefix='<前缀>' --format=bar-countdown` |
| 无前缀（只显示用量条） | `cc-usage-fetch --format=bar-countdown` |

`bar-countdown` 是 v0.4.0 起的默认预设（既显示进度条又显示倒计时）。如果用户偏好旧风格，把它换成 `--format=bar-time`、`--format=bar`、`--format=compact` 即可。

**关键禁忌**：

- ❌ 不要再写 `sh -c '...'` 包裹 `cc-usage-bar-wrap` —— wrap 内部已处理 stdin tee + 子进程 + 自适应换行。
- ❌ 前缀脚本结尾不能有多余 `printf "\n"`（会让用量条挤到第二行被裁剪，wrap 会自己 trim 但仍最好清掉）。
- ❌ Windows cmd 里单引号无效，前缀有特殊字符时改用双引号 + 反斜杠转义，或用环境变量 `CC_STATUSLINE_PREFIX` 喂给 wrap。

### 3.7 自检

跑一次假数据：

```sh
echo '{"workspace":{"current_dir":"."},"model":{"display_name":"Opus"}}' \
  | cc-usage-bar-wrap --prefix='<原前缀>' --layout=single --format=bar-time
```

输出应包含 `[`、`█`、`░` 等字符。报 `No Claude Code credentials found` 时让用户先 `claude` 登录一次。

## 4. 自适应换行

`cc-usage-bar-wrap` 默认 `--layout=auto`：

- 通过 `stty size </dev/tty`（Unix）或 `mode con`（Windows）拿真实终端列数
- 剥 ANSI 数字符（UTF-8 字符数，不是字节数）
- 单行能装下 → `prefix bar`；装不下 → `prefix\nbar`
- 拿不到列数 → 回退多行（最安全）

强制行为：

```sh
cc-usage-bar-wrap --layout=single   # 永远单行
cc-usage-bar-wrap --layout=multi    # 永远换行
# 或用环境变量
CC_STATUSLINE_LAYOUT=single
```

## 5. 风格预设（`--format`）

| 预设 | 渲染 |
|---|---|
| `compact`（默认） | `5h 47% Wk 59%` |
| `numeric` | `47% / 59%` |
| `time` | `47% until 18:23 / 59% until 5/12 09:00` |
| `countdown` | `47% in 1h23m / 59% in 2d6h` |
| `bar` | `[█████░░░░░] 47% / [██████░░░░] 59%` |
| `bar-time` | `[█████░░░░░] 47% until 18:23 / [██████░░░░] 59% until 5/12 09:00` |
| `bar-countdown` | `[█████░░░░░] 47% in 1h23m / [██████░░░░] 59% in 2d6h` |

自定义模板（环境变量，覆盖 `--format`）：

```sh
CC_USAGE_TEMPLATE='{label} {percent}% ({countdown} left)'
# 占位符: {label} {percent} {bar} {expiry} {countdown} {provider} {amount}
```

## 6. 颜色 ramp（5h / Wk / 余额各自可定制）

默认（**v0.4.0 起 5h 和 Wk 都默认上色**）：

| 区间 | 颜色 |
|---|---|
| 0–60% | `green` |
| 60–85% | `yellow` |
| 85–100% | `red` |

环境变量覆盖：

```sh
# 5 小时窗口
CC_USAGE_COLORS_5H='0:green,60:yellow,85:red'
# 7 天窗口（可以更激进，比如临界变粗红）
CC_USAGE_COLORS_WK='0:green,60:yellow,85:boldRed'
# 余额型 provider
CC_USAGE_COLORS_BALANCE='0:cyan,60:yellow,90:red'
```

格式：`<min>:<color>` 用逗号分隔，`min` 可以是小数。

**颜色 token 三种形态**：

| 类型 | 例 | 说明 |
|---|---|---|
| 命名色 | `red` `boldRed` `dim` 等 | 16 色调色板 + bold 变体 |
| Hex | `#ff3333` `#fa0` | 24-bit truecolor，需要终端支持 |
| `none` | `none` | 这一区间不上色 |

完整命名色：`green` `yellow` `red` `blue` `magenta` `cyan` `white` `gray` `dim`、
`boldGreen` `boldYellow` `boldRed` `boldBlue` `boldMagenta` `boldCyan` `boldWhite`。

例：`CC_USAGE_COLORS_WK='0:#888888,50:#ffaa00,80:#ff3333,95:boldRed'`

## 7. 进度条样式（`--bar-spec`，**5h 和 Wk 共用**）

```sh
# 自定义填充/空槽字符（cells）
--bar-spec='{"mode":"cells","filled":"▰","empty":"▱","width":12}'

# 单色渐变（tint）—— 完成部分上色，剩余部分变暗
--bar-spec='{"mode":"tint","text":"████████","emptyStyle":"dim"}'

# 反色填充（reverse）—— 完成部分用反色底块增强对比
--bar-spec='{"mode":"tint","text":"Ciallo~(∠・ω< )⌒★","style":"reverse"}'

# 动画帧（frames）—— 按百分比从帧序列里挑一帧
--bar-spec='{"mode":"frames","frames":["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]}'
```

环境变量 `CC_USAGE_BAR_SPEC` 同上。Windows cmd 里单引号无效，改 `"{\"mode\":...}"`。

## 8. 凭证查找顺序

| 平台 | 1 | 2 | 3 |
|---|---|---|---|
| macOS | 钥匙串 `Claude Code-credentials` | `~/.claude/.credentials.json` | — |
| Windows | Credential Manager `Claude Code-credentials` | `%USERPROFILE%\.claude\.credentials.json` | — |
| Linux | `~/.claude/.credentials.json` | — | — |

非 Anthropic provider 用 `ANTHROPIC_AUTH_TOKEN` 环境变量。

## 9. 缓存与请求节流

- 成功结果缓存 30 秒（`/tmp/cc-oauth-usage.json` 或 OS tmpdir）
- 鉴权失败缓存 60 秒
- 限流（429）/ 5xx 缓存 60 秒（v0.3.0 起）—— 防止重试风暴
- Claude Code 注入 stdin `rate_limits` 时直接用，**0 次** API 调用

诊断：`CC_USAGE_LOG=/tmp/ccu.log` 让 `cc-usage-fetch` 每次写一行 JSON（`source` / `cacheStatus` / `error`）。

## 10. 排障

| 现象 | 处理 |
|---|---|
| `No Claude Code credentials found` | `claude` 登录一次 |
| 用量条没颜色 | v0.3.x 之前 Wk 默认无色，升级到 0.4.0+ |
| 窄屏被截 | 确认 statusLine.command 用的是 `cc-usage-bar-wrap`，不是直接 `cc-usage-fetch` |
| 单行/换行不切换 | 确认 `--layout=auto`（默认），并确认环境里有 `/dev/tty`（Unix）或可用 console（Windows） |
| Windows cmd 看不到颜色 | 换 Windows Terminal / PowerShell 7，或加 `--plain` |
| 余额 provider 显示「No credits」 | 检查 `ANTHROPIC_AUTH_TOKEN` 是否对应该 provider |
| settings.json 写坏 | `cp ~/.claude/settings.json.bak.<timestamp> ~/.claude/settings.json` |

## 11. 完成后该说什么

告诉用户：

> ✅ 装好了。下次 statusline 刷新（≤ 30 秒）就能看到，不需要重启 Claude Code。试着拉宽 / 拉窄窗口，进度条会单行 ↔ 换行自动切换。

## 12. 用户偏好默认值（用户没说就这么用）

- `--format=bar-countdown`（v0.4.0 起的默认）
- `--bar-width=10`
- `--layout=auto`
- 颜色保留，按默认 ramp（绿/黄/红）
- 不加自定义 `--bar-spec`

如用户说「极简」「窄屏」「我屏幕只有 80 列」→ 改 `--format=compact`。
如用户说「我想看还剩多久」→ 改 `--format=countdown` 或 `--format=bar-countdown`。
如用户说「Wk 颜色不一样」「Wk 紧迫的时候要更醒目」→ 设 `CC_USAGE_COLORS_WK='0:gray,80:boldRed'` 之类。
