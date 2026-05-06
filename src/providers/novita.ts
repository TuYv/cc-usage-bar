import { httpGetJson } from './http';
import { AdapterResult, BalanceUsage, ProviderEnv, UsageAdapter } from './types';

const ENDPOINT = 'https://api.novita.ai/v3/user/balance';

interface NovitaResponse {
  availableBalance?: number; // in 0.0001 USD increments
  cashBalance?: number;
  creditLimit?: number;
  outstandingInvoices?: number;
}

export function parseNovita(body: unknown): BalanceUsage | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as NovitaResponse;
  const raw = r.availableBalance;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  const remaining = raw / 10000; // convert to USD
  return {
    kind: 'balance',
    remaining,
    unit: 'USD',
    planName: 'Novita',
    isValid: remaining > 0,
    invalidMessage: remaining <= 0 ? 'No balance remaining' : undefined,
  };
}

export const novitaAdapter: UsageAdapter = {
  id: 'novita',
  displayName: 'Novita',
  matches(env: ProviderEnv): boolean {
    return !!env.baseUrl && env.baseUrl.toLowerCase().includes('api.novita.ai');
  },
  async fetch(env: ProviderEnv): Promise<AdapterResult> {
    if (!env.authToken) return { ok: false, error: 'ANTHROPIC_AUTH_TOKEN not set' };
    const res = await httpGetJson(ENDPOINT, { Authorization: `Bearer ${env.authToken}` });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, error: res.error ?? 'request failed' };
    const data = parseNovita(res.body);
    if (!data) return { ok: false, error: 'invalid response shape' };
    return { ok: true, data };
  },
};
