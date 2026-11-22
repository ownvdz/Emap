import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReportPanel, { type Result } from '../components/ReportPanel';
import type { LatLng } from '../core/geo';
import { lastKnown, locate } from '../core/position';
import { checkOnline, fetchReports, postReport, resolveReportOnline } from '../core/reportApi';
import { requestMap } from '../core/mapBus';
import { addPin, clearPins, prunePins } from '../core/reportPins';
import type { Draft, Report } from '../core/reports';
import MeshReports from './MeshScreen';

// 구조·제보 탭. 인터넷이 되면 서버를 통해 주변 사람들과 주고받고,
// 인터넷이 없으면 안내 후(사용자가 허용하면) 블루투스 화면으로 바꾼다.
const POLL_MS = 20_000; // 화면을 보고 있는 동안 목록 갱신·연결 확인 간격

const OFFLINE_ASK = '인터넷에 연결이 되지 않았습니다. 오프라인 기능을 사용하시겠어요?';

export default function HelpScreen() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const navigation = useNavigation();

  const [mode, setMode] = useState<'online' | 'offline'>('online');
  const [net, setNet] = useState<'checking' | 'ok' | 'down'>('checking');
  const [onlineBack, setOnlineBack] = useState(false); // 오프라인 중 인터넷이 다시 확인됨
  const [reports, setReports] = useState<Report[]>([]);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const modeRef = useRef(mode);
  modeRef.current = mode;
  const posRef = useRef<LatLng | null>(null);
  const askedRef = useRef(false); // 같은 끊김 동안 안내창을 반복해서 띄우지 않음
  const askingRef = useRef(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const goOffline = useCallback(() => {
    clearPins(); // 인터넷으로 받은 핀은 지도에서 내린다
    setReports([]);
    setOnlineBack(false);
    setMode('offline');
  }, []);

  const goOnline = useCallback(() => {
    clearPins(); // 블루투스로 받은 핀은 지도에서 내린다 (목록도 함께 사라짐)
    askedRef.current = false;
    setOnlineBack(false);
    setNet('checking');
    setMode('online');
  }, []);

  // 인터넷이 안 될 때의 안내. force가 아니면 같은 끊김 동안 한 번만 물어본다
  const askOffline = useCallback(
    (force = false) => {
      if (askingRef.current || (askedRef.current && !force)) {
        return;
      }
      askedRef.current = true;
      askingRef.current = true;
      Alert.alert(
        '인터넷 연결 없음',
        OFFLINE_ASK,
        [
          { text: '아니요', style: 'cancel', onPress: () => (askingRef.current = false) },
          {
            text: '사용하기',
            onPress: () => {
              askingRef.current = false;
              goOffline();
            },
          },
        ],
        {
          cancelable: true,
          onDismiss: () => {
            askingRef.current = false;
          },
        },
      );
    },
    [goOffline],
  );

  // 온라인 목록 불러오기. 실패하면 연결 상태를 다시 확인한다
  const load = useCallback(
    async (opts: { quiet?: boolean } = {}) => {
      if (modeRef.current !== 'online') {
        return;
      }
      try {
        const list = await fetchReports(posRef.current);
        if (!aliveRef.current || modeRef.current !== 'online') {
          return;
        }
        setReports(list);
        prunePins(new Set(list.map(r => r.id)));
        setLoadError(null);
        setNet('ok');
        askedRef.current = false;
      } catch (e) {
        if (!aliveRef.current || modeRef.current !== 'online') {
          return;
        }
        const online = await checkOnline();
        if (!aliveRef.current || modeRef.current !== 'online') {
          return;
        }
        if (!online) {
          setNet('down');
          if (!opts.quiet) {
            askOffline();
          }
        } else {
          setNet('ok');
          setLoadError(`목록을 불러오지 못했습니다. (${(e as Error).message})`);
        }
      }
    },
    [askOffline],
  );

  // 내 위치 (거리 표시와 주변 조회용)
  const refreshPos = useCallback(async () => {
    const last = await lastKnown();
    if (last) {
      posRef.current = last;
      setPos(last);
    }
    const here = await locate(8000);
    if (here && aliveRef.current) {
      posRef.current = here;
      setPos(here);
    }
  }, []);

  // 이 탭을 볼 때: 연결 확인 → (온라인이면) 목록 갱신. 끊겨 있으면 안내
  useEffect(() => {
    if (!focused || mode !== 'online') {
      return;
    }
    let cancelled = false;
    (async () => {
      setNet('checking');
      const online = await checkOnline();
      if (cancelled) {
        return;
      }
      if (!online) {
        setNet('down');
        askOffline();
        return;
      }
      setNet('ok');
      askedRef.current = false;
      await refreshPos();
      if (!cancelled) {
        await load();
      }
    })();
    const timer = setInterval(() => load({ quiet: true }), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [focused, mode, askOffline, load, refreshPos]);

  // 오프라인 중에는 인터넷이 돌아왔는지만 가끔 확인해서 알려준다 (자동으로 전환하지는 않음)
  useEffect(() => {
    if (!focused || mode !== 'offline') {
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const online = await checkOnline();
      if (!cancelled) {
        setOnlineBack(online);
      }
    };
    const timer = setInterval(tick, POLL_MS);
    tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [focused, mode]);

  const showOnMap = useCallback(
    (r: Report) => {
      addPin(r);
      requestMap({ categories: [], focusReportId: r.id, nonce: Date.now() });
      navigation.navigate('지도' as never);
    },
    [navigation],
  );

  const onSubmit = useCallback(
    async (d: Draft): Promise<Result> => {
      const here = await locate(15000);
      if (!here) {
        return { error: '현재 위치를 확인하지 못했습니다. 위치 권한과 GPS를 확인해 주세요.' };
      }
      posRef.current = here;
      setPos(here);
      try {
        await postReport(d, here);
      } catch (e) {
        // 서버가 거절한 경우(한도 초과 등)는 그 이유를, 연결 문제면 오프라인 안내를 보여준다
        const online = await checkOnline();
        if (!online) {
          setNet('down');
          askOffline(true);
          return { error: '인터넷에 연결되어 있지 않아 보내지 못했습니다.' };
        }
        return { error: (e as Error).message };
      }
      load({ quiet: true });
      return here.ageMin > 0 ? { info: `${here.ageMin}분 전에 확인한 위치로 보냈습니다. (새 위치를 얻지 못함)` } : {};
    },
    [askOffline, load],
  );

  const onResolve = useCallback(
    async (r: Report): Promise<Result> => {
      try {
        await resolveReportOnline(r.id);
      } catch (e) {
        const online = await checkOnline();
        if (!online) {
          setNet('down');
          askOffline(true);
          return { error: '인터넷에 연결되어 있지 않아 처리하지 못했습니다.' };
        }
        return { error: (e as Error).message };
      }
      setReports(prev => prev.filter(x => x.id !== r.id));
      prunePins(new Set(reports.filter(x => x.id !== r.id).map(x => x.id)));
      load({ quiet: true });
      return {};
    },
    [askOffline, load, reports],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    const online = await checkOnline();
    if (online) {
      await refreshPos();
      await load();
    } else {
      setNet('down');
      askOffline(true);
    }
    setRefreshing(false);
  }, [askOffline, load, refreshPos]);

  // Android 15+(API 35+)는 앱이 시스템 바 아래까지 그려지므로 키보드 높이를 직접 처리
  const needsKeyboardAvoid = Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version >= 35);

  const offline = mode === 'offline';

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right },
      ]}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <View style={styles.header}>
        <Text style={styles.title}>구조·제보</Text>
        <View style={[styles.pill, offline ? styles.pillOff : styles.pillOn]}>
          <Text style={[styles.pillText, { color: offline ? '#92400E' : '#166534' }]}>
            {offline ? '오프라인 · 블루투스' : '온라인'}
          </Text>
        </View>
        <TouchableOpacity style={styles.switchBtn} onPress={offline ? goOnline : () => goOffline()}>
          <Text style={styles.switchText}>{offline ? '온라인으로' : '오프라인 기능 사용'}</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={needsKeyboardAvoid}>
        {offline ? (
          <MeshReports onShowOnMap={showOnMap} onGoOnline={goOnline} onlineBack={onlineBack} />
        ) : (
          <ReportPanel
            mode="online"
            reports={reports}
            pos={pos}
            onSubmit={onSubmit}
            onResolve={onResolve}
            onShowOnMap={showOnMap}
            onRefresh={refresh}
            refreshing={refreshing}
            emptyText={
              net === 'down' ? '인터넷에 연결되어 있지 않아 목록을 불러오지 못했습니다.' : '주변 30km 안에 등록된 요청·제보가 없습니다.'
            }
            header={
              net === 'down' ? (
                <View style={styles.downBox}>
                  <Text style={styles.downText}>인터넷에 연결되어 있지 않습니다.</Text>
                  <View style={styles.downRow}>
                    <TouchableOpacity style={styles.downBtn} onPress={refresh}>
                      <Text style={styles.downBtnText}>다시 확인</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.downBtn, styles.downPrimary]} onPress={() => askOffline(true)}>
                      <Text style={[styles.downBtnText, { color: '#fff' }]}>오프라인 기능 사용</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : loadError ? (
                <Text style={styles.loadError}>{loadError}</Text>
              ) : null
            }
          />
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: '#ddd',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  pill: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  pillOn: { backgroundColor: '#DCFCE7' },
  pillOff: { backgroundColor: '#FEF3C7' },
  pillText: { fontSize: 12, fontWeight: '700' },
  switchBtn: {
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  switchText: { fontSize: 12, color: '#333' },
  downBox: { marginBottom: 12, padding: 12, borderRadius: 10, backgroundColor: '#FEF2F2', gap: 8 },
  downText: { color: '#991B1B', fontSize: 13, fontWeight: '600' },
  downRow: { flexDirection: 'row', gap: 8 },
  downBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  downPrimary: { backgroundColor: '#1565c0', borderColor: '#1565c0' },
  downBtnText: { fontSize: 13, color: '#111', fontWeight: '600' },
  loadError: { marginBottom: 12, color: '#B91C1C', fontSize: 13 },
});
