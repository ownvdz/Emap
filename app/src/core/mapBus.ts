import type { Category } from './categories';

// 재난 팝업에서 "대피장소 보기"를 눌렀을 때 지도 탭에 요청을 전달하는 통로
export type MapRequest = {
  categories: Category[];
  center?: { lat: number; lng: number };
  note?: string;
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
