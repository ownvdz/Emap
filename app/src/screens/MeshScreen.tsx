import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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

import type { Result } from '../components/ReportPanel';
import type { LatLng } from '../core/geo';
import { getIdentity, newMessageId } from '../core/identity';
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
import { lastKnown, locate } from '../core/position';
import {
  bookActive,
  bookAdd,
  bookPrune,
  bookResolve,
  createBook,
  decodeWire,
  encodeReport,
  encodeResolve,
  REPORT_TTL_MS,
  utf8Length,
  type Book,
  type Draft,
  type Report,
  type WireReport,
  type WireResolve,
} from '../core/reports';

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
const MAX_MINE_ACTIVE = 5; // 한 기기가 동시에 올려 둘 수 있는 요청 수 (서버와 같은 한도)
const SYNC_MAX_REPORTS = 15; // 새 기기와 연결됐을 때 한꺼번에 전달해 주는 요청 수
const SYNC_MAX_RESOLVES = 10; // 같은 때 전달하는 취소·해결 소식 수
const SYNC_DELAY_MS = 1500; // 연결 직후 알림 구독이 자리 잡을 시간을 주고 전달 시작
const MAX_PARSE_LOGS = 10; // 해석하지 못한 패킷은 처음 몇 개만 로그에 남김 (크기 확인용)

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

type Topo = { f: string; h: number; g: 1; s: number; n: string[] };
type Line = { key: number; text: string };
type Wire = WireReport | WireResolve | Topo;

