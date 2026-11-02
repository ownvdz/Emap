import { useCallback, useEffect, useRef, useState } from 'react';
import type { MapRequest } from './ShelterMap';
import { GENERIC_GUIDANCE, GUIDANCE } from '../data/guidance';

interface Alert {
  id: string;
  createdAt: string;
  message: string;
  region: string;
  level: string;
  type: string;
  isTest?: boolean;
}

const REGION_KEY = 'emap.alertRegion';
const SUB_KEY = 'emap.alertSub';
const SEEN_KEY = 'emap.seenAlerts';

// 팝업을 띄울 기준 (필요에 맞게 조절)
const EMERGENCY_LEVELS = ['위급재난', '긴급재난'];
const EMERGENCY_TYPES = ['지진', '지진해일', '민방공'];
const POPUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 이 시간보다 오래된 문자는 팝업 제외
const POLL_MS = 60_000;
const MAX_SEEN = 200;

const LEVEL_COLOR: Record<string, string> = {
  위급재난: '#DC2626',
  긴급재난: '#F97316',
  안전안내: '#2563EB',
};

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function readSeen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function saveSeen(ids: string[]) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-MAX_SEEN)));
  } catch {
    /* 저장이 막혀 있어도 동작에는 영향 없음 */
  }
}

// "2026/10/28 13:47:38" 형식(한국 시간)을 시각으로 변환. 해석하지 못하면 null
function parseKst(s: string): number | null {
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isNaN(t) ? null : t;
}

const isDrill = (a: Alert) => /훈련/.test(a.message);

function priority(a: Alert): number {
  if (a.level === '위급재난') return 3;
  if (isDrill(a)) return 0; // 훈련 문자는 위급재난이 아니면 팝업 제외
  if (a.level === '긴급재난') return EMERGENCY_LEVELS.includes('긴급재난') ? 2 : 0;
  return EMERGENCY_TYPES.includes(a.type) ? 1 : 0;
}

const sortQueue = (list: Alert[]) =>
  [...list].sort((a, b) => priority(b) - priority(a) || Number(b.id) - Number(a.id) || 0);

function notifyUser(a: Alert) {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300]); // 안드로이드 크롬 등에서만 동작
  } catch {
    /* 지원하지 않는 기기 */
  }
  if (
    typeof Notification !== 'undefined' &&
    window.isSecureContext &&
    Notification.permission === 'granted' &&
    document.hidden
  ) {
    try {
      new Notification(`${a.type || '재난'} ${a.level}`, { body: a.message, tag: a.id });
    } catch {
      /* 알림 생성에 실패해도 팝업은 그대로 동작 */
    }
  }
}

