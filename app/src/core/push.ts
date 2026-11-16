import { PermissionsAndroid, Platform } from 'react-native';
import {
  getInitialNotification,
  getMessaging,
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

let chain: Promise<void> = Promise.resolve();

// 전국 토픽을 구독한다 (한 번만 성공하면 저장해 두고, 실패하면 다음에 다시 시도).
// 이전 버전에서 구독했던 지역별 토픽이 있으면 함께 해지한다.
export function syncPushTopics(): Promise<void> {
  chain = chain.then(async () => {
    try {
      await ensureNotificationPermission();
      const prev = await readSaved();
      const messaging = getMessaging();
      for (const t of prev.filter(t => t !== NATIONWIDE_TOPIC)) {
        await unsubscribeFromTopic(messaging, t);
      }
      if (!prev.includes(NATIONWIDE_TOPIC)) {
        await subscribeToTopic(messaging, NATIONWIDE_TOPIC);
      }
      await setItem(TOPICS_KEY, JSON.stringify([NATIONWIDE_TOPIC]));
    } catch {
      // 인터넷이 없거나 Firebase 설정이 빠진 경우: 저장하지 않아서 다음에 다시 시도한다 (앱은 계속 동작)
    }
  });
  return chain;
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
