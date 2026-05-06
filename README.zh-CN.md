# 中文说明

[English](README.md)

`cc-usage-bar` 可以把 Claude Code 的订阅用量显示在底部 statusline。它支持官方 Anthropic 订阅，也支持 Kimi、GLM/Zhipu、MiniMax、DeepSeek、StepFun、SiliconFlow、OpenRouter、Novita 等替代 provider。

默认效果：

```text
5h 47% Wk 59%
```

进度条 + 重置时间：

```text
[█████░░░░░] 47% until 18:00 / [██████░░░░] 59% until 5/9 09:00
```

## 安装

```bash
npm install -g cc-usage-bar
cc-usage-bar install
```

然后重启 Claude Code。

卸载：

```bash
cc-usage-bar uninstall
```

安装时会备份原来的 `~/.claude/settings.json`。如果你已经有自己的 statusline 命令，本工具会包装它，不会直接覆盖。

## 工作原理

Claude Code 的 statusline 本质上是一条 shell 命令，命令的 stdout 会显示在 TUI 底部。本项目提供这些命令：

- `cc-usage-fetch`：输出一行 statusline 文本，默认由 Claude Code 每 30 秒调用一次。
- `cc-usage-bar`：安装器，把 `cc-usage-fetch` 写入 `~/.claude/settings.json` 的 `statusLine.command`。
- `cc-usage-statusline`：`cc-usage-bar` 的兼容别名。

`cc-usage-fetch` 会按下面顺序获取数据：

1. **stdin `rate_limits`**：Claude Code 会把订阅用户的 `rate_limits` 传给 statusline，无需鉴权、无需网络。
2. **本地缓存**：`/tmp/cc-oauth-usage.json`，成功缓存 30 秒，鉴权失败缓存 60 秒。
3. **Provider HTTP 查询**：根据 `ANTHROPIC_BASE_URL` 自动选择 provider。Anthropic 会读取 macOS keychain 或 `~/.claude/.credentials.json`；其他 provider 使用环境变量 `ANTHROPIC_AUTH_TOKEN`。

## 支持的 Provider

Provider 通过 `ANTHROPIC_BASE_URL` 判断。

| 类型 | Provider | URL 关键词 |
|---|---|---|
| 订阅用量 | Anthropic | `anthropic.com` 或不设置 |
| 订阅用量 | Kimi | `api.kimi.com` |
| 订阅用量 | GLM / 智谱 | `z.ai`, `bigmodel.cn` |
| 订阅用量 | MiniMax | `minimaxi.com`, `minimax.io` |
| 余额 | DeepSeek | `api.deepseek.com` |
| 余额 | StepFun | `api.stepfun.com`, `api.stepfun.ai` |
| 余额 | SiliconFlow | `api.siliconflow.cn`, `api.siliconflow.com` |
| 余额 | OpenRouter | `openrouter.ai` |
| 余额 | Novita | `api.novita.ai` |

订阅模式显示 `5h X% Wk Y%`。余额模式显示 `¥34.20` 或 `$5.88/$10.00`。未知 provider 会输出空字符串，不会污染 statusline。

## 显示格式

```bash
cc-usage-bar install --format <preset> --bar-width <n>
```

| 预设 | 输出示例 |
|---|---|
| `compact` 默认 | `5h 47% Wk 59%` |
| `numeric` | `47% / 59%` |
| `time` | `47% until 18:00 / 59% until 5/9 09:00` |
| `bar` | `[█████░░░░░] 47% / [██████░░░░] 59%` |
| `bar-time` | `[█████░░░░░] 47% until 18:00 / [██████░░░░] 59% until 5/9 09:00` |

时间使用本地时区，并做智能缩短：当天显示 `HH:MM`，一周内显示 `M/D HH:MM`，更久显示 `YYYY-MM-DD`。

颜色规则：5 小时窗口低于 60% 为绿色，低于 85% 为黄色，85% 及以上为红色；周用量 80% 及以上为加粗红色。设置 `NO_COLOR=1` 可以关闭颜色。

### 自定义模板

如果想完全控制文本，可以在 `~/.claude/settings.json` 的 `env` 里设置 `CC_USAGE_TEMPLATE`：

```json
{
  "env": {
    "CC_USAGE_TEMPLATE": "{label}={percent}% ({expiry})"
  }
}
```

