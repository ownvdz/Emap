import { PermissionsAndroid, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';

export type LatLng = { lat: number; lng: number };

// 위치 권한 확인과 요청. 정확한 위치 또는 대략적인 위치 중 하나만 허용돼도 사용할 수 있다.
export async function ensureLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const fine = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
  const coarse = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;

  if ((await PermissionsAndroid.check(fine)) || (await PermissionsAndroid.check(coarse))) {
    return true;
  }
  const result = await PermissionsAndroid.requestMultiple([fine, coarse]);
  return (
    result[fine] === PermissionsAndroid.RESULTS.GRANTED ||
    result[coarse] === PermissionsAndroid.RESULTS.GRANTED
  );
}

function getOnce(highAccuracy: boolean, timeout: number, maximumAge: number): Promise<LatLng> {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error(err.message)),
      { enableHighAccuracy: highAccuracy, timeout, maximumAge },
    );
  });
}

// 현재 위치. 가까운 대피소를 찾는 데는 수십 m 정확도가 필요 없으므로 빠른 네트워크 기반 위치를 먼저 쓰고
// (5분 이내에 받은 위치가 있으면 그대로 재사용), 실패했을 때만 GPS로 한 번 더 시도한다.
export async function getCurrentPosition(): Promise<LatLng> {
  try {
    return await getOnce(false, 4000, 300_000);
  } catch {
    return getOnce(true, 8000, 60_000);
  }
}
