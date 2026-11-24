import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { describeOffset, type LatLng } from '../core/geo';
import { getPinsVersion, hasPin, subscribePins } from '../core/reportPins';
import {
  KIND_COLOR,
  KIND_LABEL,
  MAX_COUNT,
  NOTE_MAX_CHARS,
  SUBS,
  ageText,
  sortReports,
  subLabel,
  type Draft,
  type Report,
  type ReportKind,
} from '../core/reports';

// 구조 요청·위험 제보·취소 및 해결 양식과 받은 목록. 인터넷(서버)과 블루투스가 같은 화면을 쓰고, 보내고 받는 방법만 다르다.
type Form = ReportKind | 'resolve' | null;

// 보내기·처리 결과. error가 있으면 실패, info는 성공했을 때 보여줄 문장(없으면 기본 문장)
export type Result = { error?: string; info?: string };

type Props = {
  mode: 'online' | 'offline';
  reports: Report[]; // 해결·만료되지 않은 것
  pos: LatLng | null;
  onSubmit: (d: Draft) => Promise<Result>;
  onResolve: (r: Report) => Promise<Result>;
  onShowOnMap: (r: Report) => void;
  header?: ReactNode;
  footer?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  emptyText: string;
  // 위험 제보에서 "지도에서 선택"을 눌렀을 때 지도 선택 화면을 열고, 고른 위치(취소하면 null)를 돌려준다
  onPickLocation: (initial: LatLng | null) => Promise<LatLng | null>;
};

