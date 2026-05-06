export const HTTP_TIMEOUT_MS = 2_000;

export interface HttpResult<T = unknown> {
  ok: boolean;
  status?: number;
  body?: T;
  authFailed?: boolean;
  error?: string;
}

export async function httpGetJson<T = unknown>(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number = HTTP_TIMEOUT_MS
): Promise<HttpResult<T>> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, authFailed: true, error: `unauthorized (${res.status})` };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: `http ${res.status}` };
    }
    const body = (await res.json()) as T;
    return { ok: true, status: res.status, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'network error';
    return { ok: false, error: msg };
  }
}
