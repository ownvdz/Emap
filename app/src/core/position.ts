import { ensureLocationPermission, getCurrentPosition } from './location';
import type { LatLng } from './geo';
import { getItem, setItem } from './storage';

// 구조 요청에 넣을 위치. 인터넷이 없으면 네트워크 기반 위치를 쓸 수 없어 GPS만 되는데,
// 실내·지하에서는 한참 걸리거나 실패할 수 있다. 그래서 마지막으로 알아낸 위치를 저장해 두고,
// 새 위치를 못 얻으면 그 위치와 "몇 분 전 위치인지"를 함께 쓴다.
const KEY = 'emap.lastpos';
const MAX_STALE_MIN = 60 * 24; // 하루가 지난 위치는 쓰지 않는다

export type Located = LatLng & { ageMin: number };
let last: { lat: number; lng: number; at: number } | null = null;
let loaded = false;

async function load() {
  if (loaded) {
    return;
  }
  loaded = true;
  try {
    const raw = await getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (typeof v?.lat === 'number' && typeof v?.lng === 'number' && typeof v?.at === 'number') {
        last = v;
      }
    }
  } catch {
    /* 저장된 위치를 읽지 못하면 없는 것으로 */
  }
}

export function rememberPosition(p: LatLng) {
  last = { lat: p.lat, lng: p.lng, at: Date.now() };
  loaded = true;
  setItem(KEY, JSON.stringify(last));
}

// 저장된 마지막 위치 (없거나 너무 오래됐으면 null)
export async function lastKnown(): Promise<Located | null> {
  await load();
  if (!last) {
    return null;
  }
  const ageMin = Math.floor((Date.now() - last.at) / 60_000);
  if (ageMin > MAX_STALE_MIN) {
    return null;
  }
  return { lat: last.lat, lng: last.lng, ageMin };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('위치 확인 시간 초과')), ms);
    p.then(
      v => {
        clearTimeout(t);
        resolve(v);
      },
      e => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// 새 위치를 우선 시도하고, 안 되면 마지막 위치를 쓴다. 둘 다 없으면 null
export async function locate(timeoutMs = 15000): Promise<Located | null> {
  try {
    if (await ensureLocationPermission()) {
      const p = await withTimeout(getCurrentPosition(), timeoutMs);
      rememberPosition(p);
      return { ...p, ageMin: 0 };
    }
  } catch {
    /* 아래에서 마지막 위치로 대체 */
  }
  return lastKnown();
}
