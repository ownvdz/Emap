import DisasterAlerts from './DisasterAlerts';

export default function HomeScreen() {
  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>비상대피소 지도</h1>
      <p style={{ color: '#4b5563', fontSize: 14 }}>가까운 비상대피소를 찾고, 정보를 공유하세요.</p>

      <DisasterAlerts />
    </div>
  );
}