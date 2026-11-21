// 푸시 알림의 순수 로직 (네트워크·Firebase 없이 테스트할 수 있도록 따로 둠)

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

// FCM 메시지 만들기. targets는 [{ token }] 처럼 FCM이 받는 대상 필드 객체의 배열이다.
// 같은 문자가 두 번 가도 기기에서는 tag(문자 id)가 같아 한 개로 합쳐진다.
export function buildMessages(alert, targets) {
  const title = `[${alert.level}] ${alert.type || '재난'}`.slice(0, 60);
  const body = String(alert.message).slice(0, 300);
  return targets.map((target) => ({
    ...target,
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