export default function ReportPanel({
  mode,
  reports,
  pos,
  onSubmit,
  onResolve,
  onShowOnMap,
  header,
  footer,
  onRefresh,
  refreshing,
  emptyText,
  onPickLocation,
}: Props) {
  const [form, setForm] = useState<Form>(null);
  const [sub, setSub] = useState('');
  const [count, setCount] = useState(1);
  const [note, setNote] = useState('');
  const [locMode, setLocMode] = useState<'here' | 'map'>('here'); // 위험 제보 위치: 현재 위치 / 지도에서 선택
  const [picked, setPicked] = useState<LatLng | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [, setPinTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  // 지도에 반영된 목록이 바뀌면 버튼 표시를 갱신
  useEffect(() => subscribePins(() => setPinTick(getPinsVersion())), []);

  const sorted = useMemo(() => sortReports(reports, pos), [reports, pos]);
  const mine = useMemo(() => sorted.filter(r => r.mine), [sorted]);

  const open = (f: Form) => {
    setError(null);
    setDone(null);
    if (f === form) {
      setForm(null);
      return;
    }
    if (f === 'sos' || f === 'hazard') {
      setSub(SUBS[f][0].code);
      setCount(1);
      setNote('');
      setLocMode('here');
      setPicked(null);
    }
    setForm(f);
  };

  const submit = useCallback(async () => {
    if (sending || (form !== 'sos' && form !== 'hazard')) {
      return;
    }
    const useMap = form === 'hazard' && locMode === 'map';
    if (useMap && !picked) {
      setError('지도에서 위치를 선택해 주세요.');
      return;
    }
    setSending(true);
    setError(null);
    const res = await onSubmit({
      kind: form,
      sub,
      count: form === 'sos' ? count : 1,
      note: note.trim(),
      ...(useMap && picked ? { pos: picked } : {}),
    });
    setSending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setDone(res.info ?? `${KIND_LABEL[form]}을(를) ${mode === 'online' ? '인터넷으로' : '블루투스로'} 보냈습니다.`);
    setForm(null);
  }, [sending, form, onSubmit, sub, count, note, mode, locMode, picked]);

  const pick = async () => {
    const p = await onPickLocation(picked ?? pos);
    if (p) {
      setPicked(p);
      setLocMode('map');
      setError(null);
    }
  };

  const resolve = (r: Report) => {
    Alert.alert('취소 및 해결', `${KIND_LABEL[r.kind]}(${subLabel(r.kind, r.sub)})을(를) 취소·해결 처리할까요?\n다른 사람의 목록과 지도에서도 사라집니다.`, [
      { text: '아니요', style: 'cancel' },
      {
        text: '처리',
        onPress: async () => {
          const res = await onResolve(r);
          if (res.error) {
            setError(res.error);
          } else {
            setDone(res.info ?? '취소·해결 처리했습니다.');
          }
        },
      },
    ]);
  };

  const formKind = form === 'sos' || form === 'hazard' ? form : null;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}>
      {header}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.action, { borderColor: KIND_COLOR.sos }, form === 'sos' && { backgroundColor: KIND_COLOR.sos }]}
          onPress={() => open('sos')}>
          <Text style={[styles.actionText, { color: form === 'sos' ? '#fff' : KIND_COLOR.sos }]}>🆘 구조 요청</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.action, { borderColor: KIND_COLOR.hazard }, form === 'hazard' && { backgroundColor: KIND_COLOR.hazard }]}
          onPress={() => open('hazard')}>
          <Text style={[styles.actionText, { color: form === 'hazard' ? '#fff' : KIND_COLOR.hazard }]}>⚠️ 위험 제보</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.action, { borderColor: '#16A34A' }, form === 'resolve' && { backgroundColor: '#16A34A' }]}
          onPress={() => open('resolve')}>
          <Text style={[styles.actionText, { color: form === 'resolve' ? '#fff' : '#16A34A' }]}>✅ 취소·해결</Text>
        </TouchableOpacity>
      </View>

      {formKind ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>
            {KIND_LABEL[formKind]} : {formKind === 'hazard' && locMode === 'map' ? '지도에서 선택한 위치' : '현재 위치'}
            {note.trim() ? `, "${note.trim()}"` : ''}
          </Text>
          <View style={styles.chips}>
            {SUBS[formKind].map(s => {
              const on = sub === s.code;
              return (
                <TouchableOpacity
                  key={s.code}
                  style={[styles.chip, on && { backgroundColor: KIND_COLOR[formKind], borderColor: KIND_COLOR[formKind] }]}
                  onPress={() => setSub(s.code)}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {formKind === 'hazard' ? (
            <View style={styles.locBox}>
              <View style={styles.locRow}>
                <TouchableOpacity
                  style={[styles.locChip, locMode === 'here' && styles.locChipOn]}
                  onPress={() => setLocMode('here')}>
                  <Text style={[styles.locChipText, locMode === 'here' && styles.locChipTextOn]}>현재 위치</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.locChip, locMode === 'map' && styles.locChipOn]}
                  onPress={pick}>
                  <Text style={[styles.locChipText, locMode === 'map' && styles.locChipTextOn]}>🗺️ 지도에서 선택</Text>
                </TouchableOpacity>
              </View>
              {locMode === 'map' && picked ? (
                <Text style={styles.hint}>
                  선택한 위치 {picked.lat.toFixed(5)}, {picked.lng.toFixed(5)} (눌러서 다시 선택)
                </Text>
              ) : null}
            </View>
          ) : null}
          {formKind === 'sos' ? (
            <View style={styles.countRow}>
              <Text style={styles.label}>인원</Text>
              <TouchableOpacity style={styles.step} onPress={() => setCount(c => Math.max(1, c - 1))}>
                <Text style={styles.stepText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.countText}>{count}명</Text>
              <TouchableOpacity style={styles.step} onPress={() => setCount(c => Math.min(MAX_COUNT, c + 1))}>
                <Text style={styles.stepText}>＋</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder={`메모 (선택, ${NOTE_MAX_CHARS}자 이내)`}
            placeholderTextColor="#888"
            maxLength={NOTE_MAX_CHARS}
          />
          {mode === 'offline' ? (
            <Text style={styles.hint}>블루투스로는 근처 기기를 거쳐 전달되며, 메모가 길면 일부가 잘릴 수 있습니다.</Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            style={[styles.send, { backgroundColor: KIND_COLOR[formKind] }, sending && styles.sendOff]}
            onPress={submit}
            disabled={sending}>
            {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>{KIND_LABEL[formKind]} 보내기</Text>}
          </TouchableOpacity>
        </View>
      ) : null}

      {form === 'resolve' ? (
        <View style={styles.form}>
          <Text style={styles.formTitle}>내가 보낸 요청 취소·해결</Text>
          {mine.length === 0 ? <Text style={styles.empty}>처리할 내 요청이 없습니다.</Text> : null}
          {mine.map(r => (
            <View key={r.id} style={styles.mineRow}>
              <Text style={styles.mineText}>
                {KIND_LABEL[r.kind]} · {subLabel(r.kind, r.sub)}
                {r.note ? ` · "${r.note}"` : ''} ({ageText(r.at, now)})
              </Text>
              <TouchableOpacity style={styles.resolveBtn} onPress={() => resolve(r)}>
                <Text style={styles.resolveText}>취소·해결</Text>
              </TouchableOpacity>
            </View>
          ))}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}

      {!form && error ? <Text style={styles.error}>{error}</Text> : null}
      {done ? <Text style={styles.done}>{done}</Text> : null}

      <Text style={styles.listTitle}>
        {mode === 'online' ? '주변 요청·제보 (인터넷)' : '받은 요청·제보 (블루투스)'} {sorted.length}건
      </Text>
      {sorted.length === 0 ? <Text style={styles.empty}>{emptyText}</Text> : null}
      {sorted.map(r => {
        const color = KIND_COLOR[r.kind];
        const hasPos = r.lat !== undefined && r.lng !== undefined;
        const where = r.mine
          ? '내가 보낸 요청'
          : hasPos && pos
            ? describeOffset(pos, { lat: r.lat as number, lng: r.lng as number })
            : hasPos
              ? '위치 있음'
              : '위치 정보 없음';
        return (
          <View key={r.id} style={[styles.card, { borderLeftColor: color }]}>
            <View style={styles.cardHead}>
              <View style={[styles.badge, { backgroundColor: color }]}>
                <Text style={styles.badgeText}>{KIND_LABEL[r.kind]}</Text>
              </View>
              <Text style={styles.cardTitle}>
                {subLabel(r.kind, r.sub)}
                {r.kind === 'sos' && (r.count ?? 1) > 1 ? ` · ${r.count}명` : ''}
              </Text>
              <Text style={styles.age}>{ageText(r.at, now)}</Text>
            </View>
            <Text style={styles.line}>
              📍 {where}
              {r.posAge ? ` (${r.posAge}분 전 위치)` : ''}
            </Text>
            {r.note ? <Text style={styles.line}>"{r.note}"</Text> : null}
            <View style={styles.cardActions}>
              {hasPos ? (
                <TouchableOpacity style={[styles.smallBtn, { borderColor: color }]} onPress={() => onShowOnMap(r)}>
                  <Text style={[styles.smallText, { color }]}>{hasPin(r.id) ? '지도에 반영됨 ✓' : '지도에 반영'}</Text>
                </TouchableOpacity>
              ) : null}
              {r.mine ? (
                <TouchableOpacity style={[styles.smallBtn, { borderColor: '#16A34A' }]} onPress={() => resolve(r)}>
                  <Text style={[styles.smallText, { color: '#16A34A' }]}>취소·해결</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        );
      })}

      {footer}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 14, paddingBottom: 40 },
  actionRow: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  actionText: { fontSize: 14, fontWeight: '700' },
  form: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#f5f7fa', gap: 10 },
  formTitle: { fontSize: 14, fontWeight: '700', color: '#111' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 14, color: '#374151' },
  chipTextOn: { color: '#fff', fontWeight: '700' },
  locBox: { gap: 6 },
  locRow: { flexDirection: 'row', gap: 8 },
  locChip: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  locChipOn: { borderColor: '#F97316', backgroundColor: '#FFF7ED' },
  locChipText: { fontSize: 13, color: '#374151' },
  locChipTextOn: { color: '#C2410C', fontWeight: '700' },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 14, color: '#374151' },
  step: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontSize: 20, color: '#111' },
  countText: { fontSize: 16, fontWeight: '700', color: '#111', minWidth: 44, textAlign: 'center' },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#111',
    backgroundColor: '#fff',
  },
  hint: { fontSize: 12, color: '#6b7280' },
  error: { fontSize: 13, color: '#B91C1C', marginTop: 8 },
  done: { fontSize: 13, color: '#15803D', marginTop: 8 },
  send: { height: 48, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.6 },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  mineText: { flex: 1, fontSize: 13, color: '#111' },
  resolveBtn: { borderWidth: 1, borderColor: '#16A34A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  resolveText: { color: '#16A34A', fontSize: 13, fontWeight: '600' },
  listTitle: { marginTop: 18, marginBottom: 6, fontSize: 15, fontWeight: '700', color: '#111' },
  empty: { fontSize: 13, color: '#6b7280', paddingVertical: 8 },
  card: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderLeftWidth: 5,
    backgroundColor: '#fff',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111' },
  age: { fontSize: 12, color: '#6b7280' },
  line: { fontSize: 13, color: '#374151', marginTop: 4 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  smallBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  smallText: { fontSize: 13, fontWeight: '600' },
});
