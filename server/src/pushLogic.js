// 푸시 알림의 순수 로직 (네트워크·Firebase 없이 테스트할 수 있도록 따로 둠)
// ※ 토픽 이름 규칙은 앱의 app/src/core/pushTopics.ts 와 반드시 같아야 한다.

// FCM 토픽 이름에는 [a-zA-Z0-9-_.~%] 만 쓸 수 있어서, 한글 지역명은 퍼센트 인코딩해서 쓴다.
const enc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// kind: 'a' = 시도 전체를 받는 사람, 'w' = 시도 전체로 온 문자를 받는 사람(시군구 선택자),
//       's' = 특정 시군구 문자를 받는 사람
export function topicName(kind, sido, sub = '') {
  return sub ? `${kind}_${enc(sido)}_${enc(sub)}` : `${kind}_${enc(sido)}`;
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// 푸시를 보낼 문자인지: 위급재난은 항상, 긴급재난은 훈련 문자가 아닐 때 (앱 팝업 기준과 같음)
export function qualifies(alert) {
  if (alert.level === '위급재난') return true;
  if (/훈련/.test(alert.message)) return false;
  return alert.level === '긴급재난';
}

// "2026/10/28 13:47:38" (한국 시간) → ms. 해석하지 못하면 null
export function parseKst(s) {
  const m = String(s).match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+09:00`);
  return Number.isNaN(t) ? null : t;
}

// 문자의 수신 지역("서울특별시 강남구, 경기도 전체" 같은 문자열)에서 푸시를 보낼 토픽 목록을 만든다.
export function topicsForAlert(regionText, regions) {
  const topics = new Set();
  for (const raw of String(regionText).split(',')) {
    const part = norm(raw);
    const sido = regions.find((r) => part === r || part.startsWith(`${r} `));
    if (!sido) continue;

    topics.add(topicName('a', sido)); // 시도 전체를 받겠다고 한 사람
    const rest = part.slice(sido.length).trim();
    if (!rest || rest === '전체') {
      topics.add(topicName('w', sido)); // 시군구를 고른 사람도 시도 전체 문자는 받음
    } else {
      topics.add(topicName('s', sido, rest));
      const first = rest.split(' ')[0]; // "수원시 영통구" → "수원시"를 고른 사람도 받도록
      if (first !== rest) topics.add(topicName('s', sido, first));
    }
  }
  return [...topics];
}

// 새로 보낼 문자를 고른다.
// - sent: 이미 처리한 문자 id 집합 (고른 문자는 여기에 추가됨)
// - primed가 false면 서버를 막 켠 첫 확인이라, 최근 primeWindowMs 안의 문자만 보내고 나머지는 처리한 것으로만 표시
export function pickNew(rows, { sent, primed, now, primeWindowMs, maxAgeMs }) {
  const out = [];
  for (const a of rows) {
    if (!a.id || sent.has(a.id)) continue;
    sent.add(a.id);
    if (!qualifies(a)) continue;
    const t = parseKst(a.createdAt);
    if (t !== null) {
      const age = now - t;
      if (age > maxAgeMs) continue; // 너무 오래된 문자는 보내지 않음
      if (!primed && age > primeWindowMs) continue; // 서버 재시작 직후 옛 문자를 다시 뿌리지 않음
    } else if (!primed) {
      continue; // 시각을 모르는 옛 문자는 첫 확인에서 제외
    }
    out.push(a);
  }
  return out;
}

// FCM 메시지 만들기. 같은 문자가 여러 토픽으로 가도 기기에서는 tag(문자 id)가 같아 한 개로 합쳐진다.
export function buildMessages(alert, topics) {
  const title = `[${alert.level}] ${alert.type || '재난'}`.slice(0, 60);
  const body = String(alert.message).slice(0, 300);
  return topics.map((topic) => ({
    topic,
    notification: { title, body },
    data: {
      kind: 'alert',
      alertId: String(alert.id),
      level: String(alert.level),
      type: String(alert.type),
      region: String(alert.region).slice(0, 500),
      message: String(alert.message).slice(0, 1500),
      createdAt: String(alert.createdAt),
    },
    android: {
      priority: 'high',
      ttl: 60 * 60 * 1000, // 1시간 안에 전달되지 못하면 버림(오래된 재난 알림 방지)
      notification: {
        channelId: 'emergency_alerts',
        tag: String(alert.id),
        priority: 'max',
        visibility: 'public',
        defaultVibrateTimings: true,
      },
    },
  }));
}