可用占位符：`{label}`、`{percent}`、`{bar}`、`{expiry}`、`{provider}`、`{amount}`。

### 自定义进度条

本项目提供一个适合 AI 使用的轻量入口：`--bar-spec` 或 `CC_USAGE_BAR_SPEC`。

工具本身不会调用 AI，也不会解析图片；它只负责渲染 JSON。你可以让自己的 AI 助手把图片、短语、主题转换成下面几种 spec。

#### tint：整段文字始终可见

推荐给颜文字、短句、logo 风格文本。已完成部分会染色，未完成部分会变暗，但整段文字一直可见：

```bash
cc-usage-bar install --format=bar-time \
  --bar-spec='{"mode":"tint","text":"Ciallo～(∠・ω< )⌒★"}'
```

```json
{"mode":"tint","text":"Ciallo～(∠・ω< )⌒★"}
```

#### cells：替换默认块字符

```json
{"mode":"cells","filled":"●","empty":"○","width":10}
```

#### frames：按百分比选择阶段文本

```json
{"mode":"frames","frames":["(・_・)","(・ω・)","(∠・ω< )","Ciallo～(∠・ω< )⌒★"]}
```

可以直接把下面这段发给你的 AI 助手：

```text
请把这张图片、这句话或这个主题转换成 cc-usage-bar 的 bar spec。
只返回一个 JSON 对象，mode 使用 "tint"、"cells" 或 "frames"。
短语、颜文字、logo、装饰文本优先使用 "tint"，因为它会让整段文字始终可见，只按进度染色。
输出必须是单行、终端友好、适合放进 --bar-spec 的 JSON。
```

### 手动编辑 statusline

安装命令只是写入 `settings.json`，你可以手动调整：

```json
"statusLine": {
  "type": "command",
  "command": "cc-usage-fetch --format=bar-time --bar-width=15",
  "refreshInterval": 30
}
```

## 诊断

```bash
cc-usage-bar status
```

会显示当前 provider、数据来源、缓存状态、5 小时 / 7 天重置倒计时，或余额详情。该命令会跳过缓存，适合排查问题。

示例：

```text
provider:      anthropic
source:        api
cache status:  miss
base url:      <not set, defaults to anthropic>
5-hour:        47% (resets in 3h 19m)
7-day:         59% (resets in 9h 39m)
```

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| statusline 为空 | 免费用户没有 stdin `rate_limits`，也没有可用 token；或 provider 未识别 | 运行 `cc-usage-bar status`，检查 `ANTHROPIC_BASE_URL` |
| `unauthorized (401)` | OAuth token 过期，或 `ANTHROPIC_AUTH_TOKEN` 错误 | Anthropic 重新运行 `claude` 登录；其他 provider 更新 token |
| statusline 显示旧数据 | 成功结果有 30 秒缓存 | 等待，或删除 `/tmp/cc-oauth-usage.json` |
| 进度条显示成 `??` | 终端字体不支持 Unicode 块字符 | 使用 `--format=numeric`，或换支持 Unicode 的字体 |

## 隐私与 API 稳定性

Anthropic 订阅用量依赖未公开接口 `/api/oauth/usage`，并会从本机 macOS keychain 或 `~/.claude/.credentials.json` 读取 Claude Code OAuth token。这些接口可能变化。

Token 只在你的机器上读取，不会上传到本项目的任何服务。工具只会请求你配置的 provider。使用 stdin `rate_limits` 时不需要网络。

非 Anthropic provider 也是同样逻辑：`ANTHROPIC_AUTH_TOKEN` 只会发送给对应 provider 的余额或用量接口。

## 为什么不依赖 jq / curl

这个工具是纯 Node.js 实现，Node 18+ 自带 `fetch`，只在 macOS 读取 keychain 时使用 `child_process`。安装后直接可用，不需要额外安装 `jq` 或 `curl`。

## 致谢

Provider 适配逻辑，包括接口地址、响应解析和 OAuth token 发现流程，参考并移植自 [cc-switch](https://github.com/farion1231/cc-switch) 的 Rust 实现（`src-tauri/src/services/{subscription,coding_plan,balance}.rs`）。感谢该项目对国内 provider 集成的逆向和维护。

## License

MIT
