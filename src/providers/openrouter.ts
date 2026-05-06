import { httpGetJson } from './http';
import { AdapterResult, BalanceUsage, ProviderEnv, UsageAdapter } from './types';

const ENDPOINT = 'https://openrouter.ai/api/v1/credits';

interface OpenRouterResponse {
  data?: { total_credits?: number; total_usage?: number };
  total_credits?: number;
  total_usage?: number;
}

export function parseOpenRouter(body: unknown): BalanceUsage | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as OpenRouterResponse;
  const inner = r.data ?? r;
  const total = typeof inner.total_credits === 'number' ? inner.total_credits : null;
  const used = typeof inner.total_usage === 'number' ? inner.total_usage : null;
  if (total === null || used === null) return null;
  const remaining = total - used;
  return {
    kind: 'balance',
    remaining,
    total,
    used,
    unit: 'USD',
    planName: 'OpenRouter',
    isValid: remaining > 0,
    invalidMessage: remaining <= 0 ? 'No credits remaining' : undefined,
  };
}

export const openrouterAdapter: UsageAdapter = {
  id: 'openrouter',
  displayName: 'OR',
  matches(env: ProviderEnv): boolean {
    return !!env.baseUrl && env.baseUrl.toLowerCase().includes('openrouter.ai');
  },
  async fetch(env: ProviderEnv): Promise<AdapterResult> {
    if (!env.authToken) return { ok: false, error: 'ANTHROPIC_AUTH_TOKEN not set' };
    const res = await httpGetJson(ENDPOINT, { Authorization: `Bearer ${env.authToken}` });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, error: res.error ?? 'request failed' };
    const data = parseOpenRouter(res.body);
    if (!data) return { ok: false, error: 'invalid response shape' };
    return { ok: true, data };
  },
};
