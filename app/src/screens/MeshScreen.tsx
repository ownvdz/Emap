import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  addEventListener,
  connect,
  discoverServices,
  isBluetoothEnabled,
  requestBluetoothPermission,
  requestMTU,
  setServices,
  startAdvertising,
  startScan,
  stopAdvertising,
  stopScan,
  subscribeToCharacteristic,
  updateCharacteristicValue,
  writeCharacteristic,
} from 'munim-bluetooth';

// 우리 앱 전용 UUID (모든 기기가 같은 값을 써야 서로 찾음)
const SERVICE_UUID = '71f271d0-8f4c-4c4d-8a2d-6f3a9497b41d';
const CHAR_UUID = '4ad4a6d2-3f4a-477c-9832-5e0d8f7654d8';
const MAX_HOPS = 3;

// 생존 확인 설정
const PING_INTERVAL_MS = 5000; // 이 간격으로 "나 여기 있음" 신호 전송
const PEER_TIMEOUT_MS = 15000; // 이 시간 동안 확인이 없으면 기기가 사라진 것으로 처리

// ---------- 문자열 <-> hex (UTF-8) ----------
function toHex(s: string): string {
  const bytes: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c < 0x10000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    } else {
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 63),
        0x80 | ((c >> 6) & 63),
        0x80 | (c & 63),
      );
    }
  }
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hexRaw: string): string {
  const h = hexRaw.replace(/[^0-9a-fA-F]/g, '');
  const b: number[] = [];
  for (let k = 0; k + 1 < h.length; k += 2) {
    b.push(parseInt(h.substring(k, k + 2), 16));
  }
  let out = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c < 0xe0) {
      out += String.fromCharCode(((c & 31) << 6) | (b[i++] & 63));
    } else if (c < 0xf0) {
      out += String.fromCharCode(
        ((c & 15) << 12) | ((b[i++] & 63) << 6) | (b[i++] & 63),
      );
    } else {
      const cp =
        ((c & 7) << 18) |
        ((b[i++] & 63) << 12) |
        ((b[i++] & 63) << 6) |
        (b[i++] & 63);
      out += String.fromCodePoint(cp);
    }
  }
  return out;
}

// p: 1 이면 생존 신호(화면에 표시하지 않고 중계하지 않음)
type Msg = { i: string; f: string; t: string; h: number; p?: number };
type Line = { key: number; text: string; mine?: boolean };

const rand = () => Math.random().toString(36).slice(2, 8);

