import { BalanceUsage, NormalizedUsage, SubscriptionTier, SubscriptionUsage } from './providers/types';

export type FormatPreset =
  | 'compact'
  | 'numeric'
  | 'time'
  | 'countdown'
  | 'bar'
  | 'bar-time'
  | 'bar-countdown';

export const FORMAT_PRESETS: FormatPreset[] = [
  'compact',
  'numeric',
  'time',
  'countdown',
  'bar',
  'bar-time',
  'bar-countdown',
];

export type BarSpec =
  | { mode: 'cells'; filled: string; empty: string; width?: number }
  | { mode: 'tint'; text: string; emptyStyle?: 'dim' | 'plain'; style?: 'fg' | 'reverse' }
  | { mode: 'frames'; frames: string[] };

// `ansi` is the resolved escape sequence (or null for "no color in this band").
// Resolved at parse time so the hot render path doesn't re-validate each tick.
export type ColorRule = { min: number; ansi: string | null };
export type ColorRamp = ColorRule[];

export interface FormatOptions {
  format: FormatPreset;
  barWidth: number;
  color: boolean;
  showProviderName: boolean;
  barSpec?: BarSpec;
  template?: string;
  now?: Date;
  colorRamp5h?: ColorRamp;
  colorRampWk?: ColorRamp;
  colorRampBalance?: ColorRamp;
}

const ANSI_RESET = '\x1b[0m';
const ANSI_REVERSE = '\x1b[7m';

export const COLOR_MAP: Record<string, string> = {
  none: '',
  dim: '\x1b[2m',
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  boldRed: '\x1b[1;31m',
  boldGreen: '\x1b[1;32m',
  boldYellow: '\x1b[1;33m',
  boldBlue: '\x1b[1;34m',
  boldMagenta: '\x1b[1;35m',
  boldCyan: '\x1b[1;36m',
  boldWhite: '\x1b[1;37m',
};

export const COLOR_NAMES: string[] = Object.keys(COLOR_MAP);

export const DEFAULT_RAMP: ColorRamp = [
  { min: 0, ansi: COLOR_MAP.green },
  { min: 60, ansi: COLOR_MAP.yellow },
  { min: 85, ansi: COLOR_MAP.red },
];

export const DEFAULT_FORMAT: FormatOptions = {
  format: 'bar-countdown',
  barWidth: 10,
  color: true,
  showProviderName: true,
  colorRamp5h: DEFAULT_RAMP,
  colorRampWk: DEFAULT_RAMP,
  colorRampBalance: DEFAULT_RAMP,
};

const SUB_PRESET_TPL: Record<FormatPreset, string> = {
  compact: '{label} {percent}%',
  numeric: '{percent}%',
  time: '{percent}% until {expiry}',
  countdown: '{percent}% in {countdown}',
  bar: '[{bar}] {percent}%',
  'bar-time': '[{bar}] {percent}% until {expiry}',
  'bar-countdown': '[{bar}] {percent}% in {countdown}',
};

const BAL_PRESET_TPL: Record<FormatPreset, string> = {
  compact: '{amount}',
  numeric: '{amount}',
  time: '{amount}',
  countdown: '{amount}',
  bar: '[{bar}] {amount}',
  'bar-time': '[{bar}] {amount}',
  'bar-countdown': '[{bar}] {amount}',
};

const pad2 = (n: number) => n.toString().padStart(2, '0');

export function formatExpiry(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '?';
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '?';
  const sameDay =
    target.getFullYear() === now.getFullYear() &&
    target.getMonth() === now.getMonth() &&
    target.getDate() === now.getDate();
  if (sameDay) return `${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays >= 0 && diffDays < 7) {
    return `${target.getMonth() + 1}/${target.getDate()} ${pad2(target.getHours())}:${pad2(target.getMinutes())}`;
  }
  return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(target.getDate())}`;
}

export function formatCountdown(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '?';
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '?';
  const secs = Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hrs < 24) return remMin > 0 ? `${hrs}h${remMin}m` : `${hrs}h`;
  const days = Math.floor(hrs / 24);
  const remHr = hrs % 24;
  return remHr > 0 ? `${days}d${remHr}h` : `${days}d`;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

