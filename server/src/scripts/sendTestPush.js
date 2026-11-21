// 테스트 푸시 보내기 (VM의 server 폴더에서 실행)
//   node src/scripts/sendTestPush.js
//   PUSH_DRY_RUN=1 node src/scripts/sendTestPush.js     → 보내지 않고 대상 수만 확인
// 앱을 실행해 토큰을 등록한 모든 기기에 "[테스트]" 위급재난 알림이 갑니다.
import 'dotenv/config';
import { buildMessages } from '../pushLogic.js';
import { listTokens, removeTokens } from '../pushStore.js';

const tokens = await listTokens();
console.log(`등록된 기기: ${tokens.length}대`);
if (tokens.length === 0) process.exit(0);

if (process.env.PUSH_DRY_RUN === '1') {
  console.log('DRY-RUN: 보내지 않았습니다.');
  process.exit(0);
}

const alert = {
  id: `push-test-${Date.now()}`,
  createdAt: '',
  level: '위급재난',
  type: '지진',
  region: '전국(테스트)',
  message: '[테스트] 푸시 알림 확인용입니다. 실제 재난 상황이 아닙니다.',
};

const { initializeApp, applicationDefault } = await import('firebase-admin/app');
const { getMessaging } = await import('firebase-admin/messaging');
initializeApp({ credential: applicationDefault() });

const DEAD = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);
let ok = 0;
let fail = 0;
const dead = [];
for (let i = 0; i < tokens.length; i += 500) {
  const chunk = tokens.slice(i, i + 500);
  const res = await getMessaging().sendEach(buildMessages(alert, chunk.map((token) => ({ token }))));
  ok += res.successCount;
  fail += res.failureCount;
  res.responses.forEach((r, j) => {
    if (r.success) return;
    if (DEAD.has(r.error?.code)) dead.push(chunk[j]);
    console.error(`…${chunk[j].slice(-6)}`, r.error?.code, r.error?.message);
  });
}
if (dead.length) console.log(`무효 토큰 ${await removeTokens(dead)}개 삭제`);
console.log(`성공 ${ok}, 실패 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
