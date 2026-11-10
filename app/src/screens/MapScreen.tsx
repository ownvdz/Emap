import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export default function MapScreen() {
  return (
    <View style={styles.root}>
      <Text style={styles.text}>지도는 다음 단계에서 만듭니다.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  text: { color: '#6b7280' },
});