import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
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
  disconnect,
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

import {
  applyTopology,
  buildTree,
  countNodes,
  createGraph,
  flattenTree,
  pruneGraph,
  type Graph,
  type TreeLine,
} from '../core/meshGraph';

// 우리 앱 전용 UUID (모든 기기가 같은 값을 써야 서로 찾음)
const SERVICE_UUID = '71f271d0-8f4c-4c4d-8a2d-6f3a9497b41d';
const CHAR_UUID = '4ad4a6d2-3f4a-477c-9832-5e0d8f7654d8';
const MAX_HOPS = 3;

// 토폴로지(이웃 목록) 갱신 설정
const TOPO_INTERVAL_MS = 60_000; // 이 간격으로 내 이웃 목록을 주변에 알림
const TOPO_JITTER_MS = 5_000; // 모든 기기가 동시에 보내 충돌하지 않도록 0~5초 무작위 지연
const TOPO_MIN_GAP_MS = 10_000; // 연결 변화로 앞당겨 보낼 때도 이 간격보다 자주 보내지 않음
const NODE_TTL_MS = 150_000; // 갱신 2.5번 동안 소식이 없으면 그래프에서 제거
const PKT_TTL_MS = 150_000; // 패킷으로 확인한 직접 이웃의 유효 시간
const SCAN_TTL_MS = 20_000; // 광고 스캔으로 확인한 이웃의 유효 시간
const MAX_NEIGHBORS_SENT = 12; // 패킷이 MTU(185)를 넘지 않도록 알리는 이웃 수 제한
const VIEW_REFRESH_MS = 5_000; // 화면 갱신 주기 (통신 없이 만료 처리만)
const MAX_SEEN = 500; // 중복 방지용 메시지 id 보관 한도

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

type Msg = { i: string; f: string; t: string; h: number };
// 토폴로지: 보낸 기기(f)의 직접 이웃 목록(n)과 순번(s). g:1이면 채팅이 아니라 토폴로지 메시지
type Topo = { f: string; h: number; g: 1; s: number; n: string[] };
type Line = { key: number; text: string; mine?: boolean };

const rand = () => Math.random().toString(36).slice(2, 8);

