import { API_BASE_URL } from '../config';
import { getIdentity } from './identity';
import { REPORT_TTL_MS, type Draft, type Report, type ReportKind } from './reports';
import type { LatLng } from './geo';

// 인터넷(서버)을 통한 구조 요청·위험 제보. 서버 쪽은 server/src/reportsStore.js

async function request(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 10000);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: init.method ?? 'GET',
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* 본문이 없거나 JSON이 아니면 상태 코드만 사용 */
    }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new Error('서버 응답 시간 초과');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 인터넷(서버)에 닿는지 확인. DB를 쓰지 않는 /api/health 로 짧게 확인한다.
// 주의: 휴대폰은 인터넷이 되는데 서버만 꺼진 경우에도 false가 된다.
export async function checkOnline(timeoutMs = 4000): Promise<boolean> {
  try {
    const r = await request('/api/health', { timeoutMs });
    return r.ok;
  } catch {
    return false;
  }
}

function errorMessage(r: { status: number; data: any }, fallback: string): string {
  return typeof r.data?.error === 'string' ? r.data.error : `${fallback} (HTTP ${r.status})`;
}

export async function postReport(draft: Draft, pos: LatLng & { ageMin: number }): Promise<{ id: string; createdAt: number }> {
  const { secretKey } = await getIdentity();
  const r = await request('/api/reports', {
    method: 'POST',
    body: {
      kind: draft.kind,
      sub: draft.sub,
      ...(draft.kind === 'sos' ? { count: draft.count } : {}),
      lat: pos.lat,
      lng: pos.lng,
      posAge: pos.ageMin,
      note: draft.note,
      key: secretKey,
    },
  });
  if (!r.ok) {
    throw new Error(errorMessage(r, '요청을 올리지 못했습니다'));
  }
  return { id: String(r.data.id), createdAt: Number(r.data.createdAt) };
}

export async function resolveReportOnline(id: string): Promise<void> {
  const { secretKey } = await getIdentity();
  const r = await request(`/api/reports/${encodeURIComponent(id)}/resolve`, { method: 'POST', body: { key: secretKey } });
  // 이미 만료돼 서버에 없는 경우(404)도 목록에서는 없애면 되므로 성공으로 본다
  if (!r.ok && r.status !== 404) {
    throw new Error(errorMessage(r, '처리하지 못했습니다'));
  }
}

type ServerItem = {
  id: string;
  kind: ReportKind;
  sub: string;
  count?: number | null;
  lat: number;
  lng: number;
  posAge?: number;
  note?: string;
  createdAt: number;
  mine: boolean;
};

export async function fetchReports(pos: LatLng | null): Promise<Report[]> {
  const { secretKey } = await getIdentity();
  const q = pos ? `?lat=${pos.lat}&lng=${pos.lng}&radiusKm=30` : '';
  const r = await request(`/api/reports${q}`, { headers: { 'x-owner-key': secretKey } });
  if (!r.ok) {
    throw new Error(errorMessage(r, '목록을 불러오지 못했습니다'));
  }
  const now = Date.now();
  const items: ServerItem[] = Array.isArray(r.data?.items) ? r.data.items : [];
  return items
    .filter(i => i && (i.kind === 'sos' || i.kind === 'hazard') && now - i.createdAt <= REPORT_TTL_MS)
    .map(i => ({
      id: i.id,
      kind: i.kind,
      sub: i.sub,
      count: i.count ?? undefined,
      lat: i.lat,
      lng: i.lng,
      posAge: i.posAge ?? 0,
      note: i.note || undefined,
      at: i.createdAt,
      mine: i.mine,
      resolved: false,
      via: 'net' as const,
    }));
}
