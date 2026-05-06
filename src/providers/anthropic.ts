import { getToken } from '../token';
import { httpGetJson } from './http';
import {
  AdapterResult,
  ProviderEnv,
  SubscriptionUsage,
  UsageAdapter,
} from './types';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const BETA = 'oauth-2025-04-20';

interface ApiTier {
  utilization?: number;
  resets_at?: string;
}

interface ApiResponse {
  five_hour?: ApiTier;
  seven_day?: ApiTier;
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
  if (!out.five_hour && !out.seven_day) return null;
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
    if (!res.ok || !res.body) return { ok: false, error: res.error ?? 'request failed' };
    const data = parseAnthropic(res.body);
    if (!data) return { ok: false, error: 'invalid response shape' };
    return { ok: true, data };
  },
};