function BleChat({ onTurnOff }: { onTurnOff: () => void }) {
  const insets = useSafeAreaInsets();
  const aliveRef = useRef(true); // 메시를 끄면(화면이 사라지면) false가 되어 진행 중이던 작업이 중단됨
  const myId = useRef(rand().slice(0, 4)).current;
  const peers = useRef(new Set<string>()); // 내가 Central로 연결한 링크(BLE 주소)
  const connecting = useRef(new Set<string>());
  const seen = useRef(new Set<string>()); // 중복 메시지 방지
  const directSeen = useRef(new Map<string, { pkt: number; scan: number }>()); // 앱 ID -> 직접 확인한 마지막 시각
  const graph = useRef<Graph>(createGraph()); // 다른 기기들이 알려준 이웃 목록
  const topoSeq = useRef(0);
  const lastTopoSent = useRef(0);
  const topoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkPeer = useRef(new Map<string, string>()); // 내가 연 링크(BLE 주소) -> 상대 앱 ID
  const lineKey = useRef(0);
  const scanSeen = useRef(new Set<string>());
  const connectChain = useRef<Promise<void>>(Promise.resolve());
  const scrollRef = useRef<ScrollView | null>(null);

  const [status, setStatus] = useState('시작 중...');
  const [linkCount, setLinkCount] = useState(0);
  const [direct, setDirect] = useState<string[]>([]); // 직접 이웃
  const [treeLines, setTreeLines] = useState<TreeLine[]>([]);
  const [nodeCount, setNodeCount] = useState(1); // 나 포함 메시 전체
  const [lastTopo, setLastTopo] = useState('');
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

  // 직접 이웃을 확인했다고 기록 (pkt: 패킷을 직접 받음, scan: 광고 스캔에서 이름을 봄)
  const markDirect = useCallback((pid: string, kind: 'pkt' | 'scan') => {
    const t = directSeen.current.get(pid) ?? { pkt: 0, scan: 0 };
    t[kind] = Date.now();
    directSeen.current.set(pid, t);
  }, []);

  // 직접 이웃 = 연결된 링크의 상대 + 최근 광고 스캔으로 본 기기 + 최근 직접 받은 패킷의 보낸 기기
  const getDirect = useCallback((): string[] => {
    const now = Date.now();
    const ids = new Set<string>();
    peers.current.forEach(link => {
      const pid = linkPeer.current.get(link);
      if (pid) {
        ids.add(pid);
      }
    });
    directSeen.current.forEach((t, pid) => {
      if (now - t.pkt <= PKT_TTL_MS || now - t.scan <= SCAN_TTL_MS) {
        ids.add(pid);
      } else {
        directSeen.current.delete(pid);
      }
    });
    ids.delete(myId);
    return Array.from(ids).sort();
  }, [myId]);

  // 그래프에서 만료된 기기를 지우고, 내 기기를 뿌리로 한 트리를 다시 만든다 (통신 없음)
  const refreshView = useCallback(() => {
    pruneGraph(graph.current, Date.now(), NODE_TTL_MS);
    const neighbors = getDirect();
    const tree = buildTree(graph.current, myId, neighbors);
    setDirect(neighbors);
    setNodeCount(countNodes(tree));
    setTreeLines(flattenTree(tree, `나 (${myId})`));
  }, [getDirect, myId]);

  // 연결된 모든 상대에게 전송 (내가 연결한 상대: write / 나에게 연결한 상대: notify)
  const broadcast = useCallback(
    (msg: Msg | Topo, silent = false) => {
      const hex = toHex(JSON.stringify(msg));
      peers.current.forEach(id => {
        writeCharacteristic(id, SERVICE_UUID, CHAR_UUID, hex, 'write').catch((e: any) => {
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
    [log],
  );

  // deviceId: 내가 연결한 상대가 notify로 보낸 경우에만 전달됨(링크 식별용)
  const handleIncoming = useCallback(
    (hex: string, deviceId?: string) => {
      let parsed: Msg | Topo;
      try {
        parsed = JSON.parse(fromHex(hex));
      } catch {
        return;
      }
      if (!parsed || !parsed.f || parsed.f === myId) {
        return;
      }
      // 홉 수가 줄지 않은 채 도착했다면 보낸 기기가 바로 내 이웃이다 (중계된 메시지는 홉이 줄어 있음)
      if (parsed.h === MAX_HOPS) {
        markDirect(parsed.f, 'pkt');
        if (deviceId) {
          linkPeer.current.set(deviceId, parsed.f); // 이 링크의 상대가 누구인지 알 수 있음
        }
      }

      // 토폴로지: 더 새로운 순번이면 그래프에 반영하고 한 번만 중계
      if ('g' in parsed) {
        if (typeof parsed.s !== 'number' || !Array.isArray(parsed.n)) {
          return;
        }
        const neighbors = parsed.n.slice(0, MAX_NEIGHBORS_SENT).map(String);
        if (!applyTopology(graph.current, parsed.f, parsed.s, neighbors, Date.now())) {
          return;
        }
        refreshView();
        if (parsed.h > 0) {
          broadcast({ ...parsed, h: parsed.h - 1 }, true);
        }
        return;
      }

      const msg = parsed;
      if (!msg.i || seen.current.has(msg.i)) {
        return;
      }
      seen.current.add(msg.i);
      if (seen.current.size > MAX_SEEN) {
        const oldest = seen.current.values().next().value;
        if (oldest !== undefined) {
          seen.current.delete(oldest);
        }
      }
      addChat(`[${msg.f}] ${msg.t}`);
      if (msg.h > 0) {
        broadcast({ ...msg, h: msg.h - 1 }); // 단순 중계
      }
    },
    [addChat, broadcast, markDirect, myId, refreshView],
  );

  // 최신 handleIncoming을 이벤트 리스너에서 쓰기 위한 ref
  const incomingRef = useRef(handleIncoming);
  incomingRef.current = handleIncoming;

  // 내 이웃 목록을 알림 (순번을 붙여 모든 기기가 최신 것만 반영)
  const sendTopology = useCallback(() => {
    const now = Date.now();
    lastTopoSent.current = now;
    topoSeq.current = Math.max(topoSeq.current + 1, Math.floor(now / 1000)); // 앱을 다시 켜도 순번이 줄지 않게
    const msg: Topo = {
      f: myId,
      h: MAX_HOPS,
      g: 1,
      s: topoSeq.current,
      n: getDirect().slice(0, MAX_NEIGHBORS_SENT),
    };
    broadcast(msg, true);
    setLastTopo(new Date(now).toLocaleTimeString('ko-KR'));
    refreshView();
  }, [broadcast, getDirect, myId, refreshView]);

  // 연결이 바뀌었을 때 앞당겨 알리되, 너무 자주 보내지는 않음
  const scheduleTopology = useCallback(
    (delayMs: number) => {
      if (topoTimer.current) {
        return;
      }
      const wait = Math.max(delayMs, lastTopoSent.current + TOPO_MIN_GAP_MS - Date.now());
      topoTimer.current = setTimeout(() => {
        topoTimer.current = null;
        sendTopology();
      }, wait);
    },
    [sendTopology],
  );
  const scheduleTopoRef = useRef(scheduleTopology);
  scheduleTopoRef.current = scheduleTopology;

  // 1분마다 알리고(기기마다 조금씩 어긋나게), 화면은 5초마다 만료만 처리 (통신 없음)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      sendTopology();
      timer = setTimeout(loop, TOPO_INTERVAL_MS + Math.random() * TOPO_JITTER_MS);
    };
    timer = setTimeout(loop, 3000 + Math.random() * TOPO_JITTER_MS);
    const view = setInterval(refreshView, VIEW_REFRESH_MS);

    return () => {
      clearTimeout(timer);
      clearInterval(view);
      if (topoTimer.current) {
        clearTimeout(topoTimer.current);
        topoTimer.current = null;
      }
    };
  }, [sendTopology, refreshView]);

  useEffect(() => {
    aliveRef.current = true;
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

        // 권한 창이 떠 있는 동안 메시를 껐다면 여기서 중단
        if (!aliveRef.current) {
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
          scheduleTopoRef.current(2000); // 연결이 바뀌었으니 이웃 목록을 앞당겨 알림
        });
        listen('advertisingStarted', () => log('광고 시작됨'));
        listen('advertisingStartFailed', e =>
          log(`광고 실패: ${e?.message ?? e?.error ?? JSON.stringify(e)}`),
        );
        listen('scanFailed', e =>
          log(`스캔 실패: ${e?.message ?? JSON.stringify(e)}`),
        );

        // 발견한 기기에 자동 연결 (서비스 UUID 또는 이름 BT-로 상대 판별)
                // 발견한 기기에 자동 연결 (서비스 UUID 또는 이름 BT-로 상대 판별)
        listen('deviceFound', async d => {
          const id: string = d.id;
          const name = String(d.localName ?? d.name ?? '');

          if (!scanSeen.current.has(id) && scanSeen.current.size < 20) {
            scanSeen.current.add(id);
            log(`스캔: ${name || '(이름없음)'} ${id.slice(-5)}`);
          }

          // 광고 이름(BT-앱ID)이 보이면 연결 없이도 가까이 있다는 증거
          if (name.startsWith('BT-') && name.slice(3) !== myId) {
            markDirect(name.slice(3), 'scan');
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

          // 연결 작업은 한 번에 하나씩만 진행 (동시에 여러 기기에 연결하면 시간 초과가 나기 쉬움)
          connectChain.current = connectChain.current.then(async () => {
            try {
              await connect(id);
              try {
                await requestMTU(id, 185);
              } catch {}
              await discoverServices(id);
              if (!aliveRef.current) {
                // 연결하는 사이에 메시를 껐다면 바로 끊는다
                try {
                  disconnect(id);
                } catch {}
                return;
              }
              peers.current.add(id);
              setLinkCount(peers.current.size);
              log(`연결됨: ${name || id.slice(-5)}`);
              scheduleTopoRef.current(2000);
              try {
                await subscribeToCharacteristic(id, SERVICE_UUID, CHAR_UUID);
              } catch (err: any) {
                // 알림 구독이 실패해도 쓰기(write) 경로로는 통신할 수 있음
                log(`알림 구독 실패(${id.slice(-5)}): ${err?.message ?? err}`);
              }
            } catch (err: any) {
              log(`연결 실패(${id.slice(-5)}): ${err?.message ?? err}`);
            } finally {
              connecting.current.delete(id);
            }
          });
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
      aliveRef.current = false;
      offs.forEach(off => off());
      try {
        stopScan();
        stopAdvertising();
      } catch {}
      // 내가 연결한 상대와의 연결도 모두 끊는다
      peers.current.forEach(id => {
        try {
          disconnect(id);
        } catch {}
      });
      peers.current.clear();
      connecting.current.clear();
    };
  }, [log, myId, markDirect]);

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
            <Text style={styles.title}>근처 메시</Text>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>켜짐</Text>
              <Switch value onValueChange={() => onTurnOff()} />
            </View>
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
            직접 이웃 {direct.length}대 · 메시 전체 {nodeCount - 1}대
          </Text>
          <ScrollView style={styles.tree} nestedScrollEnabled>
            {treeLines.map((l, i) => (
              <Text key={`${l.id}-${i}`} style={styles.treeLine}>
                {l.text}
              </Text>
            ))}
          </ScrollView>
          <View style={styles.treeFooter}>
            <Text style={styles.subSmall}>
              1분마다 갱신{lastTopo ? ` · 마지막 전송 ${lastTopo}` : ''}
            </Text>
            <TouchableOpacity style={styles.toggle} onPress={sendTopology}>
              <Text style={styles.toggleText}>지금 갱신</Text>
            </TouchableOpacity>
          </View>
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

// 꺼져 있는 동안은 권한 요청·광고·스캔·연결을 전혀 하지 않는다 (배터리 절약)
function MeshOff({ onTurnOn }: { onTurnOn: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, styles.offRoot, { paddingTop: insets.top + 16 }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>근처 메시</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>꺼짐</Text>
          <Switch value={false} onValueChange={() => onTurnOn()} />
        </View>
      </View>
      <Text style={styles.offText}>
        켜면 인터넷 없이도 근처 기기와 블루투스로 메시지를 주고받고, 연결된 기기 구조를 트리로 보여줍니다.
      </Text>
      <Text style={styles.offText}>
        켜 두는 동안 블루투스 광고·스캔을 계속하므로 배터리를 더 사용합니다. 필요할 때만 켜 주세요. 끄면 연결이
        모두 끊기고 대화 내용과 기기 목록은 사라집니다.
      </Text>
      <TouchableOpacity style={styles.onBtn} onPress={onTurnOn}>
        <Text style={styles.btnText}>메시 켜기</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MeshScreen() {
  // 앱을 켤 때는 항상 꺼진 상태로 시작
  const [enabled, setEnabled] = useState(false);
  return enabled ? (
    <BleChat onTurnOff={() => setEnabled(false)} />
  ) : (
    <MeshOff onTurnOn={() => setEnabled(true)} />
  );
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
  tree: {
    maxHeight: 130,
    marginTop: 6,
    padding: 8,
    backgroundColor: '#f5f7fa',
    borderRadius: 8,
  },
  treeLine: {
    fontSize: 13,
    lineHeight: 18,
    color: '#111',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
  },
  treeFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  switchLabel: { fontSize: 12, color: '#555' },
  offRoot: { paddingHorizontal: 16 },
  offText: { marginTop: 14, fontSize: 14, lineHeight: 21, color: '#374151' },
  onBtn: {
    marginTop: 22,
    height: 46,
    borderRadius: 10,
    backgroundColor: '#1565c0',
    alignItems: 'center',
    justifyContent: 'center',
  },
});