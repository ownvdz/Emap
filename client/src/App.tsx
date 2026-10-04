import { useState } from 'react';
import HomeScreen from './components/HomeScreen';
import ShelterMap from './components/ShelterMap';
import TabBar from './components/TabBar';
import MobileFrame from './components/MobileFrame';

type Tab = 'home' | 'map';

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home');

  return (
    <MobileFrame>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflow: 'auto', paddingBottom: '60px' }}>
          {activeTab === 'home' && <HomeScreen />}
          {activeTab === 'map' && <ShelterMap />}
        </div>

        <TabBar active={activeTab} onChange={setActiveTab} />
      </div>
    </MobileFrame>
  );
}

export default App;