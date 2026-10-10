import { useEffect, useRef, useState } from 'react';
import { useNaverMapScript } from '../hooks/useNaverMapScript';

type Category = 'CIVIL_DEFENSE' | 'EARTHQUAKE' | 'TSUNAMI';

const CATEGORY_ORDER: Category[] = ['CIVIL_DEFENSE', 'EARTHQUAKE', 'TSUNAMI'];

const CATEGORY_INFO: Record<Category, { label: string; color: string }> = {
  CIVIL_DEFENSE: { label: '민방위', color: '#2563EB' },
  EARTHQUAKE: { label: '지진', color: '#F97316' },
  TSUNAMI: { label: '해일', color: '#10B981' },
};

const FALLBACK_INFO = { label: '기타', color: '#6B7280' };

interface Shelter {
  id: number;
  category: Category;
  name: string | null;
  type: string | null;
  address: string | null;
  capacity: number | null;
  area: number | null;
  lat: number;
  lng: number;
}

const MIN_ZOOM_TO_LOAD = 13;

function buildInfoContent(s: Shelter): HTMLElement {
  const info = CATEGORY_INFO[s.category] ?? FALLBACK_INFO;

  const el = document.createElement('div');
  el.style.cssText = 'padding:10px 12px;font-size:13px;line-height:1.5;max-width:220px;';

  const head = document.createElement('div');
  const badge = document.createElement('span');
  badge.textContent = info.label;
  badge.style.cssText = `display:inline-block;margin-right:6px;padding:1px 6px;border-radius:8px;font-size:11px;color:#fff;background:${info.color};`;
  const title = document.createElement('strong');
  title.textContent = s.name ?? '이름 없음';
  head.appendChild(badge);
  head.appendChild(title);
  el.appendChild(head);

  // 외부 데이터는 HTML 문자열이 아니라 textContent로 넣어 태그가 섞여도 안전하게 표시
  const addLine = (text: string) => {
    const p = document.createElement('div');
    p.textContent = text;
    el.appendChild(p);
  };

  if (s.address) addLine(s.address);
  if (s.type) addLine(`구분: ${s.type}`);
  if (s.capacity != null) addLine(`수용 인원: ${s.capacity}명`);
  if (s.area != null) addLine(`수용 가능 면적: ${s.area}㎡`);

  return el;
}

export default function ShelterMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const { loaded, error } = useNaverMapScript();
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<Category, boolean>>({
    CIVIL_DEFENSE: true,
    EARTHQUAKE: true,
    TSUNAMI: true,
  });

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
    const map = new naver.maps.Map(mapRef.current, {
      center: new naver.maps.LatLng(37.4563, 126.7052),
      zoom: 14,
    });
    const infoWindow = new naver.maps.InfoWindow({ content: '' });

    let markers: any[] = [];
    let controller: AbortController | null = null;

    const clearMarkers = () => {
      markers.forEach((m) => m.setMap(null));
      markers = [];
    };

    const load = async () => {
      const categories = CATEGORY_ORDER.filter((c) => selectedRef.current[c]);

      if (categories.length === 0) {
        controller?.abort();
        clearMarkers();
        setNotice('표시할 항목을 선택해주세요.');
        return;
      }

      if (map.getZoom() < MIN_ZOOM_TO_LOAD) {
        controller?.abort();
        clearMarkers();
        setNotice('지도를 더 확대하면 대피소가 표시됩니다.');
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
          categories: categories.join(','),
        });
        const res = await fetch(`/api/shelters?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { items: Shelter[]; truncated: boolean } = await res.json();

        clearMarkers();
        markers = data.items.map((s) => {
          const color = (CATEGORY_INFO[s.category] ?? FALLBACK_INFO).color;
          const marker = new naver.maps.Marker({
            position: new naver.maps.LatLng(s.lat, s.lng),
            map,
            icon: {
              content: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 3px rgba(0,0,0,0.5);"></div>`,
              anchor: new naver.maps.Point(9, 9),
            },
          });
          naver.maps.Event.addListener(marker, 'click', () => {
            infoWindow.setContent(buildInfoContent(s));
            infoWindow.open(map, marker);
          });
          return marker;
        });

        setNotice(data.truncated ? '대피소가 많아 일부만 표시 중입니다. 더 확대해주세요.' : null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setNotice('대피소 정보를 불러오지 못했습니다.');
        }
      }
    };

    loadRef.current = load;
    const listener = naver.maps.Event.addListener(map, 'idle', load);

    return () => {
      naver.maps.Event.removeListener(listener);
      loadRef.current = null;
      controller?.abort();
      clearMarkers();
    };
  }, [loaded]);

  if (error) {
    return <div style={{ color: 'red', padding: 16 }}>지도 로드 오류: {error}</div>;
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* 표시할 대피소 종류 선택 (범례 겸용) */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          right: 10,
          zIndex: 10,
          display: 'flex',
          justifyContent: 'center',
          gap: 14,
          background: 'rgba(255,255,255,0.95)',
          padding: '8px 12px',
          borderRadius: 12,
          boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
        }}
      >
        {CATEGORY_ORDER.map((c) => (
          <label
            key={c}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, cursor: 'pointer' }}
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
            position: 'absolute',
            top: 58,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)',
            color: '#fff',
            padding: '8px 14px',
            borderRadius: 20,
            fontSize: 13,
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}
        >
          {notice}
        </div>
      )}
    </div>
  );
}