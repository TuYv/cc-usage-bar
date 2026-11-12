export interface ProviderEnv {
  baseUrl?: string;
  authToken?: string;
}

export interface SubscriptionTier {
  utilization: number; // 0-100
  resets_at?: string; // ISO 8601
}

// A weekly quota scoped to a specific model (e.g. Fable). The label is
// server-supplied, so new model buckets show up without a code change.
export interface ScopedTier extends SubscriptionTier {
  label: string;
}

export interface SubscriptionUsage {
  kind: 'subscription';
  five_hour?: SubscriptionTier;
  seven_day?: SubscriptionTier;
  scoped?: ScopedTier[];
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
  // HTTP status from the upstream provider, when the failure came from a real
  // network call. Local errors (missing credentials, missing env, parse) leave
  // this undefined so the cache layer can distinguish transient from permanent.
  status?: number;
  error?: string;
}

export interface UsageAdapter {
  id: string;
  displayName: string;
  matches(env: ProviderEnv): boolean;
  fetch(env: ProviderEnv): Promise<AdapterResult>;
}