export function parseBarSpec(raw: string | undefined): BarSpec | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.mode === 'cells') {
    if (!isNonEmptyString(obj.filled) || !isNonEmptyString(obj.empty)) return null;
    const out: BarSpec = { mode: 'cells', filled: obj.filled, empty: obj.empty };
    if (typeof obj.width === 'number' && Number.isFinite(obj.width) && obj.width >= 1 && obj.width <= 50) {
      out.width = Math.floor(obj.width);
    }
    return out;
  }
  if (obj.mode === 'tint') {
    if (!isNonEmptyString(obj.text)) return null;
    const out: BarSpec = { mode: 'tint', text: obj.text };
    if (obj.emptyStyle === 'plain' || obj.emptyStyle === 'dim') out.emptyStyle = obj.emptyStyle;
    if (obj.style === 'fg' || obj.style === 'reverse') out.style = obj.style;
    return out;
  }
  if (obj.mode === 'frames') {
    if (!Array.isArray(obj.frames)) return null;
    const frames = obj.frames.filter(isNonEmptyString);
    if (frames.length < 2) return null;
    return { mode: 'frames', frames };
  }
  return null;
}

// Convert "#RGB" or "#RRGGBB" → 24-bit ANSI foreground escape.
// Accepts both shorthand and full hex; case-insensitive.
export function hexToAnsi(hex: string): string | null {
  const m = hex.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  const h = m[1];
  let r: number;
  let g: number;
  let b: number;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return `\x1b[38;2;${r};${g};${b}m`;
}

// Parse color ramp like "0:green,60:#ffaa00,85:red".
// Color tokens may be named (see COLOR_NAMES), 'none', or hex (#RGB / #RRGGBB).
// Each rule's escape is resolved here so render-time lookup is O(1).
// Returns null on malformed input so callers can fall back to defaults.
export function parseColorRamp(spec: string | undefined): ColorRamp | null {
  if (!spec) return null;
  const parts = spec.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const rules: ColorRule[] = [];
  for (const p of parts) {
    const m = p.match(/^(\d+(?:\.\d+)?):(\S+)$/);
    if (!m) return null;
    const min = parseFloat(m[1]);
    const token = m[2];
    let ansi: string | null;
    if (token === 'none') {
      ansi = null;
    } else if (token.startsWith('#')) {
      ansi = hexToAnsi(token);
      if (ansi === null) return null;
    } else if (token in COLOR_MAP) {
      ansi = COLOR_MAP[token] || null;
    } else {
      return null;
    }
    rules.push({ min, ansi });
  }
  rules.sort((a, b) => a.min - b.min);
  return rules;
}

export function colorFromRamp(util: number, ramp: ColorRamp | undefined): string | null {
  if (!ramp || ramp.length === 0) return null;
  let picked: string | null = null;
  for (const r of ramp) {
    if (util >= r.min) picked = r.ansi;
    else break;
  }
  return picked;
}

function splitText(s: string): string[] {
  return Array.from(s);
}

export function formatBar(
  pct: number,
  width = 10,
  spec?: BarSpec,
  activeColor: string | null = null,
  useColor = false
): string {
  const clamped = Math.max(0, Math.min(100, pct));
  if (spec?.mode === 'cells') {
    const specWidth = spec.width ?? width;
    const filled = Math.round((clamped / 100) * specWidth);
    return spec.filled.repeat(filled) + spec.empty.repeat(Math.max(0, specWidth - filled));
  }
  if (spec?.mode === 'tint') {
    const chars = splitText(spec.text);
    const filled = Math.round((clamped / 100) * chars.length);
    const active = chars.slice(0, filled).join('');
    const inactive = chars.slice(filled).join('');
    if (!useColor) return active + inactive;
    const activeStyle = activeColor && spec.style === 'reverse' ? `${activeColor}${ANSI_REVERSE}` : activeColor;
    const activePart = activeStyle && active ? paint(active, activeStyle, true) : active;
    const inactivePart =
      inactive && spec.emptyStyle !== 'plain' ? paint(inactive, COLOR_MAP.dim, true) : inactive;
    return activePart + inactivePart;
  }
  if (spec?.mode === 'frames') {
    const idx = Math.min(spec.frames.length - 1, Math.floor((clamped / 100) * spec.frames.length));
    return spec.frames[idx];
  }
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

function paint(text: string, color: string | null, useColor: boolean): string {
  if (!useColor || !color) return text;
  return `${color}${text}${ANSI_RESET}`;
}

function applyTierPaint(text: string, color: string | null, opts: FormatOptions, tpl: string): string {
  return paint(text, color, opts.color);
}

function applyTintTemplate(tpl: string, vars: Record<string, string>, color: string | null, opts: FormatOptions): string {
  if (!opts.color || !color) return applyTemplate(tpl, vars);
  return tpl
    .split(/(\{bar\})/g)
    .map((part) => (part === '{bar}' ? vars.bar ?? '{bar}' : paint(applyTemplate(part, vars), color, true)))
    .join('');
}

function renderTemplate(tpl: string, vars: Record<string, string>, color: string | null, opts: FormatOptions): string {
  if (opts.barSpec?.mode === 'tint' && tpl.includes('{bar}')) {
    return applyTintTemplate(tpl, vars, color, opts);
  }
  return applyTierPaint(applyTemplate(tpl, vars), color, opts, tpl);
}

function prependProvider(text: string, planName: string | undefined, opts: FormatOptions): string {
  return opts.showProviderName && planName ? `${planName} ${text}` : text;
}

function applyTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? vars[k] : `{${k}}`));
}

