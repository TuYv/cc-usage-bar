# cc-usage-bar

[中文说明](README.zh-CN.md)

Show your Claude Code subscription usage in the statusline. Works with the official Anthropic subscription and 8 alternative providers (Kimi, GLM/Zhipu, MiniMax, DeepSeek, StepFun, SiliconFlow, OpenRouter, Novita).

```
5h 47% Wk 59%
```

Or, with `--format=bar-time`:

```
[█████░░░░░] 47% until 18:00 / [██████░░░░] 59% until 5/9 09:00
```

## Install

```bash
npm install -g cc-usage-bar
cc-usage-bar install
```

Restart Claude Code. That's it.

To uninstall:

```bash
cc-usage-bar uninstall
```

The original `~/.claude/settings.json` is restored from a timestamped backup.

## How it works

A Claude Code statusline is just a shell command — its stdout is rendered to the bottom of the TUI. This package ships these binaries:

- `cc-usage-fetch` — emits one statusline string. Called by Claude Code 30 s by default.
- `cc-usage-bar` — installer. Wires `cc-usage-fetch` into `~/.claude/settings.json`'s `statusLine.command`. If you already have a statusline command, it's wrapped, not replaced.
- `cc-usage-statusline` — compatibility alias for `cc-usage-bar`.

`cc-usage-fetch` resolves usage data via three fallbacks, in order:

