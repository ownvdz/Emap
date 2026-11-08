import { useEffect, useRef, useState } from 'react';
import { useNaverMapScript } from '../hooks/useNaverMapScript';

export type Category =
  | 'CIVIL_DEFENSE'
  | 'EARTHQUAKE_OUTDOOR'
  | 'EARTHQUAKE_INDOOR'
  | 'TSUNAMI'
  | 'HEAT_SHELTER'
  | 'COLD_SHELTER';

const CATEGORY_ORDER: Category[] = [
  'CIVIL_DEFENSE',
  'EARTHQUAKE_OUTDOOR',
  'EARTHQUAKE_INDOOR',
  'TSUNAMI',
  'HEAT_SHELTER',
  'COLD_SHELTER',
];

const CATEGORY_INFO: Record<Category, { label: string; color: string }> = {
  CIVIL_DEFENSE: { label: '민방위', color: '#2563EB' },
  EARTHQUAKE_OUTDOOR: { label: '지진 옥외', color: '#F97316' },
  EARTHQUAKE_INDOOR: { label: '지진 실내', color: '#B45309' },
  TSUNAMI: { label: '해일', color: '#10B981' },
  HEAT_SHELTER: { label: '무더위', color: '#EC4899' },
  COLD_SHELTER: { label: '한파', color: '#06B6D4' },
};

// 처음 지도를 열 때 켜둘 종류 (실내구호소와 쉼터는 마커가 많아서 기본으로 끔)
const DEFAULT_SELECTED: Record<Category, boolean> = {
  CIVIL_DEFENSE: true,
  EARTHQUAKE_OUTDOOR: true,
  EARTHQUAKE_INDOOR: false,
  TSUNAMI: true,
  HEAT_SHELTER: false,
  COLD_SHELTER: false,
};

const FALLBACK_INFO = { label: '기타', color: '#6B7280' };
const MIXED_COLOR = '#374151'; // 종류가 섞인 마커 색

// 마커가 매우 많은 종류: 더 확대해야 불러옴
const DENSE_CATEGORIES: Category[] = ['HEAT_SHELTER', 'COLD_SHELTER'];
const isDense = (c: Category) => DENSE_CATEGORIES.includes(c);

interface Shelter {
  id: number;
  category: Category;
  categories?: Category[]; // 같은 시설이 여러 종류일 때(한파·무더위 겸용 등) 화면에서 합쳐 채움
  name: string | null;
  type: string | null;
  address: string | null;
  capacity: number | null;
  area: number | null;
  lat: number;
  lng: number;
  distKm?: number; // 현재 위치에서의 거리 (가까운 대피소 조회일 때만)
}

export interface MapRequest {
  categories: Category[];
  center?: { lat: number; lng: number };   // 현재 위치를 못 구했을 때 쓰는 선택 지역의 중심
  origin?: { lat: number; lng: number };   // 현재 위치
  nearest?: Shelter[];                     // 현재 위치에서 가까운 순
  note?: string;                           // 지도에 함께 보여줄 안내
  nonce: number;                           // 같은 요청이 다시 와도 지도를 새로 만들게 하는 값
}

const MIN_ZOOM_TO_LOAD = 13;
const MIN_ZOOM_DENSE = 15;
const FIT_RADIUS_KM = 2;  // 이 거리 안의 대피소를 한 화면에 담음
const FIT_COUNT = 50;     // 한 화면에 담을 최대 개수
const FIT_MARGIN = { top: 190, right: 40, bottom: 80, left: 40 };

const infoOf = (c: Category) => CATEGORY_INFO[c] ?? FALLBACK_INFO;
const catsOf = (s: Shelter): Category[] => s.categories ?? [s.category];

function fmtDist(km?: number): string {
  if (km == null) return '';
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

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
      if (key && !existing) byName.set(key, copy);
      result.push(copy);
    }
  }
  return result;
}

