import { httpGetJson } from './http';
import { AdapterResult, ProviderEnv, SubscriptionUsage, UsageAdapter } from './types';

const ENDPOINT = 'https://api.z.ai/api/monitor/usage/quota/limit';

interface GlmLimit {
  type?: string;
  percentage?: number;
  nextResetTime?: number; // ms
}

interface GlmResponse {
  success?: boolean;
  msg?: string;
  data?: {
    limits?: GlmLimit[];
    level?: string;
  };
}

export function parseGlm(body: unknown): SubscriptionUsage | { error: string } | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as GlmResponse;
  if (r.success === false) return { error: typeof r.msg === 'string' ? r.msg : 'GLM API error' };
  const limits = r.data?.limits;
  if (!Array.isArray(limits)) return null;
  const tokens = limits.find((l) => l && l.type === 'TOKENS_LIMIT');
  if (!tokens || typeof tokens.percentage !== 'number') return null;
  const out: SubscriptionUsage = {
    kind: 'subscription',
    planName: typeof r.data?.level === 'string' ? `GLM ${r.data.level}` : 'GLM',
    five_hour: {
      utilization: tokens.percentage,
      resets_at:
        typeof tokens.nextResetTime === 'number'
          ? new Date(tokens.nextResetTime).toISOString()
          : undefined,
    },
  };
  return out;
}

export const glmAdapter: UsageAdapter = {
  id: 'glm',
  displayName: 'GLM',
  matches(env: ProviderEnv): boolean {
    if (!env.baseUrl) return false;
    const u = env.baseUrl.toLowerCase();
    return u.includes('z.ai') || u.includes('bigmodel.cn');
  },
  async fetch(env: ProviderEnv): Promise<AdapterResult> {
    if (!env.authToken) return { ok: false, error: 'ANTHROPIC_AUTH_TOKEN not set' };
    const res = await httpGetJson(ENDPOINT, {
      Authorization: env.authToken, // NO Bearer prefix (GLM-specific)
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US,en',
    });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, status: res.status, error: res.error ?? 'request failed' };
    const parsed = parseGlm(res.body);
    if (!parsed) return { ok: false, error: 'invalid response shape' };
    if ('error' in parsed) return { ok: false, error: parsed.error };
    return { ok: true, data: parsed };
  },
};
