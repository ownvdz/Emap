import { getItem, setItem } from './storage';

// 선택한 지역, 이미 확인한 문자 목록, 개발용 테스트 신호를 화면들이 같이 쓰기 위한 작은 저장소

const REGION_KEY = 'emap.alertRegion';
const SUB_KEY = 'emap.alertSub';
const SEEN_KEY = 'emap.seenAlerts';
const MAX_SEEN = 200;

export type AlertSettings = { region: string; sub: string };

let settings: AlertSettings = { region: '', sub: '' };
let loadPromise: Promise<AlertSettings> | null = null;
const settingsListeners = new Set<() => void>();

const notifySettings = () => settingsListeners.forEach(fn => fn());

export function getSettings(): AlertSettings {
  return settings;
}

// 저장된 지역을 한 번만 읽어온다 (여러 화면이 불러도 같은 결과를 공유)
export function loadSettings(): Promise<AlertSettings> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const [region, sub] = await Promise.all([getItem(REGION_KEY), getItem(SUB_KEY)]);
      settings = { region: region ?? '', sub: sub ?? '' };
      notifySettings();
      return settings;
    })();
  }
  return loadPromise;
}

export async function saveSettings(next: AlertSettings): Promise<void> {
  settings = next;
  loadPromise = Promise.resolve(next); // 읽기가 끝나기 전에 바꿔도 새 값이 덮어쓰이지 않게
  notifySettings();
  await Promise.all([setItem(REGION_KEY, next.region), setItem(SUB_KEY, next.sub)]);
}

export function subscribeSettings(fn: () => void): () => void {
  settingsListeners.add(fn);
  return () => {
    settingsListeners.delete(fn);
  };
}

// 이미 확인한 문자 id
let seenCache: string[] | null = null;

export async function readSeen(): Promise<string[]> {
  if (!seenCache) {
    try {
      const v = JSON.parse((await getItem(SEEN_KEY)) ?? '[]');
      seenCache = Array.isArray(v) ? v.map(String) : [];
    } catch {
      seenCache = [];
    }
  }
  return seenCache;
}

export async function addSeen(id: string): Promise<void> {
  const list = await readSeen();
  if (list.includes(id)) {
    return;
  }
  seenCache = [...list, id].slice(-MAX_SEEN);
  await setItem(SEEN_KEY, JSON.stringify(seenCache));
}

// 개발용: 팝업을 눈으로 확인하기 위한 테스트 신호
const testListeners = new Set<(type: string) => void>();

export function triggerTestAlert(type: string) {
  testListeners.forEach(fn => fn(type));
}

export function subscribeTestAlert(fn: (type: string) => void): () => void {
  testListeners.add(fn);
  return () => {
    testListeners.delete(fn);
  };
}
