// 테스트 푸시 보내기 (VM의 server 폴더에서 실행)
//   node src/scripts/sendTestPush.js 서울특별시            → 서울 전체를 선택한 기기에 전송
//   node src/scripts/sendTestPush.js 서울특별시 강남구      → 강남구를 선택한 기기(와 서울 전체 선택 기기)에 전송
//   PUSH_DRY_RUN=1 node src/scripts/sendTestPush.js 서울특별시   → 보내지 않고 토픽만 확인
// 실제 문자가 아니라 "[테스트]"라고 표시된 위급재난 알림이 갑니다.
import 'dotenv/config';
import { REGIONS } from '../alerts.js';
import { buildMessages, topicsForAlert } from '../pushLogic.js';

const [sido, sub = ''] = process.argv.slice(2);
if (!REGIONS.includes(sido)) {
  console.error(`시도 이름을 정확히 입력하세요. 예: ${REGIONS[0]}`);
  process.exit(1);
}

const alert = {
  id: `push-test-${Date.now()}`,
  createdAt: '',
  level: '위급재난',
  type: '지진',
  region: `${sido} ${sub || '전체'}`,
  message: '[테스트] 푸시 알림 확인용입니다. 실제 재난 상황이 아닙니다.',
};

const topics = topicsForAlert(alert.region, REGIONS);
console.log('대상 토픽:', topics.join(', '));

if (process.env.PUSH_DRY_RUN === '1') {
  console.log('DRY-RUN: 보내지 않았습니다.');
  process.exit(0);
}

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getMessaging } = await import('firebase-admin/messaging');
initializeApp({ credential: applicationDefault() });

const res = await getMessaging().sendEach(buildMessages(alert, topics));
console.log(`성공 ${res.successCount}, 실패 ${res.failureCount}`);
res.responses.forEach((r, i) => {
  if (!r.success) console.error(topics[i], r.error?.code, r.error?.message);
});
process.exit(res.failureCount > 0 ? 1 : 0);
