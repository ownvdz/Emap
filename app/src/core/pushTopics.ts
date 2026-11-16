// 푸시 토픽 이름. 서버의 server/src/pushLogic.js 의 NATIONWIDE_TOPIC 과 반드시 같아야 한다.
// 긴급재난·위급재난은 지역과 관계없이 전국 모든 기기에 보내므로 토픽은 하나다.
export const NATIONWIDE_TOPIC = 'alert_all';
