import { httpGetJson } from './http';
import { AdapterResult, ProviderEnv, SubscriptionUsage, UsageAdapter } from './types';

const ENDPOINT = 'https://api.kimi.com/coding/v1/usages';

interface KimiTier {
  limit?: number;
  remaining?: number;
  resetTime?: string | number;
}

interface KimiResponse {
  limits?: Array<{ detail?: KimiTier }>;
  usage?: KimiTier;
}

function toIso(t: unknown): string | undefined {
  if (typeof t === 'number' && Number.isFinite(t)) {
    // could be ms or seconds; >1e12 → ms
    const ms = t > 1e12 ? t : t * 1000;
    return new Date(ms).toISOString();
  }
  if (typeof t === 'string' && t) return t;
  return undefined;
}

function tierFrom(t: KimiTier | undefined) {
  if (!t || typeof t.limit !== 'number' || typeof t.remaining !== 'number' || t.limit <= 0) return undefined;
  const utilization = ((t.limit - t.remaining) / t.limit) * 100;
  return { utilization, resets_at: toIso(t.resetTime) };
}

export function parseKimi(body: unknown): SubscriptionUsage | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as KimiResponse;
  const out: SubscriptionUsage = { kind: 'subscription', planName: 'Kimi' };
  const fhDetail = Array.isArray(r.limits) && r.limits.length > 0 ? r.limits[0]?.detail : undefined;
  const fh = tierFrom(fhDetail);
  if (fh) out.five_hour = fh;
  const wk = tierFrom(r.usage);
  if (wk) out.seven_day = wk;
  if (!out.five_hour && !out.seven_day) return null;
  return out;
}

export const kimiAdapter: UsageAdapter = {
  id: 'kimi',
  displayName: 'Kimi',
  matches(env: ProviderEnv): boolean {
    return !!env.baseUrl && env.baseUrl.toLowerCase().includes('api.kimi.com');
  },
  async fetch(env: ProviderEnv): Promise<AdapterResult> {
    if (!env.authToken) return { ok: false, error: 'ANTHROPIC_AUTH_TOKEN not set' };
    const res = await httpGetJson(ENDPOINT, { Authorization: `Bearer ${env.authToken}` });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, status: res.status, error: res.error ?? 'request failed' };
    const data = parseKimi(res.body);
    if (!data) return { ok: false, error: 'invalid response shape' };
    return { ok: true, data };
  },
};
