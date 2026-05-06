import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderNormalized, shouldUseColor, UsageData } from './render';
import { selectAdapter, getEnv } from './providers/registry';
import { NormalizedUsage, SubscriptionUsage } from './providers/types';
import {
  DEFAULT_FORMAT,
  FORMAT_PRESETS,
  FormatOptions,
  isValidPreset,
  parseBarSpec,
  parseColorRamp,
} from './format';

const CACHE_PATH = path.join(os.tmpdir(), 'cc-oauth-usage.json');
const SUCCESS_TTL_MS = 30_000;
const AUTH_FAIL_TTL_MS = 60_000;
const TRANSIENT_FAIL_TTL_MS = 60_000;
const STDIN_TIMEOUT_MS = 500;

type CacheStatusValue = 'ok' | 'auth_failed' | 'rate_limited';

interface CacheEntry {
  fetched_at: number;
  status: CacheStatusValue;
  adapter_id: string;
  data: NormalizedUsage | null;
  error?: string;
}

// ---------- stdin path (Anthropic only) ----------

export async function readStdinJson(timeoutMs = STDIN_TIMEOUT_MS): Promise<unknown | null> {
  if (process.stdin.isTTY) return null;
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let resolved = false;
    const finish = (val: unknown | null) => {
      if (resolved) return;
      resolved = true;
      resolve(val);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    process.stdin.on('data', (c) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return finish(null);
      try {
        finish(JSON.parse(raw));
      } catch {
        finish(null);
      }
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      finish(null);
    });
  });
}

function normalizeStdinTier(t: unknown) {
  if (!t || typeof t !== 'object') return null;
  const obj = t as Record<string, unknown>;
  const pct = obj.used_percentage;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  const out: { utilization: number; resets_at?: string } = { utilization: pct };
  const r = obj.resets_at;
  if (typeof r === 'number' && Number.isFinite(r)) {
    out.resets_at = new Date(r * 1000).toISOString();
  } else if (typeof r === 'string' && r) {
    out.resets_at = r;
  }
  return out;
}

export function extractFromStdin(json: unknown): UsageData | null {
  if (!json || typeof json !== 'object') return null;
  const rl = (json as Record<string, unknown>).rate_limits;
  if (!rl || typeof rl !== 'object') return null;
  const obj = rl as Record<string, unknown>;
  const result: UsageData = {};
  const fh = normalizeStdinTier(obj.five_hour);
  if (fh) result.five_hour = fh;
  const sd = normalizeStdinTier(obj.seven_day);
  if (sd) result.seven_day = sd;
  return Object.keys(result).length > 0 ? result : null;
}

function stdinAsSubscription(d: UsageData | null): SubscriptionUsage | null {
  if (!d) return null;
  const out: SubscriptionUsage = { kind: 'subscription' };
  if (typeof d.five_hour?.utilization === 'number') {
    out.five_hour = { utilization: d.five_hour.utilization, resets_at: d.five_hour.resets_at };
  }
  if (typeof d.seven_day?.utilization === 'number') {
    out.seven_day = { utilization: d.seven_day.utilization, resets_at: d.seven_day.resets_at };
  }
  return out;
}

// ---------- cache ----------

function readCache(): CacheEntry | null {
  try {
    const raw = fs.readFileSync(CACHE_PATH, 'utf8');
    const p = JSON.parse(raw) as CacheEntry;
    if (typeof p.fetched_at !== 'number' || !p.status || !p.adapter_id) return null;
    return p;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(entry));
  } catch {
    // best effort
  }
}

function isCacheFresh(entry: CacheEntry): boolean {
  const age = Date.now() - entry.fetched_at;
  if (age < 0) return false;
  if (entry.status === 'ok') return age < SUCCESS_TTL_MS;
  if (entry.status === 'auth_failed') return age < AUTH_FAIL_TTL_MS;
  if (entry.status === 'rate_limited') return age < TRANSIENT_FAIL_TTL_MS;
  return false;
}

// ---------- orchestration ----------

export type RunSource = 'stdin' | 'cache' | 'api' | 'none';
export type CacheStatusReport =
  | 'hit'
  | 'miss'
  | 'expired'
  | 'auth_failed_cached'
  | 'rate_limited_cached'
  | 'skipped'
  | 'adapter_changed';

