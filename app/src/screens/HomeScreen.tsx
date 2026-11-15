import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_BASE_URL } from '../config';
import { apiGet } from '../api';

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState('아직 확인하지 않았습니다.');
  const [loading, setLoading] = useState(false);

  const check = async () => {
    setLoading(true);
    try {
      const health = await apiGet<{ status: string; time: string }>('/api/health');
      setResult(`서버 응답: ${health.status} (${health.time})`);
    } catch (e) {
      setResult(`연결 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 16 }]}>
      <Text style={styles.title}>비상대피소 지도</Text>
      <Text style={styles.sub}>API 주소: {API_BASE_URL}</Text>

      <TouchableOpacity style={styles.btn} onPress={check} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>서버 연결 확인</Text>}
      </TouchableOpacity>
      <Text style={styles.result}>{result}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20 },
  title: { fontSize: 22, fontWeight: '700', color: '#111' },
  sub: { fontSize: 12, color: '#6b7280', marginTop: 6 },
  btn: {
    marginTop: 20,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#1565c0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600' },
  result: { marginTop: 16, fontSize: 14, color: '#222' },
});