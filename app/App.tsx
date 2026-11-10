import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import HomeScreen from './src/screens/HomeScreen';
import MapScreen from './src/screens/MapScreen';
import MeshScreen from './src/screens/MeshScreen';

const Tab = createBottomTabNavigator();

const icon = (emoji: string) => ({ focused }: { focused: boolean }) => (
  <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
);

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        {/* lazy: false → 앱을 켜자마자 모든 탭이 만들어져서 블루투스 메시가 바로 시작됨 */}
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            lazy: false,
            tabBarActiveTintColor: '#1565c0',
          }}>
          <Tab.Screen name="홈" component={HomeScreen} options={{ tabBarIcon: icon('🏠') }} />
          <Tab.Screen name="지도" component={MapScreen} options={{ tabBarIcon: icon('🗺️') }} />
          <Tab.Screen name="근처 메시" component={MeshScreen} options={{ tabBarIcon: icon('📡') }} />
        </Tab.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}