// 같은 위치(소수점 5자리, 약 1m)의 대피소를 한 묶음으로 만듦
function groupByLocation(items: Shelter[]): Shelter[][] {
  const map = new Map<string, Shelter[]>();
  for (const s of items) {
    const key = `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`;
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  return [...map.values()].map((list) => {
    const merged = mergeSameFacility(list);
    merged.sort(
      (a, b) => CATEGORY_ORDER.indexOf(catsOf(a)[0]) - CATEGORY_ORDER.indexOf(catsOf(b)[0])
    );
    return merged;
  });
}

// 마커 모양: 1곳이면 색 점, 여러 곳이면 개수가 적힌 원 (종류가 섞이면 회색)
function buildMarkerIcon(group: Shelter[]): { content: string; size: number } {
  const cats = new Set(group.flatMap(catsOf));
  const color = cats.size === 1 ? infoOf([...cats][0]).color : MIXED_COLOR;

  if (group.length === 1) {
    return {
      content: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.5);"></div>`,
      size: 18,
    };
  }

  const label = group.length > 99 ? '99+' : String(group.length);
  return {
    content: `<div style="min-width:22px;height:22px;padding:0 4px;box-sizing:border-box;border-radius:11px;background:${color};color:#fff;border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.5);font-size:11px;font-weight:600;line-height:18px;text-align:center;">${label}</div>`,
    size: 26,
  };
}

