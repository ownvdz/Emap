// 재난문자 관련 공통 타입과 규칙 (웹의 DisasterAlerts / EmergencyWatcher와 같은 기준)

export interface Alert {
  id: string;
  createdAt: string;
  message: string;
  region: string;
  level: string;
  type: string;
  isTest?: boolean;
}

export interface AlertResponse {
  items: Alert[];
  partial?: boolean;
  stale?: boolean;
  lookbackDays?: number;
}

export const REGIONS = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '대전광역시', '울산광역시',
  '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '경상북도', '경상남도', '제주특별자치도', '전남광주통합특별시',
];

export const LEVEL_COLOR: Record<string, string> = {
  위급재난: '#DC2626',
  긴급재난: '#F97316',
  안전안내: '#2563EB',
};

// 팝업을 띄울 기준
export const EMERGENCY_TYPES = ['지진', '지진해일', '민방공'];
export const POPUP_WINDOW_MS = 6 * 60 * 60 * 1000; // 이 시간보다 오래된 문자는 팝업 제외
export const POLL_MS = 60_000;

// "2026/10/28 13:47:38" 형식(한국 시간)을 시각으로 변환. 해석하지 못하면 null
export function parseKst(s: string): number | null {
  const m = s.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) {
    return null;
  }
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isNaN(t) ? null : t;
}

export const isDrill = (a: Alert) => /훈련/.test(a.message);

// 팝업 우선순위: 0이면 팝업 제외
export function priority(a: Alert): number {
  if (a.level === '위급재난') {
    return 3;
  }
  if (isDrill(a)) {
    return 0; // 훈련 문자는 위급재난이 아니면 팝업 제외
  }
  if (a.level === '긴급재난') {
    return 2;
  }
  return EMERGENCY_TYPES.includes(a.type) ? 1 : 0;
}

export const sortQueue = (list: Alert[]) =>
  [...list].sort((a, b) => priority(b) - priority(a) || Number(b.id) - Number(a.id) || 0);

// 개발용 테스트 문자 (실제 재난이 아님을 문구에 밝힘)
export function makeTestAlert(type: string): Alert {
  const known = ['지진', '지진해일', '민방공', '폭염', '한파'];
  const t = known.includes(type) ? type : '기타';
  return {
    id: `test-${t}`,
    createdAt: '',
    message: '[테스트] 기능 확인을 위한 예시 화면입니다. 실제 재난 상황이 아닙니다.',
    region: '테스트',
    level: '위급재난',
    type: t,
    isTest: true,
  };
}
