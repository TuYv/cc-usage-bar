import { httpGetJson } from './http';
import { AdapterResult, BalanceUsage, ProviderEnv, UsageAdapter } from './types';

interface SiliconFlowResponse {
  code?: number;
  data?: {
    totalBalance?: number | string;
    balance?: number;
    chargeBalance?: number;
    status?: string;
  };
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseSiliconFlow(body: unknown): BalanceUsage | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as SiliconFlowResponse;
  const balance = toNum(r.data?.totalBalance);
  if (balance === null) return null;
  return {
    kind: 'balance',
    remaining: balance,
    unit: 'CNY',
    planName: 'SiliconFlow',
    isValid: true,
  };
}

export const siliconflowAdapter: UsageAdapter = {
  id: 'siliconflow',
  displayName: 'SF',
  matches(env: ProviderEnv): boolean {
    if (!env.baseUrl) return false;
    const u = env.baseUrl.toLowerCase();
    return u.includes('api.siliconflow.cn') || u.includes('api.siliconflow.com');
  },
  async fetch(env: ProviderEnv): Promise<AdapterResult> {
    if (!env.authToken) return { ok: false, error: 'ANTHROPIC_AUTH_TOKEN not set' };
    const u = env.baseUrl?.toLowerCase() ?? '';
    const domain = u.includes('siliconflow.com') ? 'api.siliconflow.com' : 'api.siliconflow.cn';
    const url = `https://${domain}/v1/user/info`;
    const res = await httpGetJson(url, { Authorization: `Bearer ${env.authToken}` });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, status: res.status, error: res.error ?? 'request failed' };
    const data = parseSiliconFlow(res.body);
    if (!data) return { ok: false, error: 'invalid response shape' };
    return { ok: true, data };
  },
};
