// 테스트 푸시 보내기 (VM의 server 폴더에서 실행)
//   node src/scripts/sendTestPush.js
//   PUSH_DRY_RUN=1 node src/scripts/sendTestPush.js     → 보내지 않고 내용만 확인
// 전국 모든 기기(앱을 한 번이라도 실행해 푸시를 구독한 기기)에 "[테스트]" 위급재난 알림이 갑니다.
import 'dotenv/config';
import { NATIONWIDE_TOPIC, buildMessages } from '../pushLogic.js';

const alert = {
  id: `push-test-${Date.now()}`,
  createdAt: '',
  level: '위급재난',
  type: '지진',
  region: '전국(테스트)',
  message: '[테스트] 푸시 알림 확인용입니다. 실제 재난 상황이 아닙니다.',
};
const messages = buildMessages(alert, [NATIONWIDE_TOPIC]);
console.log('대상 토픽:', NATIONWIDE_TOPIC);

if (process.env.PUSH_DRY_RUN === '1') {
  console.log('DRY-RUN: 보내지 않았습니다.');
  process.exit(0);
}

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getMessaging } = await import('firebase-admin/messaging');
initializeApp({ credential: applicationDefault() });

const res = await getMessaging().sendEach(messages);
console.log(`성공 ${res.successCount}, 실패 ${res.failureCount}`);
res.responses.forEach((r) => {
  if (!r.success) console.error(NATIONWIDE_TOPIC, r.error?.code, r.error?.message);
});
process.exit(res.failureCount > 0 ? 1 : 0);
