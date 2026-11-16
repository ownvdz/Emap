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
import { getSettings, loadSettings, subscribeSettings } from './alertStore';
import { getItem, setItem } from './storage';
import { topicsFor } from './pushTopics';

// 서버가 보낸 긴급재난·위급재난 푸시를 받아서 기존 팝업(EmergencyWatcher)으로 넘긴다.
// 선택한 지역에 맞는 FCM 토픽을 구독하는 방식이라, 기기 정보를 서버에 따로 저장하지 않는다.

const TOPICS_KEY = 'emap.pushTopics';

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
async function ensureNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return;
  }
  try {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  } catch {
    /* 권한 요청이 실패해도 앱은 계속 동작 */
  }
}

// ---------- 토픽 구독 동기화 ----------
async function readSaved(): Promise<string[]> {
  try {
    const v = JSON.parse((await getItem(TOPICS_KEY)) ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

let chain: Promise<void> = Promise.resolve();

// 선택한 지역이 바뀔 때마다 이전 지역은 구독 해지하고 새 지역을 구독한다 (한 번에 하나씩 순서대로)
export function syncPushTopics(): Promise<void> {
  chain = chain.then(async () => {
    const keep: string[] = [];
    try {
      const { region, sub } = getSettings();
      const next = topicsFor(region, sub);
      const prev = await readSaved();
      if (next.length > 0) {
        await ensureNotificationPermission();
      }
      const messaging = getMessaging();
      for (const t of prev.filter(t => !next.includes(t))) {
        await unsubscribeFromTopic(messaging, t);
      }
      for (const t of next) {
        if (!prev.includes(t)) {
          await subscribeToTopic(messaging, t);
        }
        keep.push(t);
      }
      await setItem(TOPICS_KEY, JSON.stringify(keep));
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

  // 지역 선택에 맞춰 구독
  loadSettings().then(() => syncPushTopics());
  offs.push(subscribeSettings(() => syncPushTopics()));

  return () => {
    offs.forEach(off => off());
    started = false;
  };
}
