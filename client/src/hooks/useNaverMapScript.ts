import { useEffect, useState } from 'react';

declare global {
  interface Window {
    naver: any;
  }
}

let loadingPromise: Promise<void> | null = null;

function loadNaverMapScript(clientId: string): Promise<void> {
  if (window.naver && window.naver.maps) {
    return Promise.resolve();
  }
  if (loadingPromise) {
    return loadingPromise;
  }

  loadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${clientId}`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('네이버 지도 스크립트 로드 실패'));
    document.head.appendChild(script);
  });

  return loadingPromise;
}

export function useNaverMapScript() {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const clientId = import.meta.env.VITE_NAVER_MAP_CLIENT_ID;
    if (!clientId) {
      setError('VITE_NAVER_MAP_CLIENT_ID가 설정되지 않았습니다.');
      return;
    }

    loadNaverMapScript(clientId)
      .then(() => setLoaded(true))
      .catch((e) => setError(e.message));
  }, []);

  return { loaded, error };
}