function BleChat() {
  const insets = useSafeAreaInsets();
  const myId = useRef(rand().slice(0, 4)).current;
  const peers = useRef(new Set<string>()); // 내가 Central로 연결한 링크(BLE 주소)
  const connecting = useRef(new Set<string>());
  const seen = useRef(new Set<string>()); // 중복 메시지 방지
  const presence = useRef(new Map<string, number>()); // 앱 ID -> 마지막 생존 확인 시각
  const linkPeer = useRef(new Map<string, string>()); // 내가 연 링크(BLE 주소) -> 상대 앱 ID
  const lineKey = useRef(0);
  const scanSeen = useRef(new Set<string>());
  const scrollRef = useRef<ScrollView | null>(null);

  const [status, setStatus] = useState('시작 중...');
  const [linkCount, setLinkCount] = useState(0);
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [chat, setChat] = useState<Line[]>([]); // 채팅 메시지만
  const [events, setEvents] = useState<Line[]>([]); // 연결/오류 같은 시스템 이벤트
  const [showEvents, setShowEvents] = useState(false);
  const [kbVisible, setKbVisible] = useState(false);

  useEffect(() => {
    const s1 = Keyboard.addListener('keyboardDidShow', () => setKbVisible(true));
    const s2 = Keyboard.addListener('keyboardDidHide', () => setKbVisible(false));
    return () => {
      s1.remove();
      s2.remove();
    };
  }, []);

  // 시스템 이벤트 (이벤트 로그 화면에서만 보임)
  const log = useCallback((text: string) => {
    const t = new Date();
    const hh = String(t.getHours()).padStart(2, '0');
    const mm = String(t.getMinutes()).padStart(2, '0');
    const ss = String(t.getSeconds()).padStart(2, '0');
    setEvents(prev => [
      ...prev.slice(-199),
      { key: lineKey.current++, text: `${hh}:${mm}:${ss} ${text}` },
    ]);
  }, []);

  // 채팅 메시지
  const addChat = useCallback((text: string, mine = false) => {
    setChat(prev => [...prev.slice(-199), { key: lineKey.current++, text, mine }]);
  }, []);

  // 상대 앱이 살아 있음을 표시 (생존 신호 수신 또는 쓰기 응답 확인 시)
  const markAlive = useCallback(
    (pid: string) => {
      if (!presence.current.has(pid)) {
        log(`기기 확인: ${pid}`);
      }
      presence.current.set(pid, Date.now());
      setPeerIds(Array.from(presence.current.keys()));
    },
    [log],
  );

  // 연결된 모든 상대에게 전송 (내가 연결한 상대: write / 나에게 연결한 상대: notify)
  const broadcast = useCallback(
    (msg: Msg, silent = false) => {
      const hex = toHex(JSON.stringify(msg));
      peers.current.forEach(id => {
        writeCharacteristic(id, SERVICE_UUID, CHAR_UUID, hex, 'write')
          .then(() => {
            // 쓰기 응답이 왔다 = 상대 기기의 블루투스가 살아 있음 (상대 앱 타이머와 무관)
            const pid = linkPeer.current.get(id);
            if (pid) {
              markAlive(pid);
            }
          })
          .catch((e: any) => {
            if (!silent) {
              log(`전송 실패(${id.slice(-5)}): ${e?.message ?? e}`);
            }
          });
      });
      try {
        updateCharacteristicValue(SERVICE_UUID, CHAR_UUID, hex, true);
      } catch (e: any) {
        if (!silent) {
          log(`notify 실패: ${e?.message ?? e}`);
        }
      }
    },
    [log, markAlive],
  );

  // deviceId: 내가 연결한 상대가 notify로 보낸 경우에만 전달됨(링크 식별용)
  const handleIncoming = useCallback(
    (hex: string, deviceId?: string) => {
      let msg: Msg;
      try {
        msg = JSON.parse(fromHex(hex));
      } catch {
        return;
      }
      if (!msg || !msg.f || msg.f === myId) {
        return;
      }
      // 생존 신호: 주변 기기 목록만 갱신
      if (msg.p) {
        // 생존 신호는 중계되지 않으므로, 이 링크의 상대가 누구인지 알 수 있음
        if (deviceId) {
          linkPeer.current.set(deviceId, msg.f);
        }
        markAlive(msg.f);
        return;
      }
      if (!msg.i || seen.current.has(msg.i)) {
        return;
      }
      seen.current.add(msg.i);
      addChat(`[${msg.f}] ${msg.t}`);
      if (msg.h > 0) {
        broadcast({ ...msg, h: msg.h - 1 }); // 단순 중계
      }
    },
    [addChat, broadcast, markAlive, myId],
  );

  // 최신 handleIncoming을 이벤트 리스너에서 쓰기 위한 ref
  const incomingRef = useRef(handleIncoming);
  incomingRef.current = handleIncoming;

  // 생존 신호 전송 + 사라진 기기 정리
  useEffect(() => {
    const pingTimer = setInterval(() => {
      broadcast({ i: rand(), f: myId, t: '', h: 0, p: 1 }, true);
    }, PING_INTERVAL_MS);

    const pruneTimer = setInterval(() => {
      const now = Date.now();
      presence.current.forEach((ts, pid) => {
        if (now - ts > PEER_TIMEOUT_MS) {
          presence.current.delete(pid);
          log(`기기 사라짐: ${pid}`);
        }
      });
      setPeerIds(Array.from(presence.current.keys()));
    }, 3000);

    return () => {
      clearInterval(pingTimer);
      clearInterval(pruneTimer);
    };
  }, [broadcast, log, myId]);

  useEffect(() => {
    const offs: Array<() => void> = [];
    const listen = (name: string, cb: (e: any) => void) => {
      const off: any = (addEventListener as any)(name, cb);
      if (typeof off === 'function') {
        offs.push(off);
      }
    };

    (async () => {
      try {
        const ok = await requestBluetoothPermission();
        if (!ok) {
          setStatus('블루투스 권한이 거부됨');
          return;
        }
        // 라이브러리가 광고 권한을 요청하지 않아서 직접 요청
        if (Platform.OS === 'android') {
          const r = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]);
          if (
            r['android.permission.BLUETOOTH_ADVERTISE'] !== 'granted' ||
            r['android.permission.BLUETOOTH_SCAN'] !== 'granted' ||
            r['android.permission.BLUETOOTH_CONNECT'] !== 'granted'
          ) {
            setStatus('근처 기기 권한을 허용해 주세요');
            return;
          }
          if (r['android.permission.ACCESS_FINE_LOCATION'] !== 'granted') {
            log('위치 권한이 없어 주변 기기 스캔이 안 될 수 있습니다');
          }
        }
        if (!(await isBluetoothEnabled())) {
          setStatus('블루투스를 켜 주세요');
          return;
        }

        // GATT 서버: 메시지 주고받는 characteristic 1개
        setServices([
          {
            uuid: SERVICE_UUID,
            characteristics: [
              {
                uuid: CHAR_UUID,
                properties: ['read', 'write', 'writeWithoutResponse', 'notify'],
                value: '00',
              },
            ],
          },
        ]);

        // 상대가 내게 write 한 메시지
        listen('peripheralWriteRequest', e => incomingRef.current(e.value));
        // 내가 연결한 상대가 notify 한 메시지
        listen('characteristicValueChanged', e => {
          if (String(e.characteristicUUID).toLowerCase() === CHAR_UUID) {
            incomingRef.current(e.value, e.deviceId);
          }
        });
        listen('deviceDisconnected', e => {
          peers.current.delete(e.deviceId);
          linkPeer.current.delete(e.deviceId);
          setLinkCount(peers.current.size);
          log(`연결 끊김: ${String(e.deviceId).slice(-5)}`);
        });
        listen('advertisingStarted', () => log('광고 시작됨'));
        listen('advertisingStartFailed', e =>
          log(`광고 실패: ${e?.message ?? e?.error ?? JSON.stringify(e)}`),
        );
        listen('scanFailed', e =>
          log(`스캔 실패: ${e?.message ?? JSON.stringify(e)}`),
        );

        // 발견한 기기에 자동 연결 (서비스 UUID 또는 이름 BT-로 상대 판별)
        listen('deviceFound', async d => {
          const id: string = d.id;
          const name = String(d.localName ?? d.name ?? '');
          if (!scanSeen.current.has(id) && scanSeen.current.size < 20) {
            scanSeen.current.add(id);
            log(`스캔: ${name || '(이름없음)'} ${id.slice(-5)}`);
          }
          const isPeer =
            JSON.stringify(d).toLowerCase().includes('71f271d0') ||
            name.startsWith('BT-');
          if (!isPeer) {
            return;
          }
          if (peers.current.has(id) || connecting.current.has(id)) {
            return;
          }
          if (name.startsWith('BT-')) {
            linkPeer.current.set(id, name.slice(3)); // 광고 이름에서 상대 앱 ID를 미리 알아냄
          }
          log(`상대 발견: ${name || '(이름없음)'} ${id.slice(-5)}`);
          connecting.current.add(id);
          try {
            await connect(id);
            try {
              await requestMTU(id, 185);
            } catch {}
            await discoverServices(id);
            subscribeToCharacteristic(id, SERVICE_UUID, CHAR_UUID);
            peers.current.add(id);
            setLinkCount(peers.current.size);
            log(`연결됨: ${name || id.slice(-5)}`);
          } catch (err: any) {
            log(`연결 실패(${id.slice(-5)}): ${err?.message ?? err}`);
          } finally {
            connecting.current.delete(id);
          }
        });

        startAdvertising({
          serviceUUIDs: [SERVICE_UUID],
          localName: `BT-${myId}`,
        });
        startScan({
          allowDuplicates: true,
          scanMode: 'lowLatency',
        });
        setStatus(`실행 중 (내 ID: ${myId})`);
      } catch (e: any) {
        setStatus(`시작 실패: ${e?.message ?? e}`);
      }
    })();

    return () => {
      offs.forEach(off => off());
      try {
        stopScan();
        stopAdvertising();
      } catch {}
    };
  }, [log, myId]);

  const send = () => {
    const text = input.trim();
    if (!text) {
      return;
    }
    const msg: Msg = { i: rand(), f: myId, t: text, h: MAX_HOPS };
    seen.current.add(msg.i);
    addChat(`나: ${text}`, true);
    broadcast(msg);
    setInput('');
  };

  // Android 15+(API 35+)는 앱이 시스템 바 아래까지 그려지므로 키보드 높이를 직접 처리
  const needsKeyboardAvoid =
    Platform.OS === 'ios' || (Platform.OS === 'android' && Platform.Version >= 35);

  const lines = showEvents ? events : chat;

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
        enabled={needsKeyboardAvoid}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>BLE 메시지 테스트</Text>
            <TouchableOpacity
              style={styles.toggle}
              onPress={() => setShowEvents(v => !v)}>
              <Text style={styles.toggleText}>
                {showEvents ? '채팅 보기' : '이벤트 로그'}
              </Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.sub}>{status}</Text>
          <Text style={styles.peers}>
            연결된 기기 ({peerIds.length}대)
            {peerIds.length > 0 ? `: ${peerIds.join(', ')}` : ''}
          </Text>
          {showEvents ? (
            <Text style={styles.subSmall}>내가 연 BLE 연결 {linkCount}개</Text>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.log}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: false })
          }>
          {lines.map(l => (
            <Text
              key={l.key}
              style={[
                showEvents ? styles.eventLine : styles.logLine,
                l.mine ? styles.mine : null,
              ]}>
              {l.text}
            </Text>
          ))}
        </ScrollView>

        <View style={[styles.inputRow, { paddingBottom: 12 }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder="메시지 (30자 이내)"
            placeholderTextColor="#888"
            maxLength={30}
            onSubmitEditing={send}
          />
          <TouchableOpacity style={styles.btn} onPress={send}>
            <Text style={styles.btnText}>보내기</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export default function MeshScreen() {
  return <BleChat />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: { flex: 1, backgroundColor: '#fff' },
  header: { padding: 16, borderBottomWidth: 1, borderColor: '#ddd' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 20, fontWeight: '700', color: '#111' },
  toggle: {
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toggleText: { fontSize: 12, color: '#333' },
  sub: { fontSize: 13, color: '#555', marginTop: 4 },
  subSmall: { fontSize: 12, color: '#888', marginTop: 2 },
  peers: { fontSize: 14, color: '#1565c0', fontWeight: '600', marginTop: 4 },
  log: { flex: 1, padding: 12 },
  logLine: { fontSize: 15, color: '#222', paddingVertical: 4 },
  eventLine: { fontSize: 12, color: '#555', paddingVertical: 2 },
  mine: { color: '#1565c0' },
  inputRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderColor: '#ddd',
    gap: 8,
  },
  input: {
    flex: 1,
    height: 46,
    borderWidth: 1,
    borderColor: '#bbb',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#111',
  },
  btn: {
    backgroundColor: '#1565c0',
    borderRadius: 8,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600' },
});