import { getToken } from '../token';
import { httpGetJson } from './http';
import {
  AdapterResult,
  ProviderEnv,
  ScopedTier,
  SubscriptionUsage,
  UsageAdapter,
} from './types';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const BETA = 'oauth-2025-04-20';

interface ApiTier {
  utilization?: number;
  resets_at?: string;
}

interface ApiLimit {
  kind?: string;
  percent?: number;
  resets_at?: string | null;
  scope?: { model?: { display_name?: string | null } | null } | null;
}

interface ApiResponse {
  five_hour?: ApiTier;
  seven_day?: ApiTier;
  limits?: ApiLimit[];
}

// Model-scoped weekly quotas (e.g. Fable) only exist inside the `limits`
// array, as weekly_scoped entries carrying the model's display_name. The
// session / weekly_all entries duplicate five_hour / seven_day and have no
// model scope, so filtering on display_name skips them.
function parseScopedLimits(limits: unknown): ScopedTier[] {
  if (!Array.isArray(limits)) return [];
  const out: ScopedTier[] = [];
  for (const l of limits as ApiLimit[]) {
    if (!l || typeof l !== 'object') continue;
    const label = l.scope?.model?.display_name;
    if (typeof label !== 'string' || !label) continue;
    if (typeof l.percent !== 'number' || !Number.isFinite(l.percent)) continue;
    out.push({
      label,
      utilization: l.percent,
      resets_at: typeof l.resets_at === 'string' ? l.resets_at : undefined,
    });
  }
  return out;
}

export function parseAnthropic(body: unknown): SubscriptionUsage | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as ApiResponse;
  const out: SubscriptionUsage = { kind: 'subscription' };
  if (typeof r.five_hour?.utilization === 'number') {
    out.five_hour = {
      utilization: r.five_hour.utilization,
      resets_at: typeof r.five_hour.resets_at === 'string' ? r.five_hour.resets_at : undefined,
    };
  }
  if (typeof r.seven_day?.utilization === 'number') {
    out.seven_day = {
      utilization: r.seven_day.utilization,
      resets_at: typeof r.seven_day.resets_at === 'string' ? r.seven_day.resets_at : undefined,
    };
  }
  const scoped = parseScopedLimits(r.limits);
  if (scoped.length > 0) out.scoped = scoped;
  if (!out.five_hour && !out.seven_day && !out.scoped) return null;
  return out;
}

export const anthropicAdapter: UsageAdapter = {
  id: 'anthropic',
  displayName: 'Anthropic',
  matches(env: ProviderEnv): boolean {
    if (!env.baseUrl) return true;
    return env.baseUrl.toLowerCase().includes('anthropic.com');
  },
  async fetch(): Promise<AdapterResult> {
    const tk = getToken();
    if (!tk.token) return { ok: false, error: tk.error };
    const res = await httpGetJson<ApiResponse>(ENDPOINT, {
      Authorization: `Bearer ${tk.token}`,
      'anthropic-beta': BETA,
    });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, status: res.status, error: res.error ?? 'request failed' };
    const data = parseAnthropic(res.body);
    if (!data) return { ok: false, error: 'invalid response shape' };
    return { ok: true, data };
  },
};
