import type { Category } from './categories';

export type NearestInfo = {
  name: string | null;
  distKm: number;
  lat: number;
  lng: number;
};

// 재난 팝업에서 "대피장소 보기"를 눌렀을 때 지도 탭에 요청을 전달하는 통로
// - origin/nearest가 있으면 내 위치 기준, 없으면 center(선택한 지역의 중심) 기준
export type MapRequest = {
  categories: Category[];
  center?: { lat: number; lng: number };
  origin?: { lat: number; lng: number };
  nearest?: NearestInfo;
  note?: string;
  // true면 지도를 다시 움직이지 않고 가장 가까운 곳 카드(nearest)와 안내만 갱신한다 (조회가 늦게 끝났을 때)
  nearestOnly?: boolean;
  nonce: number;
};

let pending: MapRequest | null = null;
const listeners = new Set<() => void>();

export function requestMap(req: MapRequest) {
  pending = req;
  listeners.forEach(fn => fn());
}

// 대기 중인 요청을 한 번만 꺼내 간다
export function takeMapRequest(): MapRequest | null {
  const req = pending;
  pending = null;
  return req;
}

export function subscribeMapRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
