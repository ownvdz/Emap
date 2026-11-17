import { PermissionsAndroid, Platform } from 'react-native';
import {
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  subscribeToTopic,
  unsubscribeFromTopic,
} from '@react-native-firebase/messaging';
import type { Alert } from './alerts';
import { getItem, setItem } from './storage';
import { NATIONWIDE_TOPIC } from './pushTopics';

// 서버가 보낸 긴급재난·위급재난 푸시를 받아서 기존 팝업(EmergencyWatcher)으로 넘긴다.
// 전국 공통 FCM 토픽을 구독하는 방식이라, 기기 정보를 서버에 따로 저장하지 않는다.

// ---------- 푸시 → 팝업 전달 ----------
const alertListeners = new Set<(a: Alert) => void>();
let pendingAlerts: Alert[] = []; // 화면이 아직 듣고 있지 않을 때(앱이 막 켜졌을 때) 받은 것

function emitAlert(a: Alert) {
  if (alertListeners.size === 0) {
    pendingAlerts.push(a);
    return;
  }
  alertListeners.forEach(fn => fn(a));
}

export function subscribePushAlert(fn: (a: Alert) => void): () => void {
  alertListeners.add(fn);
  if (pendingAlerts.length > 0) {
    const list = pendingAlerts;
    pendingAlerts = [];
    list.forEach(fn);
  }
  return () => {
    alertListeners.delete(fn);
  };
}

type PushMessage = { data?: Record<string, unknown> } | null | undefined;

function toAlert(msg: PushMessage): Alert | null {
  const d = msg?.data;
  if (!d || d.kind !== 'alert' || !d.alertId) {
    return null;
  }
  return {
    id: String(d.alertId),
    createdAt: String(d.createdAt ?? ''),
    message: String(d.message ?? ''),
    region: String(d.region ?? ''),
    level: String(d.level ?? ''),
    type: String(d.type ?? ''),
  };
}

// ---------- 알림 권한 (안드로이드 13 이상) ----------
let askedPermission = false; // 앱을 켜 둔 동안 같은 권한 창을 반복해서 띄우지 않음

async function ensureNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return;
  }
  try {
    if (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS)) {
      return;
    }
    if (askedPermission) {
      return;
    }
    askedPermission = true;
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    /* 권한 요청이 실패해도 앱은 계속 동작 */
  }
}

// ---------- 토픽 구독 ----------
const TOPICS_KEY = 'emap.pushTopics';

async function readSaved(): Promise<string[]> {
  try {
    const v = JSON.parse((await getItem(TOPICS_KEY)) ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

// 응답이 끝내 오지 않는 호출 때문에 화면이 멈추지 않도록 시간 제한을 둔다
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: ${ms / 1000}초 안에 응답 없음`)), ms);
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

let chain: Promise<void> = Promise.resolve();
let lastError = ''; // 마지막 구독 실패 원인 (상태 확인 화면에 표시)
let lastOkAt = '';
let lastStep = ''; // 마지막으로 시작한 단계 (멈춘 위치 확인용)

// 전국 토픽을 구독한다 (한 번만 성공하면 저장해 두고, 실패하면 다음에 다시 시도).
// 이전 버전에서 구독했던 지역별 토픽이 있으면 함께 해지한다.
export function syncPushTopics(): Promise<void> {
  chain = chain.then(async () => {
    try {
      lastStep = '알림 권한 확인';
      await withTimeout(ensureNotificationPermission(), 20000, '알림 권한').catch(e => {
        lastError = (e as Error).message; // 권한 확인이 멈춰도 구독은 계속 시도
      });
      lastStep = '저장된 구독 읽기';
      const prev = await readSaved();
      lastStep = 'Firebase 연결';
      const messaging = getMessaging();
      for (const t of prev.filter(t => t !== NATIONWIDE_TOPIC)) {
        lastStep = `구독 해지(${t})`;
        await withTimeout(unsubscribeFromTopic(messaging, t), 15000, '구독 해지');
      }
      if (!prev.includes(NATIONWIDE_TOPIC)) {
        lastStep = '전국 토픽 구독';
        await withTimeout(subscribeToTopic(messaging, NATIONWIDE_TOPIC), 15000, '토픽 구독');
      }
      lastStep = '구독 저장';
      await setItem(TOPICS_KEY, JSON.stringify([NATIONWIDE_TOPIC]));
      lastError = '';
      lastOkAt = new Date().toLocaleTimeString('ko-KR');
    } catch (e) {
      // 인터넷이 없거나 Firebase 설정이 빠진 경우: 저장하지 않아서 다음에 다시 시도한다 (앱은 계속 동작)
      lastError = (e as Error)?.message ?? String(e);
    }
  });
  return chain;
}

// 푸시가 왜 안 오는지 확인하기 위한 상태 (홈 화면의 '푸시 상태 확인')
export async function getPushStatus(): Promise<string> {
  const lines: string[] = [`안드로이드 ${Platform.Version}`];
  try {
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const ok = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      lines.push(`알림 권한: ${ok ? '허용' : '허용 안 됨'}`);
    } else {
      lines.push('알림 권한: 별도 요청 불필요');
    }
  } catch (e) {
    lines.push(`알림 권한 확인 실패: ${(e as Error).message}`);
  }
  lines.push(`저장된 구독: ${(await readSaved()).join(', ') || '없음'}`);
  lines.push(lastOkAt ? `마지막 구독 성공: ${lastOkAt}` : '이번 실행에서 구독 성공 기록 없음');
  if (lastStep) {
    lines.push(`마지막 진행 단계: ${lastStep}`);
  }
  if (lastError) {
    lines.push(`구독 오류: ${lastError}`);
  }
  try {
    const token = (await withTimeout(getToken(getMessaging()), 10000, '기기 토큰 발급')) as string;
    lines.push(token ? `기기 토큰: …${token.slice(-8)}` : '기기 토큰: 없음');
  } catch (e) {
    lines.push(`기기 토큰 오류: ${(e as Error).message}`);
  }
  return lines.join('\n');
}

// ---------- 시작 ----------
let started = false;

export function initPush(): () => void {
  if (started) {
    return () => {};
  }
  started = true;
  const messaging = getMessaging();
  const offs: Array<() => void> = [];

  // 앱을 보고 있는 동안 도착한 푸시 → 알림창 없이 바로 팝업
  offs.push(
    onMessage(messaging, async msg => {
      const a = toAlert(msg as PushMessage);
      if (a) {
        emitAlert(a);
      }
    }),
  );
  // 백그라운드에서 알림을 눌러 앱이 열린 경우
  offs.push(
    onNotificationOpenedApp(messaging, msg => {
      const a = toAlert(msg as PushMessage);
      if (a) {
        emitAlert(a);
      }
    }),
  );
  // 앱이 완전히 꺼진 상태에서 알림을 눌러 앱이 시작된 경우
  getInitialNotification(messaging)
    .then(msg => {
      const a = toAlert(msg as PushMessage);
      if (a) {
        emitAlert(a);
      }
    })
    .catch(() => {});

  // 전국 토픽 구독 (실패했다면 앱을 켤 때마다 다시 시도)
  syncPushTopics();

  return () => {
    offs.forEach(off => off());
    started = false;
  };
}
