import { AppState, PermissionsAndroid, Platform } from 'react-native';
import {
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
} from '@react-native-firebase/messaging';
import { API_BASE_URL } from '../config';
import type { Alert } from './alerts';

// 서버가 보낸 긴급재난·위급재난 푸시를 받아서 기존 팝업(EmergencyWatcher)으로 넘긴다.
// 앱이 켜질 때 이 기기의 FCM 토큰을 서버에 등록하면, 서버가 새 문자가 올 때 등록된 모든 기기에 보낸다.
// (토픽 구독 방식은 일부 기기에서 응답이 끝내 오지 않아 쓰지 않는다)

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

// ---------- 서버에 기기 등록 ----------
let chain: Promise<void> = Promise.resolve();
let lastError = ''; // 마지막 등록 실패 원인 (상태 확인 화면에 표시)
let lastOkAt = '';
let lastStep = ''; // 마지막으로 시작한 단계 (멈춘 위치 확인용)
let tokenTail = '';

async function postToken(token: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${API_BASE_URL}/api/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`서버 응답 HTTP ${res.status}`);
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new Error('서버 등록: 15초 안에 응답 없음');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// 이 기기의 FCM 토큰을 받아 서버에 등록한다 (앱을 켤 때마다. 실패하면 다음에 다시 시도)
export function syncPush(): Promise<void> {
  chain = chain.then(async () => {
    try {
      lastStep = '알림 권한 확인';
      await withTimeout(ensureNotificationPermission(), 20000, '알림 권한').catch(e => {
        lastError = (e as Error).message; // 권한 확인이 멈춰도 등록은 계속 시도
      });
      lastStep = '기기 토큰 발급';
      const token = (await withTimeout(getToken(getMessaging()), 15000, '기기 토큰 발급')) as string;
      if (!token) {
        throw new Error('기기 토큰이 비어 있습니다.');
      }
      tokenTail = token.slice(-8);
      lastStep = '서버에 등록';
      await postToken(token);
      lastError = '';
      lastOkAt = new Date().toLocaleTimeString('ko-KR');
    } catch (e) {
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
  lines.push(lastOkAt ? `서버 등록 성공: ${lastOkAt}` : '이번 실행에서 서버 등록 성공 기록 없음');
  if (lastStep) {
    lines.push(`마지막 진행 단계: ${lastStep}`);
  }
  if (lastError) {
    lines.push(`오류: ${lastError}`);
  }
  if (tokenTail) {
    lines.push(`기기 토큰: …${tokenTail}`);
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

  // 기기 등록: 시작할 때, 토큰이 바뀔 때, 실패했다면 앱으로 돌아올 때 다시
  syncPush();
  offs.push(onTokenRefresh(messaging, () => syncPush()));
  const appSub = AppState.addEventListener('change', state => {
    if (state === 'active' && !lastOkAt) {
      syncPush();
    }
  });

  return () => {
    offs.forEach(off => off());
    appSub.remove();
    started = false;
  };
}