export default function EmergencyWatcher({
  onShowShelters,
}: {
  onShowShelters: (req: MapRequest) => void;
}) {
  const [queue, setQueue] = useState<Alert[]>([]);
  const known = useRef(new Set<string>()); // 이번에 이미 큐에 넣은 문자 id
  const dismissBtn = useRef<HTMLButtonElement>(null);

  const poll = useCallback(async () => {
    const region = readStored(REGION_KEY);
    if (!region) return;
    const sub = readStored(SUB_KEY);

    try {
      const params = new URLSearchParams({ region });
      if (sub) params.set('sub', sub);
      const res = await fetch(`/api/alerts?${params}`);
      if (!res.ok) return;
      const data: { items: Alert[] } = await res.json();

      const seen = new Set(readSeen());
      const now = Date.now();
      const fresh = data.items.filter((a) => {
        if (priority(a) === 0 || seen.has(a.id) || known.current.has(a.id)) return false;
        const t = parseKst(a.createdAt);
        return t === null || t >= now - POPUP_WINDOW_MS; // 시각을 못 읽으면 놓치지 않도록 포함
      });
      if (fresh.length === 0) return;

      fresh.forEach((a) => {
        known.current.add(a.id);
        notifyUser(a);
      });
      setQueue((prev) => sortQueue([...prev, ...fresh]));
    } catch {
      /* 다음 주기에 다시 시도 */
    }
  }, []);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) poll();
    };
    const onRegionChanged = () => {
      known.current.clear();
      setQueue((q) => q.filter((a) => a.isTest)); // 다른 지역의 대기 문자는 지움
      poll();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('emap:region-changed', onRegionChanged);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('emap:region-changed', onRegionChanged);
    };
  }, [poll]);

  // 테스트: 주소 뒤에 ?testAlert=지진 (또는 지진해일, 민방공, 기타)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('testAlert');
    if (!t) return;
    const type = ['지진', '지진해일', '민방공'].includes(t) ? t : '기타';
    const test: Alert = {
      id: `test-${type}`,
      createdAt: new Date().toLocaleString('ko-KR'),
      message: '[테스트] 기능 확인을 위한 예시 화면입니다. 실제 재난 상황이 아닙니다.',
      region: '테스트',
      level: '위급재난',
      type,
      isTest: true,
    };
    setQueue((q) => (q.some((a) => a.id === test.id) ? q : sortQueue([...q, test])));
  }, []);

  const current = queue[0];

  useEffect(() => {
    if (current) dismissBtn.current?.focus();
  }, [current?.id]);

  if (!current) return null;

  const guidance = GUIDANCE[current.type] ?? GENERIC_GUIDANCE;
  const color = LEVEL_COLOR[current.level] ?? '#6B7280';

  const dismiss = (a: Alert) => {
    if (!a.isTest) saveSeen([...readSeen(), a.id]);
    setQueue((q) => q.filter((x) => x.id !== a.id));
  };

  const showShelters = async () => {
    const category = guidance.shelterCategory;
    if (!category) return;

    const region = readStored(REGION_KEY);
    const sub = readStored(SUB_KEY);
    let center: { lat: number; lng: number } | undefined;

    if (region) {
      try {
        const params = new URLSearchParams({ region, category });
        if (sub) params.set('sub', sub);
        const res = await fetch(`/api/map-center?${params}`);
        if (res.ok) {
          const d = await res.json();
          if (d.count > 0) center = { lat: d.lat, lng: d.lng };
        }
      } catch {
        /* 중심을 구하지 못해도 지도는 연다 */
      }
    }

    dismiss(current);
    onShowShelters({ categories: [category], center, nonce: Date.now() });
  };

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 14,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="emergency-title"
        style={{
          width: '100%',
          maxHeight: '100%',
          overflowY: 'auto',
          background: '#fff',
          borderRadius: 16,
          borderTop: `6px solid ${color}`,
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ background: color, color: '#fff', fontSize: 12, padding: '2px 8px', borderRadius: 10 }}>
            {current.level}
          </span>
          {current.isTest && (
            <span style={{ background: '#111827', color: '#fff', fontSize: 12, padding: '2px 8px', borderRadius: 10 }}>
              테스트
            </span>
          )}
          {isDrill(current) && !current.isTest && (
            <span style={{ background: '#6B7280', color: '#fff', fontSize: 12, padding: '2px 8px', borderRadius: 10 }}>
              훈련
            </span>
          )}
          {queue.length > 1 && (
            <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>대기 중 {queue.length - 1}건 더 있음</span>
          )}
        </div>

        <h2 id="emergency-title" style={{ margin: '10px 0 2px', fontSize: 19 }}>
          {current.type || '재난'} 알림
        </h2>
        <div style={{ fontSize: 12, color: '#6b7280' }}>{current.createdAt}</div>

        {/* 문자 원문은 가공하지 않고 그대로 표시 */}
        <p
          style={{
            margin: '10px 0 0',
            padding: 10,
            background: '#F3F4F6',
            borderRadius: 8,
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
        >
          {current.message}
        </p>

        <h3 style={{ margin: '14px 0 6px', fontSize: 15 }}>{guidance.title} (요약)</h3>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.55 }}>
          {guidance.steps.map((s) => (
            <li key={s} style={{ marginBottom: 4 }}>{s}</li>
          ))}
        </ol>
        {guidance.note && (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#92400E', background: '#FEF3C7', padding: 8, borderRadius: 8 }}>
            {guidance.note}
          </p>
        )}

        <p style={{ margin: '10px 0 0', fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>
          출처: {guidance.sourceLabel} 요약 ·{' '}
          <a href={guidance.sourceUrl} target="_blank" rel="noopener noreferrer">공식 행동요령 전문 보기</a>
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {guidance.shelterCategory && (
            <button
              type="button"
              onClick={showShelters}
              style={{ padding: '12px 0', fontSize: 15, borderRadius: 10, border: 'none', background: color, color: '#fff', cursor: 'pointer' }}
            >
              {guidance.shelterLabel ?? '대피장소 보기'}
            </button>
          )}
          <button
            ref={dismissBtn}
            type="button"
            onClick={() => dismiss(current)}
            style={{ padding: '12px 0', fontSize: 15, borderRadius: 10, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
          >
            확인했습니다
          </button>
        </div>

        <p style={{ margin: '10px 0 0', fontSize: 11, color: '#9ca3af', lineHeight: 1.5 }}>
          공식 재난문자·방송·정부 안내가 항상 우선입니다. 이 화면은 보조 수단이며 지연되거나 누락될 수 있습니다.
        </p>
      </div>
    </div>
  );
}

// 홈 화면에 둘 브라우저 알림 켜기 버튼 (HTTPS에서만 사용 가능)
export function NotificationToggle() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  );

  if (typeof Notification === 'undefined') return null;

  const note = { fontSize: 12, color: '#6b7280', margin: '10px 0 0' } as const;

  if (!window.isSecureContext) {
    return <p style={note}>브라우저 알림은 HTTPS 주소에서만 사용할 수 있습니다.</p>;
  }
  if (permission === 'granted') {
    return <p style={note}>브라우저 알림이 켜져 있습니다. (앱 화면이 열려 있을 때만 동작합니다)</p>;
  }
  if (permission === 'denied') {
    return <p style={note}>브라우저 알림이 차단되어 있습니다. 브라우저 설정에서 허용해주세요.</p>;
  }
  return (
    <button
      type="button"
      onClick={async () => setPermission(await Notification.requestPermission())}
      style={{ marginTop: 10, padding: '8px 12px', fontSize: 13, borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}
    >
      브라우저 알림 켜기
    </button>
  );
}