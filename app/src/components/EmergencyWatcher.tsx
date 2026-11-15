import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { apiGet } from '../api';
import {
  LEVEL_COLOR,
  POLL_MS,
  POPUP_WINDOW_MS,
  isDrill,
  makeTestAlert,
  parseKst,
  priority,
  sortQueue,
  type Alert,
  type AlertResponse,
} from '../core/alerts';
import {
  addSeen,
  getSettings,
  loadSettings,
  readSeen,
  subscribeSettings,
  subscribeTestAlert,
} from '../core/alertStore';
import type { Category } from '../core/categories';
import { GENERIC_GUIDANCE, GUIDANCE } from '../core/guidance';
import { requestMap } from '../core/mapBus';

// 어느 탭에 있어도 내 지역의 위급 문자를 감시하고 팝업으로 알려준다.
export default function EmergencyWatcher({ onShowMap }: { onShowMap: () => void }) {
  const [queue, setQueue] = useState<Alert[]>([]);
  const [busy, setBusy] = useState(false);
  const known = useRef(new Set<string>()); // 이번 실행에서 이미 큐에 넣은 문자 id

  const poll = useCallback(async () => {
    const { region, sub } = getSettings();
    if (!region) {
      return;
    }
    try {
      const params: Record<string, string> = { region };
      if (sub) {
        params.sub = sub;
      }
      const data = await apiGet<AlertResponse>('/api/alerts', params, { timeoutMs: 15000 });

      // 응답을 기다리는 사이에 지역을 바꿨다면 이전 지역의 결과는 버린다
      const now = getSettings();
      if (now.region !== region || now.sub !== sub) {
        return;
      }

      const seen = new Set(await readSeen());
      const nowMs = Date.now();
      const fresh = data.items.filter(a => {
        if (priority(a) === 0 || seen.has(a.id) || known.current.has(a.id)) {
          return false;
        }
        const t = parseKst(a.createdAt);
        return t === null || t >= nowMs - POPUP_WINDOW_MS; // 시각을 못 읽으면 놓치지 않도록 포함
      });
      if (fresh.length === 0) {
        return;
      }

      fresh.forEach(a => known.current.add(a.id));
      try {
        Vibration.vibrate([0, 300, 150, 300, 150, 300]);
      } catch {
        /* 진동을 쓸 수 없어도 팝업은 그대로 동작 */
      }
      setQueue(prev => sortQueue([...prev, ...fresh]));
    } catch {
      /* 다음 주기에 다시 시도 */
    }
  }, []);

  // 저장된 지역을 읽고, 화면이 켜져 있는 동안 1분마다 확인
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer) {
        return;
      }
      poll();
      timer = setInterval(poll, POLL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    loadSettings().then(() => {
      if (AppState.currentState === 'active') {
        start();
      }
    });

    const appSub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        start();
      } else {
        stop();
      }
    });

    // 지역을 바꾸면 이전 지역의 대기 문자를 지우고 바로 다시 확인
    const unsubSettings = subscribeSettings(() => {
      known.current.clear();
      setQueue(q => q.filter(a => a.isTest));
      poll();
    });

    return () => {
      stop();
      appSub.remove();
      unsubSettings();
    };
  }, [poll]);

  // 개발용 테스트 팝업
  useEffect(
    () =>
      subscribeTestAlert(type => {
        const test = makeTestAlert(type);
        setQueue(q => (q.some(a => a.id === test.id) ? q : sortQueue([...q, test])));
      }),
    [],
  );

  const current = queue[0];

  const dismiss = useCallback((a: Alert) => {
    if (!a.isTest) {
      addSeen(a.id);
    }
    setQueue(q => q.filter(x => x.id !== a.id));
  }, []);

  if (!current) {
    return null;
  }

  const guidance = GUIDANCE[current.type] ?? GENERIC_GUIDANCE;
  const color = LEVEL_COLOR[current.level] ?? '#6B7280';

  // 선택한 지역의 해당 종류 대피장소 중심으로 지도를 연다 (현재 위치 기준은 다음 단계)
  const showShelters = async (category: Category) => {
    if (busy) {
      return;
    }
    setBusy(true);
    const { region, sub } = getSettings();
    let center: { lat: number; lng: number } | undefined;
    let note: string | undefined;

    if (region) {
      try {
        const params: Record<string, string> = { region, category };
        if (sub) {
          params.sub = sub;
        }
        const d = await apiGet<{ count: number; lat: number; lng: number }>(
          '/api/map-center',
          params,
          { timeoutMs: 8000 },
        );
        if (d.count > 0) {
          center = { lat: d.lat, lng: d.lng };
        } else {
          note = '선택한 지역에 이 종류의 대피장소 데이터가 없습니다.';
        }
      } catch {
        note = '선택한 지역의 중심을 구하지 못했습니다. 지도에서 직접 이동해주세요.';
      }
    } else {
      note = '재난문자 지역을 선택하지 않아 지도를 현재 위치 그대로 엽니다.';
    }

    setBusy(false);
    dismiss(current);
    requestMap({ categories: [category], center, note, nonce: Date.now() });
    onShowMap();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => dismiss(current)}>
      <View style={styles.overlay}>
        <View style={[styles.card, { borderTopColor: color }]}>
          <ScrollView>
            <View style={styles.row}>
              <View style={[styles.badge, { backgroundColor: color }]}>
                <Text style={styles.badgeText}>{current.level}</Text>
              </View>
              {current.isTest ? (
                <View style={[styles.badge, { backgroundColor: '#111827' }]}>
                  <Text style={styles.badgeText}>테스트</Text>
                </View>
              ) : null}
              {isDrill(current) && !current.isTest ? (
                <View style={[styles.badge, { backgroundColor: '#6B7280' }]}>
                  <Text style={styles.badgeText}>훈련</Text>
                </View>
              ) : null}
              {queue.length > 1 ? (
                <Text style={styles.more}>대기 중 {queue.length - 1}건 더 있음</Text>
              ) : null}
            </View>

            <Text style={styles.title}>{current.type || '재난'} 알림</Text>
            {current.createdAt ? <Text style={styles.time}>{current.createdAt}</Text> : null}

            {/* 문자 원문은 가공하지 않고 그대로 표시 */}
            <Text style={styles.message}>{current.message}</Text>

            <Text style={styles.guideTitle}>{guidance.title}</Text>
            {guidance.steps.map((s, i) => (
              <View key={s} style={styles.step}>
                <Text style={styles.stepNo}>{i + 1}.</Text>
                <Text style={styles.stepText}>{s}</Text>
              </View>
            ))}

            {guidance.note ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteText}>{guidance.note}</Text>
              </View>
            ) : null}

            <Text style={styles.source}>
              출처: {guidance.sourceLabel} 요약 ·{' '}
              <Text style={styles.link} onPress={() => Linking.openURL(guidance.sourceUrl).catch(() => {})}>
                공식 행동요령 전문 보기
              </Text>
            </Text>

            <View style={styles.buttons}>
              {(guidance.shelters ?? []).map(s => (
                <TouchableOpacity
                  key={s.category}
                  style={[styles.btn, { backgroundColor: color, opacity: busy ? 0.7 : 1 }]}
                  disabled={busy}
                  onPress={() => showShelters(s.category)}>
                  <Text style={styles.btnText}>{busy ? '지도를 여는 중…' : s.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.btnGhost} onPress={() => dismiss(current)}>
                <Text style={styles.btnGhostText}>확인했습니다</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.disclaimer}>
              공식 재난문자·방송·정부 안내가 항상 우선입니다. 이 화면은 보조 수단이며 지연되거나 누락될 수
              있습니다.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 14,
  },
  card: {
    maxHeight: '92%',
    backgroundColor: '#fff',
    borderRadius: 16,
    borderTopWidth: 6,
    padding: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 12 },
  more: { marginLeft: 'auto', fontSize: 12, color: '#6b7280' },
  title: { marginTop: 10, fontSize: 19, fontWeight: '700', color: '#111' },
  time: { marginTop: 2, fontSize: 12, color: '#6b7280' },
  message: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    fontSize: 14,
    lineHeight: 21,
    color: '#111',
  },
  guideTitle: { marginTop: 14, marginBottom: 6, fontSize: 15, fontWeight: '700', color: '#111' },
  step: { flexDirection: 'row', marginBottom: 4 },
  stepNo: { width: 22, fontSize: 14, color: '#111' },
  stepText: { flex: 1, fontSize: 14, lineHeight: 21, color: '#111' },
  noteBox: { marginTop: 8, padding: 8, borderRadius: 8, backgroundColor: '#FEF3C7' },
  noteText: { fontSize: 13, color: '#92400E', lineHeight: 19 },
  source: { marginTop: 10, fontSize: 12, color: '#6b7280', lineHeight: 18 },
  link: { color: '#1565c0', textDecorationLine: 'underline' },
  buttons: { marginTop: 14, gap: 8 },
  btn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 15 },
  btnGhost: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
  },
  btnGhostText: { fontSize: 15, color: '#111' },
  disclaimer: { marginTop: 10, fontSize: 11, color: '#9ca3af', lineHeight: 17 },
});
