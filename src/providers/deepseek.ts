import { httpGetJson } from './http';
import { AdapterResult, BalanceUsage, ProviderEnv, UsageAdapter } from './types';

const ENDPOINT = 'https://api.deepseek.com/user/balance';

interface DeepSeekResponse {
  balance_infos?: Array<{ currency?: string; total_balance?: number | string }>;
  is_available?: boolean;
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseDeepSeek(body: unknown): BalanceUsage | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as DeepSeekResponse;
  const infos = r.balance_infos;
  if (!Array.isArray(infos) || infos.length === 0) return null;
  // Prefer CNY, fall back to first entry
  const pick = infos.find((i) => i?.currency === 'CNY') ?? infos[0];
  const balance = toNum(pick?.total_balance);
  if (balance === null) return null;
  const unit = typeof pick?.currency === 'string' ? pick.currency : 'CNY';
  return {
    kind: 'balance',
    remaining: balance,
    unit,
    planName: 'DeepSeek',
    isValid: r.is_available !== false,
  };
}

export const deepseekAdapter: UsageAdapter = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  matches(env: ProviderEnv): boolean {
    return !!env.baseUrl && env.baseUrl.toLowerCase().includes('api.deepseek.com');
  },
  async fetch(env: ProviderEnv): Promise<AdapterResult> {
    if (!env.authToken) return { ok: false, error: 'ANTHROPIC_AUTH_TOKEN not set' };
    const res = await httpGetJson(ENDPOINT, { Authorization: `Bearer ${env.authToken}` });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, error: res.error ?? 'request failed' };
    const data = parseDeepSeek(res.body);
    if (!data) return { ok: false, error: 'invalid response shape' };
    return { ok: true, data };
  },
};
