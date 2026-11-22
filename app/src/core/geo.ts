// 두 지점 사이의 거리·방향 계산 (순수 함수)

export type LatLng = { lat: number; lng: number };

const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// a에서 b를 본 방위각 (북쪽 0°, 시계 방향)
export function bearingDeg(a: LatLng, b: LatLng): number {
  const dLng = rad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360;
}

const DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

export function compass(deg: number): string {
  return `${DIRS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]}쪽`;
}

export function formatDistance(m: number): string {
  if (m < 1000) {
    return `${Math.max(Math.round(m / 10) * 10, 10)}m`;
  }
  return `${(m / 1000).toFixed(1)}km`;
}

// "북동쪽 120m" 처럼 from에서 본 to의 위치. 아주 가까우면 "바로 근처"
export function describeOffset(from: LatLng, to: LatLng): string {
  const m = distanceM(from, to);
  if (m < 15) {
    return '바로 근처';
  }
  return `${compass(bearingDeg(from, to))} ${formatDistance(m)}`;
}
