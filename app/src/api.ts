import { API_BASE_URL } from './config';

// RN의 URLSearchParams 구현이 불완전할 수 있어서 쿼리를 직접 만든다
export async function apiGet<T>(
  path: string,
  params?: Record<string, string>,
  timeoutMs = 10000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
  } finally {
    clearTimeout(timer);
  }
}