export interface RunResult {
  data: NormalizedUsage | null;
  source: RunSource;
  adapterId: string | null;
  cacheStatus: CacheStatusReport;
  authFailed: boolean;
  error?: string;
}

export interface RunOptions {
  forceFresh?: boolean;
  skipStdin?: boolean;
  // Pre-parsed Claude Code statusline JSON. When provided, run() uses this
  // instead of reading process.stdin (so a parent like wrap.ts can read stdin
  // once and feed both the prefix subprocess and run() concurrently).
  stdinJson?: unknown;
}

export async function run(opts: RunOptions = {}): Promise<RunResult> {
  // 1. stdin (Claude Code official rate_limits — Anthropic-only)
  if (!opts.skipStdin) {
    const stdinJson = opts.stdinJson !== undefined ? opts.stdinJson : await readStdinJson();
    const fromStdin = stdinAsSubscription(extractFromStdin(stdinJson));
    if (fromStdin) {
      return {
        data: fromStdin,
        source: 'stdin',
        adapterId: 'anthropic',
        cacheStatus: 'skipped',
        authFailed: false,
      };
    }
  }

  const env = getEnv();
  const adapter = selectAdapter(env);
  if (!adapter) {
    return {
      data: null,
      source: 'none',
      adapterId: null,
      cacheStatus: 'miss',
      authFailed: false,
      error: `unsupported provider for ${env.baseUrl ?? '<no base url>'}`,
    };
  }

  // 2. cache (per-adapter)
  const cache = opts.forceFresh ? null : readCache();
  if (cache && cache.adapter_id === adapter.id && isCacheFresh(cache)) {
    let cacheStatusReport: CacheStatusReport = 'hit';
    if (cache.status === 'auth_failed') cacheStatusReport = 'auth_failed_cached';
    else if (cache.status === 'rate_limited') cacheStatusReport = 'rate_limited_cached';
    return {
      data: cache.data,
      source: 'cache',
      adapterId: adapter.id,
      cacheStatus: cacheStatusReport,
      authFailed: cache.status === 'auth_failed',
      error: cache.error,
    };
  }
  const cacheStatusOnMiss: CacheStatusReport =
    cache && cache.adapter_id !== adapter.id ? 'adapter_changed' : cache ? 'expired' : 'miss';

  // 3. live query via adapter
  const result = await adapter.fetch(env);
  if (result.ok && result.data) {
    writeCache({ fetched_at: Date.now(), status: 'ok', adapter_id: adapter.id, data: result.data });
    return {
      data: result.data,
      source: 'api',
      adapterId: adapter.id,
      cacheStatus: cacheStatusOnMiss,
      authFailed: false,
    };
  }
  if (result.authFailed) {
    writeCache({
      fetched_at: Date.now(),
      status: 'auth_failed',
      adapter_id: adapter.id,
      data: null,
      error: result.error,
    });
    return {
      data: null,
      source: 'api',
      adapterId: adapter.id,
      cacheStatus: cacheStatusOnMiss,
      authFailed: true,
      error: result.error,
    };
  }
  // Only cache real upstream backoff signals (429 + 5xx). Local errors —
  // missing credentials, unset env, parse failures — leave the cache empty so
  // the next 30s tick retries immediately once the user fixes the cause.
  const httpStatus = result.status ?? 0;
  const isTransientHttp = httpStatus === 429 || (httpStatus >= 500 && httpStatus < 600);
  if (isTransientHttp) {
    writeCache({
      fetched_at: Date.now(),
      status: 'rate_limited',
      adapter_id: adapter.id,
      data: null,
      error: result.error,
    });
  }
  return {
    data: null,
    source: 'api',
    adapterId: adapter.id,
    cacheStatus: cacheStatusOnMiss,
    authFailed: false,
    error: result.error,
  };
}

function logEvent(event: Record<string, unknown>): void {
  const target = process.env.CC_USAGE_LOG;
  if (!target) return;
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, ...event }) + '\n';
    fs.appendFileSync(target, line);
  } catch {
    // best effort — never let logging break the statusline
  }
}

