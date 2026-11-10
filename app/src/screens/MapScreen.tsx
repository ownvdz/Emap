import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NaverMapMarkerOverlay, NaverMapView } from '@mj-studio/react-native-naver-map';
import { apiGet } from '../api';
import {
  CATEGORY_INFO,
  CATEGORY_ORDER,
  DEFAULT_SELECTED,
  MIN_ZOOM_DENSE,
  MIN_ZOOM_TO_LOAD,
  MIXED_COLOR,
  infoOf,
  isDense,
  type Category,
} from '../core/categories';
import { catsOf, groupByLocation, type Shelter } from '../core/shelters';

const MAX_MARKERS = 300;

// 임시: true면 라이브러리 기본 마커로 표시 (커스텀 마커 문제 구분용)
const DEBUG_PLAIN_MARKERS = false;

type Bounds = { swLat: number; swLng: number; neLat: number; neLng: number };

// 카메라 정지 이벤트에서 화면 영역을 계산한다.
// 영역의 기준점이 왼쪽 아래 모서리인지 중심인지 문서로 확정하지 못해서, 카메라 중심과 맞는 쪽을 자동으로 고른다.
function boundsFromEvent(e: any): Bounds | null {
  const r = e?.region ?? {
    latitude: e?.regionLatitude,
    longitude: e?.regionLongitude,
    latitudeDelta: e?.regionLatitudeDelta,
    longitudeDelta: e?.regionLongitudeDelta,
  };
  const nums = [r.latitude, r.longitude, r.latitudeDelta, r.longitudeDelta, e?.latitude, e?.longitude];
  if (!nums.every(n => typeof n === 'number' && Number.isFinite(n))) {
    return null;
  }

  const cornerErr =
    Math.abs(e.latitude - (r.latitude + r.latitudeDelta / 2)) +
    Math.abs(e.longitude - (r.longitude + r.longitudeDelta / 2));
  const centerErr = Math.abs(e.latitude - r.latitude) + Math.abs(e.longitude - r.longitude);

  if (cornerErr <= centerErr) {
    return {
      swLat: r.latitude,
      swLng: r.longitude,
      neLat: r.latitude + r.latitudeDelta,
      neLng: r.longitude + r.longitudeDelta,
    };
  }
  return {
    swLat: r.latitude - r.latitudeDelta / 2,
    swLng: r.longitude - r.longitudeDelta / 2,
    neLat: r.latitude + r.latitudeDelta / 2,
    neLng: r.longitude + r.longitudeDelta / 2,
  };
}

// 마커 크기: 라이브러리가 마커의 width/height를 직접 지정해야 그려진다.
// 아래 MarkerView 안의 View 크기와 반드시 같아야 한다.
function markerSize(group: Shelter[]): { width: number; height: number } {
  if (group.length === 1) {
    return { width: 16, height: 16 };
  }
  const width = group.length > 99 ? 36 : group.length > 9 ? 30 : 24;
  return { width, height: 24 };
}

