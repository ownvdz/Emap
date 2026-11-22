import React from 'react';
import { Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import EmergencyWatcher from './src/components/EmergencyWatcher';
import HomeScreen from './src/screens/HomeScreen';
import MapScreen from './src/screens/MapScreen';
import HelpScreen from './src/screens/HelpScreen';

const Tab = createBottomTabNavigator();
const navigationRef = createNavigationContainerRef();

const icon = (emoji: string) => ({ focused }: { focused: boolean }) => (
  <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.45 }}>{emoji}</Text>
);

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer ref={navigationRef}>
        {/* lazy: false → 앱을 켜자마자 모든 탭이 만들어짐 (블루투스는 '구조·제보' 탭에서 오프라인 기능을 사용할 때만 시작) */}
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            lazy: false,
            tabBarActiveTintColor: '#1565c0',
          }}>
          <Tab.Screen name="홈" component={HomeScreen} options={{ tabBarIcon: icon('🏠') }} />
          <Tab.Screen name="지도" component={MapScreen} options={{ tabBarIcon: icon('🗺️') }} />
          <Tab.Screen name="구조·제보" component={HelpScreen} options={{ tabBarIcon: icon('🆘') }} />
        </Tab.Navigator>
      </NavigationContainer>

      {/* 어느 탭에 있어도 위급 문자를 감시하고 팝업을 띄움 */}
      <EmergencyWatcher
        onShowMap={() => {
          if (navigationRef.isReady()) {
            navigationRef.navigate('지도');
          }
        }}
      />
    </SafeAreaProvider>
  );
}
