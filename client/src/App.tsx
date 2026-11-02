import { useState } from 'react';
import HomeScreen from './components/HomeScreen';
import ShelterMap, { type MapRequest } from './components/ShelterMap';
import TabBar from './components/TabBar';
import MobileFrame from './components/MobileFrame';
import EmergencyWatcher from './components/EmergencyWatcher';

type Tab = 'home' | 'map';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [mapRequest, setMapRequest] = useState<MapRequest | null>(null);

  const showShelters = (req: MapRequest) => {
    setMapRequest(req);
    setActiveTab('map');
  };

  return (
    <MobileFrame>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'auto', paddingBottom: '60px' }}>
          {activeTab === 'home' && <HomeScreen />}
          {activeTab === 'map' && <ShelterMap key={mapRequest?.nonce ?? 0} request={mapRequest} />}
        </div>
        <TabBar active={activeTab} onChange={setActiveTab} />
      </div>

      {/* 어느 탭에 있어도 위급 문자를 감시하고 팝업을 띄움 */}
      <EmergencyWatcher onShowShelters={showShelters} />
    </MobileFrame>
  );
}

export default App;