// 지도 위에 그려질 마커 모양: 1곳이면 색 점, 여러 곳이면 개수가 적힌 원 (종류가 섞이면 회색)
function MarkerView({ group }: { group: Shelter[] }) {
  const { width, height } = markerSize(group);
  const cats = new Set(group.flatMap(catsOf));
  const color = cats.size === 1 ? infoOf([...cats][0]).color : MIXED_COLOR;
  if (group.length === 1) {
    return <View style={[styles.dot, { width, height, backgroundColor: color }]} />;
  }
  return (
    <View style={[styles.count, { width, height, backgroundColor: color }]}>
      <Text style={styles.countText}>{group.length > 99 ? '99+' : group.length}</Text>
    </View>
  );
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Record<Category, boolean>>({ ...DEFAULT_SELECTED });
  const [groups, setGroups] = useState<Shelter[][]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<Shelter[] | null>(null);
  const [debug, setDebug] = useState('시작');

  const selectedRef = useRef(selected);
  const camRef = useRef<{ bounds: Bounds; zoom: number } | null>(null);
  const reqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const cam = camRef.current;
    if (!cam) {
      return;
    }
    const categories = CATEGORY_ORDER.filter(c => selectedRef.current[c]);

    if (categories.length === 0) {
      abortRef.current?.abort();
      setGroups([]);
      setDebug('조회 안 함 (선택한 종류 없음)');
      setNotice('표시할 항목을 선택해주세요.');
      return;
    }

    // 쉼터는 더 확대해야 불러오고, 나머지는 기존 배율부터 불러옴
    const loadable = categories.filter(
      c => cam.zoom >= (isDense(c) ? MIN_ZOOM_DENSE : MIN_ZOOM_TO_LOAD),
    );
    const hiddenDense = categories.some(c => isDense(c) && cam.zoom < MIN_ZOOM_DENSE);

    if (loadable.length === 0) {
      abortRef.current?.abort();
      setGroups([]);
      setDebug(`조회 안 함 (배율 ${cam.zoom})`);
      setNotice(
        categories.every(isDense)
          ? '쉼터는 지도를 더 확대해야 표시됩니다.'
          : '지도를 더 확대하면 대피소가 표시됩니다.',
      );
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const myReq = ++reqRef.current;

    try {
      setDebug(`요청 중 (${loadable.length}종, 배율 ${cam.zoom})`);
      const { bounds } = cam;
      const data = await apiGet<{ items: Shelter[]; truncated: boolean }>(
        '/api/shelters',
        {
          swLat: String(bounds.swLat),
          swLng: String(bounds.swLng),
          neLat: String(bounds.neLat),
          neLng: String(bounds.neLng),
          categories: loadable.join(','),
          limit: String(MAX_MARKERS),
        },
        { signal: controller.signal },
      );
      if (myReq !== reqRef.current) {
        return; // 그 사이에 더 새로운 요청이 시작됨
      }
      const next = groupByLocation(data.items);
      setDebug(`응답 ${data.items.length}건 → 마커 ${next.length}개`);
      setGroups(next);
      setNotice(
        data.truncated
          ? '대피소가 많아 일부만 표시 중입니다. 더 확대해주세요.'
          : hiddenDense
            ? '쉼터는 지도를 더 확대하면 표시됩니다.'
            : null,
      );
    } catch (e) {
      if (myReq !== reqRef.current || (e as Error).name === 'AbortError') {
        return;
      }
      setDebug(`오류: ${(e as Error).message}`);
      setNotice(`대피소 정보를 불러오지 못했습니다. (${(e as Error).message})`);
    }
  }, []);

  // 칩을 바꾸면 최신 선택값을 반영하고 즉시 다시 조회
  useEffect(() => {
    selectedRef.current = selected;
    load();
  }, [selected, load]);

  const handleIdle = useCallback(
    (e: any) => {
      const bounds = boundsFromEvent(e);
      if (!bounds) {
        const raw = JSON.stringify(e);
        console.log('화면 영역을 읽지 못했습니다:', raw);
        setDebug(`영역을 못 읽음: ${raw.slice(0, 160)}`);
        return;
      }
      console.log('범위', JSON.stringify(bounds), '배율', e.zoom);
      setDebug(`카메라 정지 (배율 ${e.zoom})`);
      camRef.current = { bounds, zoom: Number(e.zoom) };
      load();
    },
    [load],
  );

  return (
    <View style={styles.root}>
      <NaverMapView
        style={styles.map}
        initialCamera={{ latitude: 37.4563, longitude: 126.7052, zoom: 14 }}
        onCameraIdle={handleIdle}
        onTapMap={() => setOpenGroup(null)}>
        {groups.map(g => {
          const size = markerSize(g);
          return (
            <NaverMapMarkerOverlay
              key={`${g[0].lat.toFixed(5)},${g[0].lng.toFixed(5)}`}
              latitude={g[0].lat}
              longitude={g[0].lng}
              width={size.width}
              height={size.height}
              anchor={{ x: 0.5, y: 0.5 }}
              onTap={() => setOpenGroup(g)}>
              {DEBUG_PLAIN_MARKERS ? null : <MarkerView group={g} />}
            </NaverMapMarkerOverlay>
          );
        })}
      </NaverMapView>

      {/* 위쪽: 종류 칩과 안내 */}
      <View style={[styles.top, { top: insets.top + 8 }]} pointerEvents="box-none">
        <View style={styles.chipPanel}>
          {CATEGORY_ORDER.map(c => {
            const on = selected[c];
            const info = CATEGORY_INFO[c];
            return (
              <TouchableOpacity
                key={c}
                onPress={() => setSelected(prev => ({ ...prev, [c]: !prev[c] }))}
                style={[styles.chip, on && { backgroundColor: info.color, borderColor: info.color }]}>
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{info.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {notice ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}
      </View>

      {/* 아래: 선택한 마커의 정보 카드 */}
      {openGroup ? (
        <View style={styles.card}>
          <TouchableOpacity style={styles.close} onPress={() => setOpenGroup(null)}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
          <ScrollView style={styles.cardScroll}>
            {openGroup.length > 1 ? (
              <Text style={styles.cardHead}>이 위치의 대피소 {openGroup.length}곳</Text>
            ) : null}
            {openGroup.map((s, i) => (
              <View key={`${s.id}-${i}`} style={[styles.item, i > 0 && styles.itemSep]}>
                <View style={styles.titleRow}>
                  {catsOf(s).map(c => (
                    <View key={c} style={[styles.badge, { backgroundColor: infoOf(c).color }]}>
                      <Text style={styles.badgeText}>{infoOf(c).label}</Text>
                    </View>
                  ))}
                  <Text style={styles.name}>{s.name ?? '이름 없음'}</Text>
                </View>
                {s.address ? <Text style={styles.line}>{s.address}</Text> : null}
                {s.type ? <Text style={styles.line}>구분: {s.type}</Text> : null}
                {s.capacity != null ? <Text style={styles.line}>수용 인원: {s.capacity}명</Text> : null}
                {s.area != null ? <Text style={styles.line}>수용 가능 면적: {s.area}㎡</Text> : null}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* 임시 진단 문구 (정상 확인 후 지웁니다) */}
      <Text style={styles.debug}>{debug}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  map: { flex: 1 },
  top: { position: 'absolute', left: 10, right: 10, gap: 8 },
  chipPanel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 12,
    padding: 8,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#fff',
  },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  notice: {
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  noticeText: { color: '#fff', fontSize: 13 },
  dot: {
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#fff',
  },
  count: {
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  card: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 40,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 12,
    elevation: 6,
  },
  cardScroll: { maxHeight: 220 },
  close: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  closeText: { fontSize: 16, color: '#6b7280' },
  cardHead: { fontWeight: '700', marginBottom: 8, paddingRight: 28, color: '#111' },
  item: { paddingRight: 28 },
  itemSep: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#e5e7eb' },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 },
  badge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 11 },
  name: { fontWeight: '700', color: '#111', fontSize: 14 },
  line: { fontSize: 13, color: '#374151', marginTop: 2 },
  debug: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(255,255,0,0.9)',
    padding: 4,
    fontSize: 11,
    color: '#000',
  },
});