const rand = () => Math.random().toString(36).slice(2, 8);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// 근처 기기와 블루투스로 구조 요청·위험 제보·취소/해결을 주고받는 기능.
// enabled가 true인 동안만 광고·스캔·연결을 유지하고, false가 되면 모두 끊고 받은 목록도 비운다.
// (오프라인 화면은 항상 켜고, 온라인 화면에서는 사용자가 스위치로 켰을 때만 켠다)
export function useMesh(enabled: boolean) {
  const aliveRef = useRef(true); // 화면이 사라지면 false가 되어 진행 중이던 작업이 중단됨
  const myId = useRef(rand().slice(0, 4)).current;
  const peers = useRef(new Set<string>()); // 내가 Central로 연결한 링크(BLE 주소)
  const connecting = useRef(new Set<string>());
  const seen = useRef(new Set<string>()); // 취소·해결 메시지 중복 방지
  const directSeen = useRef(new Map<string, { pkt: number; scan: number }>()); // 앱 ID -> 직접 확인한 마지막 시각
  const graph = useRef<Graph>(createGraph()); // 다른 기기들이 알려준 이웃 목록
  const topoSeq = useRef(0);
  const lastTopoSent = useRef(0);
  const topoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const linkPeer = useRef(new Map<string, string>()); // 내가 연 링크(BLE 주소) -> 상대 앱 ID
  const lineKey = useRef(0);
  const scanSeen = useRef(new Set<string>());
  const connectChain = useRef<Promise<void>>(Promise.resolve());
  const book = useRef<Book>(createBook()); // 받은(그리고 내가 보낸) 요청 목록
  const ownerRef = useRef<string | null>(null); // 이 기기의 영구 ID (요청 소유자 표시)
  const parseFails = useRef(0);
  const maxPacket = useRef(0);

  const [status, setStatus] = useState('시작 중...');
  const [linkCount, setLinkCount] = useState(0);
  const [direct, setDirect] = useState<string[]>([]); // 직접 이웃
  const [treeLines, setTreeLines] = useState<TreeLine[]>([]);
  const [nodeCount, setNodeCount] = useState(1); // 나 포함 메시 전체
  const [lastTopo, setLastTopo] = useState('');
  const [events, setEvents] = useState<Line[]>([]); // 연결/오류 같은 시스템 이벤트
  const [reports, setReports] = useState<Report[]>([]);
  const [pos, setPos] = useState<LatLng | null>(null);

  // 시스템 이벤트 (자세히 보기에서만 보임)
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

  // 받은 목록을 화면과 지도 핀에 반영 (만료된 것은 정리)
  const syncReports = useCallback(() => {
    const now = Date.now();
    bookPrune(book.current, now);
    const list = bookActive(book.current, now);
    setReports(list);
  }, []);

  // 내 위치 (거리 표시용). 저장된 위치를 먼저 쓰고, 새 위치를 얻으면 갱신
  const refreshPos = useCallback(async () => {
    const last = await lastKnown();
    if (last && aliveRef.current) {
      setPos(p => p ?? last);
    }
    const here = await locate(20000);
    if (here && aliveRef.current) {
      setPos(here);
    }
  }, []);

  useEffect(() => {
    getIdentity().then(id => {
      ownerRef.current = id.ownerId;
    });
  }, []);

  // 켜질 때 내 위치 확인 (거리 표시용). 꺼져 있을 때는 위치 권한도 요청하지 않는다
  useEffect(() => {
    if (enabled) {
      refreshPos();
    }
  }, [enabled, refreshPos]);

  // 꺼지면 받은 목록·이웃 정보를 모두 비운다
  useEffect(() => {
    if (enabled) {
      return;
    }
    book.current = createBook();
    graph.current = createGraph();
    seen.current.clear();
    directSeen.current.clear();
    linkPeer.current.clear();
    scanSeen.current.clear();
    parseFails.current = 0;
    maxPacket.current = 0;
    setReports([]);
    setDirect([]);
    setTreeLines([]);
    setNodeCount(1);
    setLinkCount(0);
    setEvents([]);
    setLastTopo('');
    setStatus('꺼짐');
  }, [enabled]);

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
    syncReports();
  }, [getDirect, myId, syncReports]);

  // 보내는 JSON의 크기를 기록해 둔다 (협상된 MTU를 넘지 않는지 기기에서 확인하기 위함)
  const notePacket = useCallback(
    (json: string, label: string) => {
      const n = utf8Length(json);
      if (n > maxPacket.current) {
        maxPacket.current = n;
        log(`${label} 패킷 ${n}바이트 (지금까지 최대)`);
      }
    },
    [log],
  );

  // 연결된 모든 상대에게 전송 (내가 연결한 상대: write / 나에게 연결한 상대: notify)
  const broadcast = useCallback(
    (msg: Wire, silent = false) => {
      const json = JSON.stringify(msg);
      notePacket(json, 'g' in msg ? '이웃 목록' : '요청');
      const hex = toHex(json);
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
    [log, notePacket],
  );

  // 새로 연결된 기기 하나에게만, 지금 알고 있는 요청과 취소·해결 소식을 전달한다.
  // (먼저 만들어진 요청을 나중에 합류한 기기도 받게 하기 위함. 홉 1로 보내 그 이웃까지만 다시 퍼진다)
  const forwardStored = useCallback(
    async (link: string) => {
      const owner = ownerRef.current;
      if (!owner) {
        return;
      }
      const now = Date.now();
      const all = Array.from(book.current.items.values());
      const active = all
        .filter(r => !r.resolved && now - r.at <= REPORT_TTL_MS)
        .sort((a, b) => Number(b.mine) - Number(a.mine) || b.at - a.at)
        .slice(0, SYNC_MAX_REPORTS);
      const done = all
        .filter(r => r.resolved && r.owner)
        .sort((a, b) => b.at - a.at)
        .slice(0, SYNC_MAX_RESOLVES);
      const out: Wire[] = [
        ...active.map(r => encodeReport(r, myId, r.owner ?? owner, 1)),
        ...done.map(r => encodeResolve(`x${r.id}`, myId, r.owner as string, 1, r.id)),
      ];
      for (const w of out) {
        if (!aliveRef.current || !peers.current.has(link)) {
          return;
        }
        const json = JSON.stringify(w);
        notePacket(json, '전달');
        try {
          await writeCharacteristic(link, SERVICE_UUID, CHAR_UUID, toHex(json), 'write');
        } catch (e: any) {
          log(`저장분 전달 실패(${link.slice(-5)}): ${e?.message ?? e}`);
          return;
        }
        await sleep(120);
      }
      if (out.length > 0) {
        log(`새 연결(${link.slice(-5)})에 요청 ${active.length}건·해결 ${done.length}건 전달`);
      }
    },
    [log, myId, notePacket],
  );
  const forwardRef = useRef(forwardStored);
  forwardRef.current = forwardStored;

  // deviceId: 내가 연결한 상대가 notify로 보낸 경우에만 전달됨(링크 식별용)
  const handleIncoming = useCallback(
    (hex: string, deviceId?: string) => {
      let parsed: any;
      try {
        parsed = JSON.parse(fromHex(hex));
      } catch {
        // 크기가 협상된 MTU를 넘어 잘려 왔거나 다른 앱의 데이터. 처음 몇 개만 기록
        if (parseFails.current < MAX_PARSE_LOGS) {
          parseFails.current++;
          log(`해석하지 못한 패킷 (${Math.floor(String(hex).length / 2)}바이트) - 잘렸을 수 있음`);
        }
        return;
      }
      if (!parsed || typeof parsed.f !== 'string' || typeof parsed.h !== 'number' || parsed.f === myId) {
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

      const decoded = decodeWire(parsed, Date.now());
      if (!decoded) {
        return; // 옛 형식(채팅)이거나 형식이 올바르지 않은 데이터는 무시
      }
      const hops = Math.max(0, Math.min(parsed.h, MAX_HOPS));

      if (decoded.type === 'report') {
        // 앱을 다시 켠 뒤 주변 기기가 되돌려 준 내 요청도 내 것으로 인식 (취소·해결 가능)
        decoded.report.mine = decoded.report.owner === ownerRef.current;
        // 이미 알고 있는 요청이면 다시 중계하지 않는다 (이것이 중복·무한 전달 방지)
        if (bookAdd(book.current, decoded.report) === 'duplicate') {
          return;
        }
        syncReports();
        if (hops > 0) {
          broadcast({ ...(parsed as WireReport), h: hops - 1 });
        }
        return;
      }

      // 취소·해결: 요청을 만든 기기의 ID와 같을 때만 반영. 다른 기기의 것이면 무시하고 중계도 하지 않는다
      const key = `${parsed.i}.${decoded.owner}`;
      if (seen.current.has(key)) {
        return;
      }
      if (bookResolve(book.current, decoded.target, decoded.owner, Date.now()) === 'forbidden') {
        return;
      }
      seen.current.add(key);
      if (seen.current.size > MAX_SEEN) {
        const oldest = seen.current.values().next().value;
        if (oldest !== undefined) {
          seen.current.delete(oldest);
        }
      }
      syncReports();
      if (hops > 0) {
        broadcast({ ...(parsed as WireResolve), h: hops - 1 });
      }
    },
    [broadcast, log, markDirect, myId, refreshView, syncReports],
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
    if (!enabled) {
      return;
    }
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
  }, [enabled, sendTopology, refreshView]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setStatus('시작 중...');
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
              } catch (err: any) {
                log(`MTU 요청 실패(${id.slice(-5)}): ${err?.message ?? err} - 기본 크기(20바이트)로 통신될 수 있음`);
              }
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
              // 연결 순서 때문에 이 작업이 끝나길 기다리지 않고, 잠시 뒤 저장해 둔 요청을 전달
              setTimeout(() => {
                if (aliveRef.current) {
                  forwardRef.current(id);
                }
              }, SYNC_DELAY_MS);
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
  }, [enabled, log, myId, markDirect]);

  // ---------- 양식 처리 ----------
  const submit = useCallback(
    async (d: Draft): Promise<Result> => {
      const owner = ownerRef.current;
      if (!owner) {
        return { error: '준비 중입니다. 잠시 후 다시 시도해 주세요.' };
      }
      const activeMine = bookActive(book.current, Date.now()).filter(r => r.mine).length;
      if (activeMine >= MAX_MINE_ACTIVE) {
        return { error: `동시에 보낼 수 있는 요청은 ${MAX_MINE_ACTIVE}개까지입니다. 이전 요청을 취소·해결 처리해 주세요.` };
      }
      // 위험 제보는 지도에서 고른 위치를 쓸 수 있다
      const here = d.pos ? { ...d.pos, ageMin: 0 } : await locate(15000);
      if (!here) {
        return { error: '현재 위치를 확인하지 못했습니다. 위치 권한과 GPS(실내에서는 창가)를 확인해 주세요.' };
      }
      if (!d.pos) {
        setPos(here);
      }
      const report: Report = {
        id: newMessageId(),
        kind: d.kind,
        sub: d.sub,
        count: d.kind === 'sos' ? d.count : undefined,
        lat: here.lat,
        lng: here.lng,
        posAge: here.ageMin,
        note: d.note || undefined,
        at: Date.now(),
        owner,
        mine: true,
        resolved: false,
        via: 'ble',
      };
      bookAdd(book.current, report);
      syncReports();
      broadcast(encodeReport(report, myId, owner, MAX_HOPS));
      const info =
        here.ageMin > 0
          ? `${here.ageMin}분 전에 확인한 위치로 보냈습니다. (새 위치를 얻지 못함)`
          : undefined;
      if (peers.current.size === 0 && getDirect().length === 0) {
        return {
          info: '주변에 연결된 기기가 없어 저장해 두었습니다. 기기가 연결되면 자동으로 전달됩니다.',
        };
      }
      return { info };
    },
    [broadcast, getDirect, myId, syncReports],
  );

  const resolve = useCallback(
    async (r: Report): Promise<Result> => {
      const owner = ownerRef.current;
      if (!owner || r.owner !== owner) {
        return { error: '내가 보낸 요청만 취소·해결할 수 있습니다.' };
      }
      bookResolve(book.current, r.id, owner, Date.now());
      const msgId = `x${r.id}`;
      seen.current.add(`${msgId}.${owner}`);
      syncReports();
      broadcast(encodeResolve(msgId, myId, owner, MAX_HOPS, r.id));
      return {};
    },
    [broadcast, myId, syncReports],
  );

  return {
    status,
    direct,
    nodeCount,
    reports,
    pos,
    submit,
    resolve,
    treeLines,
    events,
    lastTopo,
    linkCount,
    sendTopology,
  };
}

