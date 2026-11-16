import axios from 'axios';
import { API_URL, PAGE_SIZE, REGIONS, extractItems, normalize, toYmd } from './alerts.js';
import { buildMessages, pickNew, topicsForAlert } from './pushLogic.js';

// 긴급재난·위급재난 문자를 감지해서 FCM 푸시를 보낸다.
// 켜는 방법(.env):
//   PUSH_ENABLED=1
//   GOOGLE_APPLICATION_CREDENTIALS=/home/ubuntu/emap-fcm-key.json   (Firebase 서비스 계정 키 파일 경로. 레포 밖에 보관)
// 선택:
//   PUSH_POLL_MS=60000          확인 주기(기본 1분)
//   PUSH_DRY_RUN=1              Firebase 없이 "보낼 내용"만 로그로 확인
//   PUSH_PRIME_WINDOW_MIN=5     서버를 켠 직후 최근 몇 분 안의 문자는 보낼지(기본 5분)

const POLL_MS = Number(process.env.PUSH_POLL_MS) || 60_000;
const PRIME_WINDOW_MS = (Number(process.env.PUSH_PRIME_WINDOW_MIN) || 5) * 60_000;
const MAX_AGE_MS = 3 * 60 * 60 * 1000; // 3시간보다 오래된 문자는 보내지 않음
const MAX_PAGES = 10;
const MAX_SENT_IDS = 5000;

const sent = new Set(); // 이미 처리한 문자 id
let primed = false;
let messagingApi = null; // firebase-admin 의 messaging (dry-run이면 null)

// 한국 시간 기준 오늘 날짜(yyyymmdd). 서버 시간대와 상관없이 맞춘다.
const todayKst = () => toYmd(new Date(Date.now() + 9 * 3600 * 1000 + new Date().getTimezoneOffset() * 60000));

// 전국 오늘자 재난문자를 모두 받아온다 (지역 필터 없이 한 번에 → API 호출 수를 줄임)
async function fetchTodayAll() {
  const byId = new Map();
  let total = 0;
  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const { data } = await axios.get(API_URL, {
      params: {
        serviceKey: process.env.SAFETYDATA_SERVICE_KEY,
        returnType: 'json',
        pageNo,
        numOfRows: PAGE_SIZE,
        crtDt: todayKst(),
      },
      timeout: 8000,
    });
    const header = data?.header ?? data?.response?.header;
    if (header?.resultCode && String(header.resultCode) !== '00') {
      throw new Error(`API 오류 ${header.resultCode} ${header.resultMsg ?? ''}`);
    }
    const rows = extractItems(data);
    total = Number(data?.totalCount ?? rows.length);
    rows.forEach((r) => {
      const item = normalize(r);
      byId.set(item.id, item);
    });
    if (rows.length === 0 || byId.size >= total) break;
  }
  return { items: [...byId.values()], truncated: byId.size < total };
}

async function deliver(alert) {
  const topics = topicsForAlert(alert.region, REGIONS).slice(0, 500);
  if (topics.length === 0) {
    console.warn(`[push] 수신 지역을 해석하지 못해 보내지 않음: id=${alert.id} region="${alert.region}"`);
    return;
  }
  const messages = buildMessages(alert, topics);
  if (!messagingApi) {
    console.log(`[push][dry-run] ${alert.level} ${alert.type} id=${alert.id} → 토픽 ${topics.length}개`);
    console.log(`[push][dry-run] ${alert.message.slice(0, 80)}`);
    return;
  }
  const res = await messagingApi.sendEach(messages);
  console.log(
    `[push] 전송 ${alert.level} ${alert.type} id=${alert.id}: 성공 ${res.successCount}, 실패 ${res.failureCount}`
  );
  res.responses.forEach((r, i) => {
    if (!r.success) console.error(`[push] 실패 토픽=${topics[i]}: ${r.error?.code} ${r.error?.message}`);
  });
}

async function pollOnce() {
  const { items, truncated } = await fetchTodayAll();
  if (truncated) console.warn('[push] 오늘 문자가 많아 일부만 확인했습니다 (MAX_PAGES 초과)');

  const fresh = pickNew(items, {
    sent,
    primed,
    now: Date.now(),
    primeWindowMs: PRIME_WINDOW_MS,
    maxAgeMs: MAX_AGE_MS,
  });
  primed = true;

  if (sent.size > MAX_SENT_IDS) {
    // 메모리가 계속 늘지 않도록 오래된 것부터 정리
    [...sent].slice(0, sent.size - MAX_SENT_IDS).forEach((id) => sent.delete(id));
  }

  for (const alert of fresh) {
    try {
      await deliver(alert);
    } catch (e) {
      console.error(`[push] 전송 오류 id=${alert.id}:`, e.message);
    }
  }
}

export async function startPushWorker() {
  if (process.env.PUSH_ENABLED !== '1') {
    console.log('[push] 꺼짐 (.env에 PUSH_ENABLED=1을 넣으면 켜집니다)');
    return;
  }
  if (!process.env.SAFETYDATA_SERVICE_KEY) {
    console.error('[push] SAFETYDATA_SERVICE_KEY가 없어 시작하지 않습니다.');
    return;
  }

  if (process.env.PUSH_DRY_RUN === '1') {
    console.log('[push] DRY-RUN: 실제로 보내지 않고 로그만 남깁니다.');
  } else {
    try {
      // firebase-admin은 푸시를 켤 때만 불러옴 (설치 전에도 서버 자체는 정상 실행)
      const { initializeApp, applicationDefault } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      initializeApp({ credential: applicationDefault() });
      messagingApi = getMessaging();
    } catch (e) {
      console.error('[push] Firebase 초기화 실패 → 푸시를 시작하지 않습니다:', e.message);
      return;
    }
  }

  console.log(`[push] 시작: ${POLL_MS / 1000}초마다 확인`);
  const loop = async () => {
    try {
      await pollOnce();
    } catch (e) {
      console.error('[push] 확인 실패:', e.response?.status, e.message);
    } finally {
      setTimeout(loop, POLL_MS);
    }
  };
  loop();
}
