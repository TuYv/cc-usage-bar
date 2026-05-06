import { ProviderEnv, UsageAdapter } from './types';
import { anthropicAdapter } from './anthropic';
import { kimiAdapter } from './kimi';
import { glmAdapter } from './glm';
import { minimaxAdapter } from './minimax';
import { deepseekAdapter } from './deepseek';
import { stepfunAdapter } from './stepfun';
import { siliconflowAdapter } from './siliconflow';
import { openrouterAdapter } from './openrouter';
import { novitaAdapter } from './novita';

// Order matters: specific provider matches first, Anthropic last as default fallback.
const NON_DEFAULT: UsageAdapter[] = [
  kimiAdapter,
  glmAdapter,
  minimaxAdapter,
  deepseekAdapter,
  stepfunAdapter,
  siliconflowAdapter,
  openrouterAdapter,
  novitaAdapter,
];

export const ALL_ADAPTERS: UsageAdapter[] = [...NON_DEFAULT, anthropicAdapter];

export function selectAdapter(env: ProviderEnv): UsageAdapter | null {
  for (const a of NON_DEFAULT) {
    if (a.matches(env)) return a;
  }
  if (anthropicAdapter.matches(env)) return anthropicAdapter;
  return null;
}

export function getEnv(): ProviderEnv {
  return {
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    authToken: process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY,
  };
}
