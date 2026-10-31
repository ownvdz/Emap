import { useCallback, useEffect, useRef, useState } from 'react';

const REGIONS = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '대전광역시', '울산광역시',
  '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '경상북도', '경상남도', '제주특별자치도', '전남광주통합특별시',
];

interface Alert {
  id: string;
  createdAt: string;
  message: string;
  region: string;
  level: string;
  type: string;
}

interface AlertResponse {
  items: Alert[];
  partial?: boolean;
  stale?: boolean;
  lookbackDays?: number;
}

const LEVEL_COLOR: Record<string, string> = {
  위급재난: '#DC2626',
  긴급재난: '#F97316',
  안전안내: '#2563EB',
};

const STORAGE_KEY = 'emap.alertRegion';
const REFRESH_MS = 60_000;

export default function DisasterAlerts() {
  const [region, setRegion] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [data, setData] = useState<AlertResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!region) return;

    controllerRef.current?.abort(); // 이전 요청이 남아 있으면 취소 (지역을 바꿨을 때 섞이지 않게)
    const controller = new AbortController();
    controllerRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch(`/api/alerts?region=${encodeURIComponent(region)}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(null);
      setUpdatedAt(new Date());
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError('재난문자를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, [region]);

  useEffect(() => {
    setData(null); // 지역이 바뀌면 이전 지역의 문자를 지움
    setError(null);
    if (!region) return;

    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      clearInterval(timer);
      controllerRef.current?.abort();
    };
  }, [region, load]);

  const onChangeRegion = (value: string) => {
    setRegion(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* 저장이 막혀 있어도 동작에는 영향 없음 */
    }
  };

  return (
    <section style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 17 }}>내 지역 재난문자</h2>
        <button
          type="button"
          onClick={load}
          disabled={!region || loading}
          style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
        >
          {loading ? '불러오는 중' : '새로고침'}
        </button>
      </div>

      <select
        value={region}
        onChange={(e) => onChangeRegion(e.target.value)}
        style={{ width: '100%', marginTop: 10, padding: '8px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #d1d5db' }}
      >
        <option value="">지역을 선택하세요</option>
        {REGIONS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>

      {!region && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>지역을 선택하면 해당 지역의 최근 재난문자를 보여드립니다.</p>
      )}

      {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}

      {data?.stale && (
        <p style={{ color: '#B45309', fontSize: 13 }}>
          최신 정보를 가져오지 못해 이전에 받은 내용을 보여주고 있습니다.
        </p>
      )}

      {region && data && data.items.length === 0 && !error && (
        <p style={{ color: '#6b7280', fontSize: 13 }}>
          최근 {data.lookbackDays ?? 3}일 동안 이 지역으로 발송된 재난문자가 없습니다.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
        {data?.items.map((a) => (
          <article key={a.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, background: '#fff' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span
                style={{
                  background: LEVEL_COLOR[a.level] ?? '#6B7280',
                  color: '#fff',
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 10,
                }}
              >
                {a.level || '구분 없음'}
              </span>
              {a.type && <span style={{ fontSize: 12, color: '#374151' }}>{a.type}</span>}
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>{a.createdAt}</span>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{a.message}</p>
            {a.region && (
              <details style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                <summary style={{ cursor: 'pointer' }}>수신 지역</summary>
                <div style={{ marginTop: 4, lineHeight: 1.4 }}>{a.region}</div>
              </details>
            )}
          </article>
        ))}
      </div>

      {data?.partial && (
        <p style={{ color: '#6b7280', fontSize: 12 }}>문자가 많아 최근 일부만 표시 중입니다.</p>
      )}

      {updatedAt && (
        <p style={{ color: '#9ca3af', fontSize: 11, margin: '10px 0 0' }}>
          마지막 확인: {updatedAt.toLocaleTimeString('ko-KR')}
        </p>
      )}

      <p style={{ color: '#6b7280', fontSize: 11, lineHeight: 1.5, margin: '10px 0 0' }}>
        공식 재난문자는 휴대폰으로 직접 수신되는 알림이 기준입니다. 이 화면은 보조 수단이며 지연되거나
        누락될 수 있습니다.
        <br />
        출처: 행정안전부 긴급재난문자 (재난안전데이터공유플랫폼)
      </p>
    </section>
  );
}