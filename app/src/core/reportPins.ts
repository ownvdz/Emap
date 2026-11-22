import type { Report } from './reports';

// "지도에 반영"을 누른 요청 목록. 지도 탭이 이 목록을 구독해서 핀으로 그린다.
const pins = new Map<string, Report>();
const listeners = new Set<() => void>();
let version = 0;
let snapshot: Report[] = [];

function emit() {
  version++;
  snapshot = [...pins.values()];
  listeners.forEach(fn => fn());
}

export function getPins(): Report[] {
  return snapshot;
}
export function getPinsVersion(): number {
  return version;
}

export function addPin(r: Report) {
  pins.set(r.id, r);
  emit();
}

export function removePin(id: string) {
  if (pins.delete(id)) {
    emit();
  }
}

export function clearPins() {
  if (pins.size > 0) {
    pins.clear();
    emit();
  }
}

export function hasPin(id: string): boolean {
  return pins.has(id);
}

// 목록에서 사라진(해결·만료된) 요청의 핀을 지운다. active에 없는 id는 모두 제거
export function prunePins(activeIds: Set<string>) {
  let changed = false;
  pins.forEach((_, id) => {
    if (!activeIds.has(id)) {
      pins.delete(id);
      changed = true;
    }
  });
  if (changed) {
    emit();
  }
}

export function subscribePins(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
