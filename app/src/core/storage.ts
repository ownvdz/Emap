import AsyncStorage from '@react-native-async-storage/async-storage';

// 저장이 실패해도 앱이 멈추지 않게, 실패하면 조용히 넘어간다.
export async function getItem(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    await AsyncStorage.setItem(key, value);
  } catch {
    /* 저장하지 못해도 동작에는 영향 없음 */
  }
}