// 말풍선 내용: 외부 데이터는 textContent로만 넣어 태그가 섞여도 안전하게 표시
function buildInfoContent(group: Shelter[], onClose: () => void): HTMLElement {
  // 바깥 틀: X 버튼이 스크롤 영역 밖에 있어서 목록을 스크롤해도 제자리에 있음
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;width:240px;';

  // 말풍선 안쪽의 클릭/터치가 지도로 전달돼 창이 저절로 닫히는 것을 방지
  ['click', 'mousedown', 'touchstart', 'pointerdown'].forEach((type) => {
    wrapper.addEventListener(type, (e) => e.stopPropagation());
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', '닫기');
  closeBtn.style.cssText =
    'position:absolute;top:4px;right:4px;width:28px;height:28px;border:none;background:transparent;color:#6b7280;font-size:16px;line-height:1;cursor:pointer;z-index:1;';
  closeBtn.addEventListener('click', onClose);
  wrapper.appendChild(closeBtn);

  const el = document.createElement('div');
  el.style.cssText =
    'box-sizing:border-box;padding:10px 32px 10px 12px;font-size:13px;line-height:1.5;max-height:240px;overflow-y:auto;';

  if (group.length > 1) {
    const head = document.createElement('div');
    head.style.cssText = 'font-weight:600;margin-bottom:8px;';
    head.textContent = `이 위치의 대피소 ${group.length}곳`;
    el.appendChild(head);
  }

  group.forEach((s, i) => {
    const item = document.createElement('div');
    if (i > 0) {
      item.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;';
    }

    const titleRow = document.createElement('div');
    catsOf(s).forEach((c) => {
      const info = infoOf(c);
      const badge = document.createElement('span');
      badge.textContent = info.label;
      badge.style.cssText = `display:inline-block;margin-right:4px;padding:1px 6px;border-radius:8px;font-size:11px;color:#fff;background:${info.color};`;
      titleRow.appendChild(badge);
    });
    const title = document.createElement('strong');
    title.textContent = s.name ?? '이름 없음';
    titleRow.appendChild(title);
    item.appendChild(titleRow);

    const addLine = (text: string) => {
      const p = document.createElement('div');
      p.textContent = text;
      item.appendChild(p);
    };

    if (s.distKm != null) addLine(`현재 위치에서 약 ${fmtDist(s.distKm)}`);
    if (s.address) addLine(s.address);
    if (s.type) addLine(`구분: ${s.type}`);
    if (s.capacity != null) addLine(`수용 인원: ${s.capacity}명`);
    if (s.area != null) addLine(`수용 가능 면적: ${s.area}㎡`);

    el.appendChild(item);
  });

  wrapper.appendChild(el);
  return wrapper;
}

export default function ShelterMap({ request = null }: { request?: MapRequest | null }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<any>(null);
  const { loaded, error } = useNaverMapScript();
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<Category, boolean>>(() => {
    const only = request?.categories;
    if (!only) return { ...DEFAULT_SELECTED };
    return Object.fromEntries(CATEGORY_ORDER.map((c) => [c, only.includes(c)])) as Record<Category, boolean>;
  });

  const origin = request?.origin;
  const nearest0 = origin ? request?.nearest?.[0] : undefined;

  // 지도 이벤트 안의 load()가 항상 최신 선택값을 읽도록 ref로 전달
  const selectedRef = useRef(selected);
  const loadRef = useRef<(() => void) | null>(null);

  // 체크박스가 바뀌면 최신값을 반영하고 즉시 다시 조회
  useEffect(() => {
    selectedRef.current = selected;
    loadRef.current?.();
  }, [selected]);

  useEffect(() => {
    if (!loaded || !mapRef.current) return;

    const { naver } = window;
    const start = origin ?? request?.center;
    const map = new naver.maps.Map(mapRef.current, {
      center: new naver.maps.LatLng(start?.lat ?? 37.4563, start?.lng ?? 126.7052),
      zoom: origin ? 15 : start ? 13 : 14,
    });
    mapObjRef.current = map;
    const infoWindow = new naver.maps.InfoWindow({ content: '' });

    let markers: any[] = [];
    let controller: AbortController | null = null;
    const extraMarkers: any[] = []; // 현재 위치 / 가장 가까운 대피소 (조회로 지워지지 않는 마커)

    const clearMarkers = () => {
      markers.forEach((m) => m.setMap(null));
      markers = [];
    };

    // 현재 위치 기준 표시: 내 위치, 가장 가까운 대피소 강조, 한 화면에 담기
    if (origin) {
      const here = new naver.maps.LatLng(origin.lat, origin.lng);
      extraMarkers.push(
        new naver.maps.Marker({
          position: here,
          map,
          zIndex: 200,
          icon: {
            content:
              '<div style="width:18px;height:18px;border-radius:50%;background:#2563EB;border:3px solid #fff;box-shadow:0 0 0 6px rgba(37,99,235,0.25);"></div>',
            anchor: new naver.maps.Point(12, 12),
          },
        })
      );

      const list = request?.nearest ?? [];
      if (list.length > 0) {
        const first = list[0];
        const color = infoOf(first.category).color;
        const nearestMarker = new naver.maps.Marker({
          position: new naver.maps.LatLng(first.lat, first.lng),
          map,
          zIndex: 150,
          icon: {
            content: `<div style="width:20px;height:20px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 4px #DC2626;"></div>`,
            anchor: new naver.maps.Point(13, 13),
          },
        });
        naver.maps.Event.addListener(nearestMarker, 'click', () => {
          infoWindow.setContent(buildInfoContent([first], () => infoWindow.close()));
          infoWindow.open(map, nearestMarker);
        });
        extraMarkers.push(nearestMarker);

        // 2km 안의 가까운 대피소를 한 화면에 담고, 하나도 없으면 가장 가까운 1곳이 보이게 함
        const near = list.filter((s) => (s.distKm ?? 0) <= FIT_RADIUS_KM).slice(0, FIT_COUNT);
        const focus = near.length > 0 ? near : [first];
        const bounds = new naver.maps.LatLngBounds(here, here);
        focus.forEach((s) => bounds.extend(new naver.maps.LatLng(s.lat, s.lng)));
        map.fitBounds(bounds, FIT_MARGIN);
      }
    }

    const load = async () => {
      const categories = CATEGORY_ORDER.filter((c) => selectedRef.current[c]);

      if (categories.length === 0) {
        controller?.abort();
        clearMarkers();
        setNotice('표시할 항목을 선택해주세요.');
        return;
      }

      // 쉼터는 더 확대해야 불러오고, 나머지는 기존 배율부터 불러옴
      const zoom = map.getZoom();
      const loadable = categories.filter((c) => zoom >= (isDense(c) ? MIN_ZOOM_DENSE : MIN_ZOOM_TO_LOAD));
      const hiddenDense = categories.some((c) => isDense(c) && zoom < MIN_ZOOM_DENSE);

      if (loadable.length === 0) {
        controller?.abort();
        clearMarkers();
        setNotice(
          categories.every(isDense)
            ? '쉼터는 지도를 더 확대해야 표시됩니다.'
            : '지도를 더 확대하면 대피소가 표시됩니다.'
        );
        return;
      }

      const bounds = map.getBounds();
      const sw = bounds.getSW();
      const ne = bounds.getNE();

      controller?.abort();
      controller = new AbortController();

      try {
        const params = new URLSearchParams({
          swLat: String(sw.lat()),
          swLng: String(sw.lng()),
          neLat: String(ne.lat()),
          neLng: String(ne.lng()),
          categories: loadable.join(','),
        });
        const res = await fetch(`/api/shelters?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { items: Shelter[]; truncated: boolean } = await res.json();

        clearMarkers();
        markers = groupByLocation(data.items).map((group) => {
          const { content, size } = buildMarkerIcon(group);
          const marker = new naver.maps.Marker({
            position: new naver.maps.LatLng(group[0].lat, group[0].lng),
            map,
            icon: { content, anchor: new naver.maps.Point(size / 2, size / 2) },
          });
          naver.maps.Event.addListener(marker, 'click', () => {
            infoWindow.setContent(buildInfoContent(group, () => infoWindow.close()));
            infoWindow.open(map, marker);
          });
          return marker;
        });

        setNotice(
          data.truncated
            ? '대피소가 많아 일부만 표시 중입니다. 더 확대해주세요.'
            : hiddenDense
              ? '쉼터는 지도를 더 확대하면 표시됩니다.'
              : null
        );
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setNotice('대피소 정보를 불러오지 못했습니다.');
        }
      }
    };

    loadRef.current = load;
    const idleListener = naver.maps.Event.addListener(map, 'idle', load);
    // 지도의 빈 곳을 클릭/터치하면 말풍선 닫기
    const clickListener = naver.maps.Event.addListener(map, 'click', () => infoWindow.close());

    return () => {
      naver.maps.Event.removeListener(idleListener);
      naver.maps.Event.removeListener(clickListener);
      loadRef.current = null;
      mapObjRef.current = null;
      controller?.abort();
      infoWindow.close();
      clearMarkers();
      extraMarkers.forEach((m) => m.setMap(null));
    };
    // 지도는 요청이 바뀌면 새로 만들어지므로(key) request는 의존성에 넣지 않음
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // '위치 보기': 내 위치와 가장 가까운 대피소가 함께 보이게 이동
  const focusNearest = () => {
    const map = mapObjRef.current;
    if (!map || !origin || !nearest0) return;
    const { naver } = window;
    const here = new naver.maps.LatLng(origin.lat, origin.lng);
    const bounds = new naver.maps.LatLngBounds(here, here);
    bounds.extend(new naver.maps.LatLng(nearest0.lat, nearest0.lng));
    map.fitBounds(bounds, FIT_MARGIN);
  };

  if (error) {
    return <div style={{ color: 'red', padding: 16 }}>지도 로드 오류: {error}</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* 위쪽 안내 영역: 종류 선택 → 알림 → 가까운 대피장소를 세로로 쌓아 서로 겹치지 않게 함 */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          right: 10,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '6px 12px',
            background: 'rgba(255,255,255,0.95)',
            padding: '8px 12px',
            borderRadius: 12,
            boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
          }}
        >
          {CATEGORY_ORDER.map((c) => (
            <label
              key={c}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12.5, cursor: 'pointer' }}
            >
              <input
                type="checkbox"
                checked={selected[c]}
                onChange={() => setSelected((prev) => ({ ...prev, [c]: !prev[c] }))}
              />
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: CATEGORY_INFO[c].color,
                  display: 'inline-block',
                }}
              />
              {CATEGORY_INFO[c].label}
            </label>
          ))}
        </div>

        {notice && (
          <div
            style={{
              pointerEvents: 'auto',
              alignSelf: 'center',
              background: 'rgba(0,0,0,0.75)',
              color: '#fff',
              padding: '8px 14px',
              borderRadius: 20,
              fontSize: 13,
            }}
          >
            {notice}
          </div>
        )}

        {/* 가장 가까운 대피장소 / 위치 관련 안내 */}
        {(nearest0 || request?.note) && (
          <div
            style={{
              pointerEvents: 'auto',
              background: 'rgba(255,255,255,0.97)',
              borderRadius: 12,
              padding: '8px 12px',
              boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            {nearest0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>
                    가장 가까운 {infoOf(nearest0.category).label} 대피장소
                  </div>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {nearest0.name ?? '이름 없음'}
                  </div>
                  <div style={{ color: '#4b5563' }}>현재 위치에서 약 {fmtDist(nearest0.distKm)}</div>
                </div>
                <button
                  type="button"
                  onClick={focusNearest}
                  style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
                >
                  위치 보기
                </button>
              </div>
            )}
            {request?.note && (
              <div style={{ color: '#92400E', marginTop: nearest0 ? 6 : 0 }}>{request.note}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}