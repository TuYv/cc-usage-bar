import { BalanceUsage, NormalizedUsage, SubscriptionTier, SubscriptionUsage } from './providers/types';

export type FormatPreset = 'compact' | 'numeric' | 'time' | 'bar' | 'bar-time';

export const FORMAT_PRESETS: FormatPreset[] = ['compact', 'numeric', 'time', 'bar', 'bar-time'];

export type BarSpec =
  | { mode: 'cells'; filled: string; empty: string; width?: number }
  | { mode: 'tint'; text: string; emptyStyle?: 'dim' | 'plain' }
  | { mode: 'frames'; frames: string[] };

export interface FormatOptions {
  format: FormatPreset;
  barWidth: number;
  color: boolean;
  showProviderName: boolean;
  barSpec?: BarSpec;
  template?: string; // overrides format if set
  now?: Date; // injectable for tests
}

export const DEFAULT_FORMAT: FormatOptions = {
  format: 'compact',
  barWidth: 10,
  color: true,
  showProviderName: true,
};

const SUB_PRESET_TPL: Record<FormatPreset, string> = {
  compact: '{label} {percent}%',
  numeric: '{percent}%',
  time: '{percent}% until {expiry}',
  bar: '[{bar}] {percent}%',
  'bar-time': '[{bar}] {percent}% until {expiry}',
};

const BAL_PRESET_TPL: Record<FormatPreset, string> = {
  compact: '{amount}',
  numeric: '{amount}',
  time: '{amount}',
  bar: '[{bar}] {amount}',
  'bar-time': '[{bar}] {amount}',
};

const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  boldRed: '\x1b[1;31m',
} as const;

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
    const activePart = activeColor && active ? paint(active, activeColor, true) : active;
    const inactivePart =
      inactive && spec.emptyStyle !== 'plain' ? paint(inactive, ANSI.dim, true) : inactive;
    return activePart + inactivePart;
  }
  if (spec?.mode === 'frames') {
    const idx = Math.min(spec.frames.length - 1, Math.floor((clamped / 100) * spec.frames.length));
    return spec.frames[idx];
  }
  const filled = Math.round((clamped / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

function fiveHourColor(util: number): string | null {
  if (util < 60) return ANSI.green;
  if (util < 85) return ANSI.yellow;
  return ANSI.red;
}

function weekColor(util: number): string | null {
  return util >= 80 ? ANSI.boldRed : null;
}

function paint(text: string, color: string | null, useColor: boolean): string {
  if (!useColor || !color) return text;
  return `${color}${text}${ANSI.reset}`;
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
  const color = ctx.label === '5h' ? fiveHourColor(pct) : weekColor(pct);
  const text = applyTemplate(tpl, {
    label: ctx.label,
    percent: String(pct),
    bar: formatBar(pct, opts.barWidth, opts.barSpec, color, opts.color),
    expiry: formatExpiry(ctx.tier.resets_at, opts.now),
    provider: ctx.provider,
  });
  if (opts.barSpec?.mode === 'tint' && opts.color && tpl.includes('{bar}')) return text;
  return paint(text, color, opts.color);
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
  const body = parts.join(sep);
  return opts.showProviderName && d.planName ? `${d.planName} ${body}` : body;
}

export function renderBalance(d: BalanceUsage, opts: FormatOptions): string {
  if (d.isValid === false && d.invalidMessage) {
    const msg = paint(d.invalidMessage, ANSI.red, opts.color);
    return opts.showProviderName && d.planName ? `${d.planName} ${msg}` : msg;
  }
  const amount =
    typeof d.total === 'number'
      ? `${fmtMoney(d.remaining, d.unit)}/${fmtMoney(d.total, d.unit)}`
      : fmtMoney(d.remaining, d.unit);
  const usedPct = typeof d.total === 'number' && d.total > 0
    ? ((d.total - d.remaining) / d.total) * 100
    : 0;
  const tpl = opts.template ?? BAL_PRESET_TPL[opts.format];
  const color = typeof d.total === 'number' ? fiveHourColor(usedPct) : null;
  const text = applyTemplate(tpl, {
    label: '',
    percent: String(Math.round(usedPct)),
    bar: typeof d.total === 'number' ? formatBar(usedPct, opts.barWidth, opts.barSpec, color, opts.color) : '',
    expiry: '',
    provider: d.planName ?? '',
    amount,
  });
  if (opts.barSpec?.mode === 'tint' && opts.color && tpl.includes('{bar}')) {
    return opts.showProviderName && d.planName ? `${d.planName} ${text}` : text;
  }
  const colored = paint(text, color, opts.color);
  return opts.showProviderName && d.planName ? `${d.planName} ${colored}` : colored;
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
