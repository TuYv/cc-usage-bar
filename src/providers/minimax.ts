import { httpGetJson } from './http';
import { AdapterResult, ProviderEnv, SubscriptionUsage, UsageAdapter } from './types';

interface MinimaxRemains {
  current_interval_total_count?: number;
  current_interval_usage_count?: number;
  end_time?: number; // ms
  current_weekly_total_count?: number;
  current_weekly_usage_count?: number;
  weekly_end_time?: number; // ms
}

interface MinimaxResponse {
  base_resp?: { status_code?: number; status_msg?: string };
  model_remains?: MinimaxRemains[];
}

function tier(total: number | undefined, used: number | undefined, endMs: number | undefined) {
  if (typeof total !== 'number' || typeof used !== 'number' || total <= 0) return undefined;
  return {
    utilization: ((total - (total - used)) / total) * 100, // = used / total * 100
    resets_at: typeof endMs === 'number' ? new Date(endMs).toISOString() : undefined,
  };
}

export function parseMinimax(body: unknown): SubscriptionUsage | { error: string } | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as MinimaxResponse;
  const code = r.base_resp?.status_code;
  if (typeof code === 'number' && code !== 0) {
    return { error: r.base_resp?.status_msg ?? `MiniMax error ${code}` };
  }
  const remains = r.model_remains?.[0];
  if (!remains) return null;
  const out: SubscriptionUsage = { kind: 'subscription', planName: 'MiniMax' };
  const fh = tier(remains.current_interval_total_count, remains.current_interval_usage_count, remains.end_time);
  if (fh) out.five_hour = fh;
  const wk = tier(remains.current_weekly_total_count, remains.current_weekly_usage_count, remains.weekly_end_time);
  if (wk) out.seven_day = wk;
  if (!out.five_hour && !out.seven_day) return null;
  return out;
}

export const minimaxAdapter: UsageAdapter = {
  id: 'minimax',
  displayName: 'MiniMax',
  matches(env: ProviderEnv): boolean {
    if (!env.baseUrl) return false;
    const u = env.baseUrl.toLowerCase();
    return u.includes('minimaxi.com') || u.includes('minimax.io');
  },
  async fetch(env: ProviderEnv): Promise<AdapterResult> {
    if (!env.authToken) return { ok: false, error: 'ANTHROPIC_AUTH_TOKEN not set' };
    const u = env.baseUrl?.toLowerCase() ?? '';
    const domain = u.includes('minimax.io') ? 'api.minimax.io' : 'api.minimaxi.com';
    const url = `https://${domain}/v1/api/openplatform/coding_plan/remains`;
    const res = await httpGetJson(url, {
      Authorization: `Bearer ${env.authToken}`,
      'Content-Type': 'application/json',
    });
    if (res.authFailed) return { ok: false, authFailed: true, error: res.error };
    if (!res.ok || !res.body) return { ok: false, error: res.error ?? 'request failed' };
    const parsed = parseMinimax(res.body);
    if (!parsed) return { ok: false, error: 'invalid response shape' };
    if ('error' in parsed) return { ok: false, error: parsed.error };
    return { ok: true, data: parsed };
  },
};
