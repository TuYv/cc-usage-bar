// Thin compatibility shim. Real rendering lives in src/format.ts.
import { NormalizedUsage, SubscriptionUsage } from './providers/types';
import {
  renderUsage,
  DEFAULT_FORMAT,
  FormatOptions,
  shouldUseColor,
} from './format';

export interface UsageWindow {
  utilization?: number;
  resets_at?: string;
}
export interface UsageData {
  five_hour?: UsageWindow;
  seven_day?: UsageWindow;
}

export interface RenderOptions {
  color: boolean;
  showProviderName?: boolean;
}

function toFormatOptions(opts: RenderOptions): FormatOptions {
  return {
    ...DEFAULT_FORMAT,
    color: opts.color,
    showProviderName: opts.showProviderName ?? false,
  };
}

// Legacy render kept for the stdin path which still produces { five_hour, seven_day }.
export function render(
  data: UsageData | null | undefined,
  opts: RenderOptions = { color: true }
): string {
  if (!data) return '';
  const sub: SubscriptionUsage = { kind: 'subscription' };
  if (typeof data.five_hour?.utilization === 'number') {
    sub.five_hour = { utilization: data.five_hour.utilization, resets_at: data.five_hour.resets_at };
  }
  if (typeof data.seven_day?.utilization === 'number') {
    sub.seven_day = { utilization: data.seven_day.utilization, resets_at: data.seven_day.resets_at };
  }
  return renderUsage(sub, toFormatOptions(opts));
}

export function renderNormalized(
  data: NormalizedUsage | null | undefined,
  opts: Partial<FormatOptions> = {}
): string {
  return renderUsage(data, { ...DEFAULT_FORMAT, ...opts });
}

export { shouldUseColor };
