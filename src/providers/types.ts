export interface ProviderEnv {
  baseUrl?: string;
  authToken?: string;
}

export interface SubscriptionTier {
  utilization: number; // 0-100
  resets_at?: string; // ISO 8601
}

export interface SubscriptionUsage {
  kind: 'subscription';
  five_hour?: SubscriptionTier;
  seven_day?: SubscriptionTier;
  planName?: string;
}

export interface BalanceUsage {
  kind: 'balance';
  remaining: number;
  total?: number;
  used?: number;
  unit: string; // 'CNY' | 'USD' | 'credits'
  planName?: string;
  isValid?: boolean;
  invalidMessage?: string;
}

export type NormalizedUsage = SubscriptionUsage | BalanceUsage;

export interface AdapterResult {
  ok: boolean;
  data?: NormalizedUsage;
  authFailed?: boolean;
  error?: string;
}

export interface UsageAdapter {
  id: string;
  displayName: string;
  matches(env: ProviderEnv): boolean;
  fetch(env: ProviderEnv): Promise<AdapterResult>;
}
