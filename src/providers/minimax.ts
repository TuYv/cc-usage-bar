import { httpGetJson } from './http';
import { AdapterResult, ProviderEnv, SubscriptionUsage, UsageAdapter } from './types';

interface MinimaxRemains {
  model_name?: string;
  // Newer schema: REMAINING percent (0-100), not counts. used% = 100 - remaining.
  current_interval_remaining_percent?: number;
  current_weekly_remaining_percent?: number;
  // Weekly bucket only exists when status === 1 (3 = plan has no weekly cap).
  current_weekly_status?: number;
  end_time?: number; // ms — 5h window reset
  weekly_end_time?: number; // ms — weekly window reset
}

interface MinimaxResponse {
  base_resp?: { status_code?: number; status_msg?: string };
  model_remains?: MinimaxRemains[];
}

function isoFromMs(ms: number | undefined): string | undefined {
  return typeof ms === 'number' ? new Date(ms).toISOString() : undefined;
}

export function parseMinimax(body: unknown): SubscriptionUsage | { error: string } | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as MinimaxResponse;
  const code = r.base_resp?.status_code;
  if (typeof code === 'number' && code !== 0) {
    return { error: r.base_resp?.status_msg ?? `MiniMax error ${code}` };
  }
  if (!Array.isArray(r.model_remains)) return null;
  // Only the "general" model carries the coding-plan quota; skip "video" etc.
  const item = r.model_remains.find((m) => m && m.model_name === 'general');
  if (!item) return null;

  const out: SubscriptionUsage = { kind: 'subscription', planName: 'MiniMax' };
  const fhRemain = item.current_interval_remaining_percent;
  if (typeof fhRemain === 'number') {
    out.five_hour = { utilization: 100 - fhRemain, resets_at: isoFromMs(item.end_time) };
  }
  // Weekly tier is real only when status === 1; otherwise remaining_percent is meaningless.
  if (item.current_weekly_status === 1) {
    const wkRemain = item.current_weekly_remaining_percent;
    if (typeof wkRemain === 'number') {
      out.seven_day = { utilization: 100 - wkRemain, resets_at: isoFromMs(item.weekly_end_time) };
    }
  }
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
    if (!res.ok || !res.body) return { ok: false, status: res.status, error: res.error ?? 'request failed' };
    const parsed = parseMinimax(res.body);
    if (!parsed) return { ok: false, error: 'invalid response shape' };
    if ('error' in parsed) return { ok: false, error: parsed.error };
    return { ok: true, data: parsed };
  },
};
