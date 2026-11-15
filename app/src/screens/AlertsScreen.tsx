import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiGet } from '../api';
import { LEVEL_COLOR, POLL_MS, REGIONS, type Alert, type AlertResponse } from '../core/alerts';
import {
  getSettings,
  loadSettings,
  saveSettings,
  subscribeSettings,
  triggerTestAlert,
} from '../core/alertStore';

type PickerKind = 'region' | 'sub' | null;

export default function AlertsScreen() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();

  const [region, setRegion] = useState(getSettings().region);
  const [sub, setSub] = useState(getSettings().sub);
  const [tree, setTree] = useState<Record<string, string[]>>({});
  const [data, setData] = useState<AlertResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [picker, setPicker] = useState<PickerKind>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 저장된 지역을 읽고, 다른 화면에서 지역이 바뀌어도 따라가기
  useEffect(() => {
    const sync = () => {
      const s = getSettings();
      setRegion(s.region);
      setSub(s.sub);
    };
    loadSettings().then(sync);
    return subscribeSettings(sync);
  }, []);

  // 시도별 시군구 목록 (실패해도 시도 선택은 계속 동작)
  useEffect(() => {
    apiGet<Record<string, string[]>>('/api/regions')
      .then(setTree)
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!region) {
      return;
    }
    abortRef.current?.abort(); // 지역을 바꿨을 때 이전 요청이 섞이지 않게 취소
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const params: Record<string, string> = { region };
      if (sub) {
        params.sub = sub;
      }
      const res = await apiGet<AlertResponse>('/api/alerts', params, {
        signal: controller.signal,
        timeoutMs: 15000,
      });
      if (abortRef.current !== controller) {
        return;
      }
      setData(res);
      setError(null);
      setUpdatedAt(new Date());
    } catch {
      if (controller.signal.aborted) {
        return;
      }
      setError('재난문자를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [region, sub]);

  // 지역이 바뀌면 이전 지역의 문자를 지움
  useEffect(() => {
    setData(null);
    setError(null);
  }, [region, sub]);

  // 이 탭을 보고 있는 동안 1분마다 새로 확인
  useEffect(() => {
    if (!region || !focused) {
      return;
    }
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      clearInterval(timer);
      abortRef.current?.abort();
    };
  }, [region, sub, focused, load]);

  const chooseRegion = (value: string) => {
    setPicker(null);
    if (value !== region) {
      saveSettings({ region: value, sub: '' }); // 시도를 바꾸면 시군구는 '전체'로
    }
  };

  const chooseSub = (value: string) => {
    setPicker(null);
    if (value !== sub) {
      saveSettings({ region, sub: value });
    }
  };

  // 저장돼 있던 시군구가 목록에 없더라도 선택값이 사라지지 않게 포함
  const known = tree[region] ?? [];
  const subOptions = sub && !known.includes(sub) ? [sub, ...known] : known;

  const renderItem = ({ item: a }: { item: Alert }) => (
    <View style={styles.item}>
      <View style={styles.itemHead}>
        <View style={[styles.badge, { backgroundColor: LEVEL_COLOR[a.level] ?? '#6B7280' }]}>
          <Text style={styles.badgeText}>{a.level || '구분 없음'}</Text>
        </View>
        {a.type ? <Text style={styles.type}>{a.type}</Text> : null}
        <Text style={styles.time}>{a.createdAt}</Text>
      </View>
      <Text style={styles.message}>{a.message}</Text>
      {a.region ? <Text style={styles.rgn}>수신 지역: {a.region}</Text> : null}
    </View>
  );

  const header = (
    <View>
      <Text style={styles.title}>내 지역 재난문자</Text>

      <View style={styles.selects}>
        <TouchableOpacity style={styles.select} onPress={() => setPicker('region')}>
          <Text style={[styles.selectText, !region && styles.placeholder]} numberOfLines={1}>
            {region || '시/도 선택'}
          </Text>
          <Text style={styles.caret}>▾</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.select, !region && styles.selectDisabled]}
          disabled={!region}
          onPress={() => setPicker('sub')}>
          <Text style={styles.selectText} numberOfLines={1}>
            {sub || '전체'}
          </Text>
          <Text style={styles.caret}>▾</Text>
        </TouchableOpacity>
      </View>

      {!region ? (
        <Text style={styles.hint}>
          지역을 선택하면 해당 지역의 최근 재난문자를 보여드리고, 지진·지진해일·민방공 같은 위급 문자는
          앱을 켜 둔 동안 팝업으로 알려드립니다.
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {data?.stale ? (
        <Text style={styles.warn}>최신 정보를 가져오지 못해 이전에 받은 내용을 보여주고 있습니다.</Text>
      ) : null}
      {region && data && data.items.length === 0 && !error ? (
        <Text style={styles.hint}>
          최근 {data.lookbackDays ?? 3}일 동안 {region}
          {sub ? ` ${sub}` : ''}(으)로 발송된 재난문자가 없습니다.
        </Text>
      ) : null}

      {__DEV__ ? (
        <View style={styles.devRow}>
          <Text style={styles.devLabel}>테스트 팝업(개발용)</Text>
          {['지진', '지진해일', '민방공', '폭염'].map(t => (
            <TouchableOpacity key={t} style={styles.devBtn} onPress={() => triggerTestAlert(t)}>
              <Text style={styles.devBtnText}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );

  const footer = (
    <View>
      {data?.partial ? <Text style={styles.small}>문자가 많아 최근 일부만 표시 중입니다.</Text> : null}
      {updatedAt ? (
        <Text style={styles.updated}>마지막 확인: {updatedAt.toLocaleTimeString('ko-KR')}</Text>
      ) : null}
      <Text style={styles.small}>
        공식 재난문자는 휴대폰으로 직접 수신되는 알림이 기준입니다. 이 화면은 보조 수단이며 지연되거나
        누락될 수 있습니다.
        {'\n'}출처: 행정안전부 긴급재난문자 (재난안전데이터공유플랫폼)
      </Text>
    </View>
  );

  const options = picker === 'region' ? REGIONS : ['', ...subOptions];
  const selectedValue = picker === 'region' ? region : sub;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={a => a.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={loading && !!region} onRefresh={load} enabled={!!region} />
        }
      />

      <Modal visible={picker !== null} transparent animationType="fade" onRequestClose={() => setPicker(null)}>
        <Pressable style={styles.modalBg} onPress={() => setPicker(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
            <Text style={styles.sheetTitle}>{picker === 'region' ? '시/도 선택' : '시/군/구 선택'}</Text>
            <FlatList
              data={options}
              keyExtractor={o => o || '__all__'}
              renderItem={({ item: o }) => {
                const on = o === selectedValue;
                return (
                  <TouchableOpacity
                    style={styles.option}
                    onPress={() => (picker === 'region' ? chooseRegion(o) : chooseSub(o))}>
                    <Text style={[styles.optionText, on && styles.optionOn]}>{o || '전체'}</Text>
                    {on ? <Text style={styles.optionOn}>✓</Text> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  selects: { flexDirection: 'row', gap: 8, marginTop: 12 },
  select: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  selectDisabled: { backgroundColor: '#f3f4f6' },
  selectText: { flex: 1, fontSize: 14, color: '#111' },
  placeholder: { color: '#9ca3af' },
  caret: { color: '#6b7280', marginLeft: 6 },
  hint: { marginTop: 12, fontSize: 13, color: '#6b7280', lineHeight: 19 },
  error: { marginTop: 12, fontSize: 13, color: '#DC2626' },
  warn: { marginTop: 12, fontSize: 13, color: '#B45309' },
  devRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 12 },
  devLabel: { fontSize: 12, color: '#6b7280' },
  devBtn: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  devBtnText: { fontSize: 12, color: '#374151' },
  item: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11 },
  type: { fontSize: 12, color: '#374151' },
  time: { marginLeft: 'auto', fontSize: 12, color: '#6b7280' },
  message: { marginTop: 8, fontSize: 14, lineHeight: 21, color: '#111' },
  rgn: { marginTop: 8, fontSize: 12, color: '#6b7280', lineHeight: 17 },
  small: { marginTop: 10, fontSize: 11, color: '#6b7280', lineHeight: 17 },
  updated: { marginTop: 10, fontSize: 11, color: '#9ca3af' },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 14,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#111', paddingHorizontal: 18, paddingBottom: 8 },
  option: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 13,
  },
  optionText: { fontSize: 15, color: '#111' },
  optionOn: { color: '#1565c0', fontWeight: '700' },
});
