import { API_BASE_URL } from './config';

type Options = { timeoutMs?: number; signal?: AbortSignal };

// RN의 URLSearchParams 구현이 불완전할 수 있어서 쿼리를 직접 만든다
export async function apiGet<T>(
  path: string,
  params?: Record<string, string>,
  opts: Options = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? 10000);
  opts.signal?.addEventListener('abort', () => controller.abort());

  try {
    const query = params
      ? '?' +
        Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : '';
    const res = await fetch(`${API_BASE_URL}${path}${query}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    if (timedOut) {
      throw new Error('요청 시간 초과');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}