1. **stdin `rate_limits`** — Claude Code now passes a `rate_limits` object to statusline stdin when you're a Claude.ai subscriber. Zero auth, zero network.
2. **Local cache** — `/tmp/cc-oauth-usage.json`, 30 s TTL on success, 60 s on auth failure (so a stale token doesn't hammer the API).
3. **Provider HTTP query** — picked from `ANTHROPIC_BASE_URL`. For Anthropic, the OAuth token is read from your macOS keychain (or `~/.claude/.credentials.json`). For the rest, `ANTHROPIC_AUTH_TOKEN` from the env.

## Supported providers

Provider detection runs against `ANTHROPIC_BASE_URL` (set by Claude Code from `settings.json` `env`, or by tools like cc-switch).

| Type | Provider | Detected URL substring |
|---|---|---|
| Subscription (5h + 7d sliding window) | Anthropic | `anthropic.com` (or unset) |
| Subscription | Kimi | `api.kimi.com` |
| Subscription | GLM (Zhipu) | `z.ai`, `bigmodel.cn` |
| Subscription | MiniMax | `minimaxi.com`, `minimax.io` |
| Balance | DeepSeek | `api.deepseek.com` |
| Balance | StepFun | `api.stepfun.com`, `api.stepfun.ai` |
| Balance | SiliconFlow | `api.siliconflow.cn`, `api.siliconflow.com` |
| Balance | OpenRouter | `openrouter.ai` |
| Balance | Novita | `api.novita.ai` |

Subscription mode renders `5h X% Wk Y%`. Balance mode renders `¥34.20` or `$5.88/$10.00`. Unknown providers render nothing (no error in the statusline).

## Render presets

```bash
cc-usage-bar install --format <preset> --bar-width <n>
```

| Preset | Output |
|---|---|
| `compact` (default) | `5h 47% Wk 59%` |
| `numeric` | `47% / 59%` |
| `time` | `47% until 18:00 / 59% until 5/9 09:00` |
| `bar` | `[█████░░░░░] 47% / [██████░░░░] 59%` |
| `bar-time` | `[█████░░░░░] 47% until 18:00 / [██████░░░░] 59% until 5/9 09:00` |

**Time format is local-timezone, smart-truncated**: same day → `HH:MM`, within a week → `M/D HH:MM`, further → `YYYY-MM-DD`.

**Color thresholds**: 5h window — green <60%, yellow <85%, red ≥85%. Weekly — bold red ≥80%. Set `NO_COLOR=1` to disable.

### Custom template

For full control, set `CC_USAGE_TEMPLATE` in `~/.claude/settings.json` `env`. It overrides `--format`.

```json
{
  "env": {
    "CC_USAGE_TEMPLATE": "{label}={percent}% ({expiry})"
  }
}
```

Placeholders: `{label}` (5h / Wk) · `{percent}` · `{bar}` · `{expiry}` · `{provider}` · `{amount}` (balance only).

### Custom progress bar

For AI-assisted personalization, pass one compact JSON object as `--bar-spec` or `CC_USAGE_BAR_SPEC`.
The tool does not call AI or parse images itself; it only renders the JSON spec. Ask your AI assistant to convert an image, phrase, or theme into one of these shapes:

```bash
cc-usage-bar install --format=bar-time \
  --bar-spec='{"mode":"tint","text":"Ciallo～(∠・ω< )⌒★"}'
```

`tint` keeps the whole text visible and colors the completed prefix while dimming the rest:

```json
{"mode":"tint","text":"Ciallo～(∠・ω< )⌒★"}
```

`cells` replaces the default block characters:

```json
{"mode":"cells","filled":"●","empty":"○","width":10}
```

`frames` selects one text frame based on usage percentage:

```json
{"mode":"frames","frames":["(・_・)","(・ω・)","(∠・ω< )","Ciallo～(∠・ω< )⌒★"]}
```

Suggested prompt for your AI assistant:

```text
Convert this image or phrase into a cc-usage-bar bar spec.
Return only one JSON object using mode "tint", "cells", or "frames".
Prefer "tint" for phrases, faces, logos, and decorative text.
Keep it single-line and terminal-friendly.
```

### Manually editing the statusline

Install just writes a command into `settings.json`. Edit it freely:

```json
"statusLine": {
  "type": "command",
  "command": "cc-usage-fetch --format=bar-time --bar-width=15",
  "refreshInterval": 30
}
```

## Diagnostics

```bash
cc-usage-bar status
```

Shows current provider, source (stdin / cache / api), 5h + 7d countdowns or balance breakdown. Bypasses the cache for accurate readings.

```
provider:      anthropic
source:        api
cache status:  miss
base url:      <not set, defaults to anthropic>
5-hour:        47% (resets in 3h 19m)
7-day:         59% (resets in 9h 39m)
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Statusline blank | Free tier (no `rate_limits` in stdin) and no Anthropic token, or unknown provider | Run `cc-usage-bar status`; check `ANTHROPIC_BASE_URL` |
| `unauthorized (401)` in `status` | OAuth token expired or wrong `ANTHROPIC_AUTH_TOKEN` | Re-login: `claude` (Anthropic), or update token in cc-switch / settings.json |
| Statusline shows old data | 30 s success cache | Wait, or `rm /tmp/cc-oauth-usage.json` |
| Bar chars look like `??` | Terminal can't render Unicode block elements (U+2588, U+2591) | Use `--format=numeric` or set a Unicode-capable font |

## Privacy & API stability

This tool calls **two undocumented Anthropic endpoints**: `/api/oauth/usage` (subscription quota) and reads OAuth tokens from the local macOS keychain. The `cc-switch` project (Tauri/Rust) has used the same approach in production for months. **Both endpoints may change without notice** — open an issue if you see a regression.

Tokens are read **only on your machine**. Nothing is uploaded anywhere. The tool makes one HTTPS request per refresh interval to the provider you've configured (or zero, when `rate_limits` is in stdin).

For non-Anthropic providers, the same is true: the API key from `ANTHROPIC_AUTH_TOKEN` is sent only to the provider's published balance/quota endpoint.

## Why no `jq` / `curl` dependency?

Other statusline tools (e.g. `ccusage`) shell out to `jq` and `curl`. This one is pure Node.js (built-in `fetch` from Node 18+, `child_process` for the macOS keychain only). One `npm install -g` and you're done — no system tooling required.

## Acknowledgements

The provider adapter logic — endpoints, response parsing, the OAuth token discovery dance — is a Node port of [cc-switch](https://github.com/farion1231/cc-switch)'s Rust implementation (`src-tauri/src/services/{subscription,coding_plan,balance}.rs`). Thanks to that project for reverse-engineering and maintaining the Chinese-provider integrations.

## License

MIT
