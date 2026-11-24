import React, { useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NaverMapView, type NaverMapViewRef } from '@mj-studio/react-native-naver-map';
import type { LatLng } from '../core/geo';

// 위험 제보 위치를 지도에서 고르는 전체 화면. 지도를 움직여 가운데 십자 표시를 위험한 곳에 맞추고 "이 위치로 선택"을 누른다.
const DEFAULT_CENTER: LatLng = { lat: 37.4563, lng: 126.7052 };

type Props = {
  initial: LatLng | null; // 처음 보여줄 위치 (보통 내 위치)
  onConfirm: (p: LatLng) => void;
  onCancel: () => void;
};

export default function LocationPicker({ initial, onConfirm, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const start = initial ?? DEFAULT_CENTER;
  const mapRef = useRef<NaverMapViewRef>(null);
  // 카메라가 멈출 때마다 지도 중심을 기록한다 (처음에는 시작 위치)
  const centerRef = useRef<LatLng>(start);

  const handleIdle = (e: any) => {
    if (typeof e?.latitude === 'number' && typeof e?.longitude === 'number') {
      centerRef.current = { lat: e.latitude, lng: e.longitude };
    }
  };

  return (
    <View style={styles.root}>
      <NaverMapView
        ref={mapRef}
        style={styles.map}
        initialCamera={{ latitude: start.lat, longitude: start.lng, zoom: 16 }}
        onCameraIdle={handleIdle}
      />

      {/* 지도 가운데 표시: 이 점이 선택되는 위치 */}
      <View style={styles.crossWrap} pointerEvents="none">
        <View style={styles.crossV} />
        <View style={styles.crossH} />
        <View style={styles.crossDot} />
      </View>

      <View style={[styles.top, { top: insets.top + 8 }]}>
        <Text style={styles.topText}>지도를 움직여 위험한 위치를 가운데 십자 표시에 맞춰 주세요</Text>
      </View>

      {initial ? (
        <TouchableOpacity
          style={styles.locBtn}
          onPress={() =>
            mapRef.current?.animateCameraTo({ latitude: initial.lat, longitude: initial.lng, zoom: 16, duration: 400 })
          }>
          <Text style={styles.locText}>📍</Text>
        </TouchableOpacity>
      ) : null}

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={[styles.btn, styles.cancel]} onPress={onCancel}>
          <Text style={styles.cancelText}>취소</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.ok]} onPress={() => onConfirm(centerRef.current)}>
          <Text style={styles.okText}>이 위치로 선택</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#fff', zIndex: 20, elevation: 20 },
  map: { flex: 1 },
  crossWrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  crossV: { position: 'absolute', width: 2, height: 36, backgroundColor: '#F97316' },
  crossH: { position: 'absolute', width: 36, height: 2, backgroundColor: '#F97316' },
  crossDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#F97316', borderWidth: 2, borderColor: '#fff' },
  top: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  topText: { color: '#fff', fontSize: 13, textAlign: 'center' },
  locBtn: {
    position: 'absolute',
    right: 12,
    bottom: 100,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
  },
  locText: { fontSize: 20 },
  bottom: { position: 'absolute', left: 12, right: 12, bottom: 0, flexDirection: 'row', gap: 8 },
  btn: { flex: 1, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' },
  cancelText: { color: '#111', fontWeight: '600' },
  ok: { backgroundColor: '#F97316' },
  okText: { color: '#fff', fontWeight: '700' },
});
