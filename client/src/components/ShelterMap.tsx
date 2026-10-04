import { useEffect, useRef } from 'react';
import { useNaverMapScript } from '../hooks/useNaverMapScript';

export default function ShelterMap() {
  const mapRef = useRef<HTMLDivElement>(null);
  const { loaded, error } = useNaverMapScript();

  useEffect(() => {
    if (!loaded || !mapRef.current) return;

    const map = new window.naver.maps.Map(mapRef.current, {
      center: new window.naver.maps.LatLng(37.4563, 126.7052), // 인천 기준 (필요시 변경)
      zoom: 12,
    });

    // 테스트용 마커 하나
    new window.naver.maps.Marker({
      position: new window.naver.maps.LatLng(37.4563, 126.7052),
      map,
    });
  }, [loaded]);

  if (error) {
    return <div style={{ color: 'red' }}>지도 로드 오류: {error}</div>;
  }

  return (
    <div
      ref={mapRef}
      style={{ width: '100%', height: '100%' }}
    />
  );
}