export type Mesh = ReturnType<typeof useMesh>;

// 연결 상태 요약 (이웃 수)
export function MeshSummary({ mesh }: { mesh: Mesh }) {
  return (
    <View style={styles.statusBox}>
      <Text style={styles.statusLine}>{mesh.status}</Text>
      <Text style={styles.peers}>
        직접 이웃 {mesh.direct.length}대 · 메시 전체 {mesh.nodeCount - 1}대
      </Text>
    </View>
  );
}

// 연결 상태 자세히 보기: 이웃 트리와 이벤트 로그
export function MeshDetail({ mesh }: { mesh: Mesh }) {
  const [show, setShow] = useState(false);
  return (
    <View style={styles.detail}>
      <TouchableOpacity onPress={() => setShow(v => !v)}>
        <Text style={styles.detailToggle}>{show ? '▼ 연결 상태 접기' : '▶ 연결 상태 자세히 보기'}</Text>
      </TouchableOpacity>
      {show ? (
        <View>
          <ScrollView style={styles.tree} nestedScrollEnabled>
            {mesh.treeLines.map((l, i) => (
              <Text key={`${l.id}-${i}`} style={styles.treeLine}>
                {l.text}
              </Text>
            ))}
          </ScrollView>
          <View style={styles.treeFooter}>
            <Text style={styles.subSmall}>
              1분마다 갱신{mesh.lastTopo ? ` · 마지막 전송 ${mesh.lastTopo}` : ''} · 내가 연 연결 {mesh.linkCount}개
            </Text>
            <TouchableOpacity style={styles.toggle} onPress={mesh.sendTopology}>
              <Text style={styles.toggleText}>지금 갱신</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.events} nestedScrollEnabled>
            {mesh.events.map(l => (
              <Text key={l.key} style={styles.eventLine}>
                {l.text}
              </Text>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  statusBox: { marginBottom: 12, gap: 4 },
  statusLine: { fontSize: 13, color: '#555' },
  peers: { fontSize: 14, color: '#1565c0', fontWeight: '600' },
  detail: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderColor: '#e5e7eb' },
  detailToggle: { fontSize: 13, color: '#374151', fontWeight: '600', paddingVertical: 6 },
  toggle: { borderWidth: 1, borderColor: '#bbb', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  toggleText: { fontSize: 12, color: '#333' },
  subSmall: { fontSize: 12, color: '#888', flex: 1 },
  tree: { maxHeight: 130, marginTop: 6, padding: 8, backgroundColor: '#f5f7fa', borderRadius: 8 },
  treeLine: {
    fontSize: 13,
    lineHeight: 18,
    color: '#111',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
  },
  treeFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6, gap: 8 },
  events: { maxHeight: 180, marginTop: 8 },
  eventLine: { fontSize: 12, color: '#555', paddingVertical: 2 },
});