export interface TierContext {
  tier: SubscriptionTier;
  label: '5h' | 'Wk';
  provider: string;
}

function renderTier(ctx: TierContext, opts: FormatOptions): string {
  const pct = Math.round(ctx.tier.utilization);
  const tpl = opts.template ?? SUB_PRESET_TPL[opts.format];
  const ramp = ctx.label === '5h' ? opts.colorRamp5h ?? DEFAULT_RAMP : opts.colorRampWk ?? DEFAULT_RAMP;
  const color = colorFromRamp(pct, ramp);
  const vars = {
    label: ctx.label,
    percent: String(pct),
    bar: formatBar(pct, opts.barWidth, opts.barSpec, color, opts.color),
    expiry: formatExpiry(ctx.tier.resets_at, opts.now),
    countdown: formatCountdown(ctx.tier.resets_at, opts.now),
    provider: ctx.provider,
  };
  return renderTemplate(tpl, vars, color, opts);
}

function currencySymbol(unit: string): string {
  switch (unit.toUpperCase()) {
    case 'CNY':
    case 'RMB':
      return '¥';
    case 'USD':
      return '$';
    default:
      return '';
  }
}

function fmtMoney(n: number, unit: string): string {
  const sym = currencySymbol(unit);
  return sym ? `${sym}${n.toFixed(2)}` : `${n.toFixed(2)} ${unit}`;
}

export function renderSubscription(d: SubscriptionUsage, opts: FormatOptions): string {
  const provider = d.planName ?? '';
  const parts: string[] = [];
  if (d.five_hour) parts.push(renderTier({ tier: d.five_hour, label: '5h', provider }, opts));
  if (d.seven_day) parts.push(renderTier({ tier: d.seven_day, label: 'Wk', provider }, opts));
  if (parts.length === 0) return '';
  const sep = opts.format === 'compact' && !opts.template ? ' ' : ' / ';
  return prependProvider(parts.join(sep), d.planName, opts);
}

export function renderBalance(d: BalanceUsage, opts: FormatOptions): string {
  if (d.isValid === false && d.invalidMessage) {
    return prependProvider(paint(d.invalidMessage, COLOR_MAP.red, opts.color), d.planName, opts);
  }
  // No total → progress is meaningless. Force the compact template so a
  // bar-bearing preset doesn't degrade to an empty "[] $34.20".
  if (typeof d.total !== 'number') {
    const tpl = opts.template ?? BAL_PRESET_TPL.compact;
    const vars = {
      label: '', percent: '0', bar: '', expiry: '', countdown: '',
      provider: d.planName ?? '',
      amount: fmtMoney(d.remaining, d.unit),
    };
    return prependProvider(renderTemplate(tpl, vars, null, opts), d.planName, opts);
  }
  const total = d.total;
  const usedPct = total > 0 ? ((total - d.remaining) / total) * 100 : 0;
  const tpl = opts.template ?? BAL_PRESET_TPL[opts.format];
  const color = colorFromRamp(usedPct, opts.colorRampBalance ?? DEFAULT_RAMP);
  const vars = {
    label: '',
    percent: String(Math.round(usedPct)),
    bar: formatBar(usedPct, opts.barWidth, opts.barSpec, color, opts.color),
    expiry: '',
    countdown: '',
    provider: d.planName ?? '',
    amount: `${fmtMoney(d.remaining, d.unit)}/${fmtMoney(total, d.unit)}`,
  };
  return prependProvider(renderTemplate(tpl, vars, color, opts), d.planName, opts);
}

export function renderUsage(data: NormalizedUsage | null | undefined, opts: FormatOptions): string {
  if (!data) return '';
  return data.kind === 'subscription' ? renderSubscription(data, opts) : renderBalance(data, opts);
}

export function isValidPreset(s: string): s is FormatPreset {
  return (FORMAT_PRESETS as string[]).includes(s);
}

export function shouldUseColor(): boolean {
  return !process.env.NO_COLOR;
}
