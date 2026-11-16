// 푸시 토픽 이름 규칙. 서버의 server/src/pushLogic.js 와 반드시 같아야 한다.
// FCM 토픽에는 [a-zA-Z0-9-_.~%] 만 쓸 수 있어서 한글 지역명은 퍼센트 인코딩한다.
const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

type Kind = 'a' | 'w' | 's';

export function topicName(kind: Kind, sido: string, sub = ''): string {
  return sub ? `${kind}_${enc(sido)}_${enc(sub)}` : `${kind}_${enc(sido)}`;
}

// 선택한 지역에 해당하는 구독 토픽
// - 시도만 선택: 그 시도로 온 모든 문자 (a)
// - 시군구까지 선택: 시도 전체로 온 문자 (w) + 그 시군구로 온 문자 (s)
export function topicsFor(region: string, sub: string): string[] {
  if (!region) {
    return [];
  }
  if (!sub) {
    return [topicName('a', region)];
  }
  return [topicName('w', region), topicName('s', region, sub)];
}