export function parseArg(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

const HELP = `cc-usage-fetch — emit one statusline string from Claude Code subscription data.

Usage: cc-usage-fetch [options]

Output:
  --json                Emit raw JSON (data + meta) instead of rendered string
  --plain               Drop ANSI colors
  --no-stdin            Skip reading rate_limits from stdin (force live query)

Format:
  --format=<preset>     ${FORMAT_PRESETS.join(' | ')}   (default: compact)
  --bar-width=<N>       Bar width for bar / bar-time presets (default: 10)
  --bar-spec=<json>     Custom bar JSON: cells, tint, or frames

Custom template (env, overrides --format):
  CC_USAGE_TEMPLATE     e.g. '{label} {percent}% ({expiry})'
                        placeholders: {label} {percent} {bar} {expiry} {provider} {amount}
  CC_USAGE_BAR_SPEC     Same JSON shape as --bar-spec

Presets render like:
  compact         5h 47% Wk 59%
  numeric         47% / 59%
  time            47% until 18:23 / 59% until 5/12 09:00
  countdown       47% in 1h23m / 59% in 2d6h
  bar             [█████░░░░░] 47% / [██████░░░░] 59%
  bar-time        [█████░░░░░] 47% until 18:23 / [██████░░░░] 59% until 5/12 09:00
  bar-countdown   [█████░░░░░] 47% in 1h23m / [██████░░░░] 59% in 2d6h

Per-tier color ramps (override defaults — comma-separated "<min>:<color>"):
  CC_USAGE_COLORS_5H        e.g. '0:green,60:yellow,85:#ff3333'
  CC_USAGE_COLORS_WK        e.g. '0:#888,60:#ffaa00,85:boldRed'
  CC_USAGE_COLORS_BALANCE   used by balance providers (DeepSeek/OpenRouter/...)
  Color tokens:
    - named:  green/yellow/red/blue/magenta/cyan/white/gray/dim,
              boldGreen/boldYellow/boldRed/boldBlue/boldMagenta/boldCyan/boldWhite
    - hex:    '#RRGGBB' or '#RGB' (24-bit truecolor; needs a truecolor terminal)
    - 'none': skip color in that band

Other:
  NO_COLOR=1            Force-disable colors
  CC_USAGE_LOG=<path>   Append one JSON line per invocation (source / cacheStatus / error) for diagnosing call frequency
  --help                Show this message
`;

export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  const wantJson = args.includes('--json');
  const wantPlain = args.includes('--plain');
  const skipStdin = args.includes('--no-stdin');

  const formatArg = parseArg(args, 'format');
  const barWidthArg = parseArg(args, 'bar-width');
  const barSpecArg = parseArg(args, 'bar-spec');
  const templateEnv = process.env.CC_USAGE_TEMPLATE;
  const barSpecEnv = process.env.CC_USAGE_BAR_SPEC;

  const fmt: FormatOptions = { ...DEFAULT_FORMAT };
  if (formatArg && isValidPreset(formatArg)) fmt.format = formatArg;
  if (barWidthArg) {
    const n = parseInt(barWidthArg, 10);
    if (Number.isFinite(n) && n > 0 && n <= 50) fmt.barWidth = n;
  }
  if (templateEnv) fmt.template = templateEnv;
  const barSpec = parseBarSpec(barSpecArg ?? barSpecEnv);
  if (barSpec) fmt.barSpec = barSpec;
  const RAMP_ENV: Array<['colorRamp5h' | 'colorRampWk' | 'colorRampBalance', string]> = [
    ['colorRamp5h', 'CC_USAGE_COLORS_5H'],
    ['colorRampWk', 'CC_USAGE_COLORS_WK'],
    ['colorRampBalance', 'CC_USAGE_COLORS_BALANCE'],
  ];
  for (const [key, envName] of RAMP_ENV) {
    const ramp = parseColorRamp(process.env[envName]);
    if (ramp) fmt[key] = ramp;
  }

  const result = await run({ skipStdin });

  logEvent({
    source: result.source,
    cacheStatus: result.cacheStatus,
    adapterId: result.adapterId,
    authFailed: result.authFailed,
    error: result.error ?? null,
  });

  if (wantJson) {
    process.stdout.write(
      JSON.stringify(
        {
          data: result.data,
          source: result.source,
          adapterId: result.adapterId,
          cacheStatus: result.cacheStatus,
          authFailed: result.authFailed,
          error: result.error ?? null,
        },
        null,
        2
      ) + '\n'
    );
    return;
  }

  fmt.color = !wantPlain && shouldUseColor();
  fmt.showProviderName = result.adapterId !== null && result.adapterId !== 'anthropic';
  const out = renderNormalized(result.data, fmt);
  if (out) process.stdout.write(out);
}
