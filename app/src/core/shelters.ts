import { CATEGORY_ORDER, type Category } from './categories';

export interface Shelter {
  id: number;
  category: Category;
  categories?: Category[]; // 같은 시설이 여러 종류일 때(한파·무더위 겸용 등) 합쳐서 채움
  name: string | null;
  type: string | null;
  address: string | null;
  capacity: number | null;
  area: number | null;
  lat: number;
  lng: number;
  distKm?: number;
}

export const catsOf = (s: Shelter): Category[] => s.categories ?? [s.category];

// 같은 위치에서 이름이 같고 종류만 다른 항목(한파·무더위 겸용 시설 등)을 한 시설로 합침
function mergeSameFacility(list: Shelter[]): Shelter[] {
  const byName = new Map<string, Shelter>();
  const result: Shelter[] = [];
  for (const s of list) {
    const key = (s.name ?? '').trim();
    const existing = key ? byName.get(key) : undefined;
    if (existing && !catsOf(existing).includes(s.category)) {
      existing.categories = [...catsOf(existing), s.category];
    } else {
      const copy: Shelter = { ...s, categories: [s.category] };
      if (key && !existing) {
        byName.set(key, copy);
      }
      result.push(copy);
    }
  }
  return result;
}

// 같은 위치(소수점 5자리, 약 1m)의 대피소를 한 묶음으로 만듦
export function groupByLocation(items: Shelter[]): Shelter[][] {
  const map = new Map<string, Shelter[]>();
  for (const s of items) {
    const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
    const list = map.get(key);
    if (list) {
      list.push(s);
    } else {
      map.set(key, [s]);
    }
  }
  return [...map.values()].map(list => {
    const merged = mergeSameFacility(list);
    merged.sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(catsOf(a)[0]) - CATEGORY_ORDER.indexOf(catsOf(b)[0]),
    );
    return merged;
  });
}

export function fmtDist(km?: number): string {
  if (km == null) {
    return '';
  }
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}