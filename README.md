# 구조 요청 · 위험 제보 · 취소/해결 (온라인 + 오프라인)

## 파일 구성 (repo 루트 기준 같은 경로에 덮어쓰기)
server/src/reportsStore.js        (새 파일)
server/src/index.js               (수정: /api/reports 3개 경로, makeLimiter, push/register 한도)
app/App.tsx                       (수정: 탭 "근처 메시" → "구조·제보")
app/src/core/reports.ts           (새) 양식·블루투스 전송 형식·받은 목록
app/src/core/geo.ts               (새) 거리·방향
app/src/core/identity.ts          (새) 기기 ID·비밀 키
app/src/core/position.ts          (새) 현재 위치 + 마지막 위치
app/src/core/reportApi.ts         (새) 서버 호출, 인터넷 확인
app/src/core/reportPins.ts        (새) 지도에 반영한 핀 목록
app/src/core/mapBus.ts            (수정: focusReportId 추가)
app/src/components/ReportPanel.tsx (새) 양식 + 목록 화면
app/src/components/LocationPicker.tsx (새) 위험 제보 위치를 지도에서 고르는 화면
app/src/screens/HelpScreen.tsx    (새) 온라인/오프라인 전환
app/src/screens/MeshScreen.tsx    (교체) 채팅 → 블루투스 요청 전달 (useMesh 훅: 온라인 화면에서도 사용)
app/src/screens/MapScreen.tsx     (수정: 구조·제보 핀과 카드)

## 서버 적용
1. server/src 두 파일 교체
2. server/.gitignore 에 `data/` 추가 (요청 위치 정보가 server/data/reports.json 에 저장됨, git에 올리지 말 것)
3. sudo systemctl restart emap-server
4. 확인: curl -s https://emap-ownvdz.duckdns.org/api/reports  → {"items":[],"now":...}

## 앱 적용
- 위 app 파일을 덮어쓰고 APK를 다시 빌드 (새 네이티브 패키지 없음)
- 이전에 만든 BLE 채팅 기록은 사라지고, 옛 형식 메시지는 무시됨 (모두 같은 버전으로 업데이트 필요)
