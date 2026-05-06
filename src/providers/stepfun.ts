import { httpGetJson } from './http';
import { AdapterResult, BalanceUsage, ProviderEnv, UsageAdapter } from './types';

const ENDPOINT = 'https://api.stepfun.com/v1/accounts';

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseStepFun(body: unknown): BalanceUsage | null {
  if (!body || typeof body !== 'object') return null;
  const balance = toNum((body as Record<string, unknown>).balance);
  if (balance === null) return null;
  return {
    kind: 'balance',
    remaining: balance,
    unit: 'CNY',
    planName: 'StepFun',
    isValid: true,
  };
}

export const stepfunAdapter: UsageAdapter = {
  id: 'stepfun',
  displayName: 'StepFun',
  matches(env: ProviderEnv): boolean {
    if (!env.baseUrl) return false;
    const u = env.baseUrl.toLowerCase();
    return u.includes('api.stepfun.com') || u.includes('api.stepfun.ai');
  },
  async fetch(env: ProviderEnv): Promise<AdapterResult> {
    if (!env.authToken) return { ok: false, error: 'ANTHROPIC_AUTH_TOKEN not set' };
    const res = await httpGetJson(ENDPOINT, { Authorization: `Bearer ${env.authToken}` });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, error: res.error ?? 'request failed' };
    const data = parseStepFun(res.body);
    if (!data) return { ok: false, error: 'invalid response shape' };
    return { ok: true, data };
  },
};
