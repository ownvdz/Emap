import { useEffect, useRef, useState } from 'react';
import { useNaverMapScript } from '../hooks/useNaverMapScript';

interface Shelter {
  id: number;
  name: string | null;
  type: string | null;
  address: string | null;
  capacity: number | null;
  lat: number;
  lng: number;
}

const MIN_ZOOM_TO_LOAD = 13; // 이보다 축소되면 조회하지 않음 (값은 화면 보며 조절)

function buildInfoContent(s: Shelter): HTMLElement {
  // 문자열 HTML이 아니라 textContent로 만들어 데이터에 태그가 섞여도 안전하게 표시
  const el = document.createElement('div');
  el.style.cssText = 'padding:10px 12px;font-size:13px;line-height:1.5;max-width:220px;';

  const title = document.createElement('strong');
  title.textContent = s.name ?? '이름 없음';
  el.appendChild(title);

  const addLine = (text: string) => {
    const p = document.createElement('div');
    p.textContent = text;
    el.appendChild(p);
  };

  if (s.address) addLine(s.address);
  if (s.type) addLine(`구분: ${s.type}`);
  if (s.capacity != null) addLine(`수용 인원: ${s.capacity}명`);

  return el;
}

export default function ShelterMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const { loaded, error } = useNaverMapScript();
  const [notice, setNotice] = useState<string | null>(null);

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
      if (map.getZoom() < MIN_ZOOM_TO_LOAD) {
        clearMarkers();
        setNotice('지도를 더 확대하면 대피소가 표시됩니다.');
        return;
      }

      const bounds = map.getBounds();
      const sw = bounds.getSW();
      const ne = bounds.getNE();

      controller?.abort(); // 이전 요청이 아직 진행 중이면 취소
      controller = new AbortController();

      try {
        const params = new URLSearchParams({
          swLat: String(sw.lat()),
          swLng: String(sw.lng()),
          neLat: String(ne.lat()),
          neLng: String(ne.lng()),
        });
        const res = await fetch(`/api/shelters?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { items: Shelter[]; truncated: boolean } = await res.json();

        clearMarkers();
        markers = data.items.map((s) => {
          const marker = new naver.maps.Marker({
            position: new naver.maps.LatLng(s.lat, s.lng),
            map,
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

    // 지도 이동/확대가 끝날 때마다 해당 범위를 다시 조회
    const listener = naver.maps.Event.addListener(map, 'idle', load);

    return () => {
      naver.maps.Event.removeListener(listener);
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
      {notice && (
        <div
          style={{
            position: 'absolute',
            top: 12,
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