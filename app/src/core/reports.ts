// 구조 요청·위험 제보: 양식 정의, 블루투스 전송 형식, 받은 목록 관리 (React/네이티브에 의존하지 않는 순수 로직)

export type ReportKind = 'sos' | 'hazard';

export const KIND_LABEL: Record<ReportKind, string> = { sos: '구조 요청', hazard: '위험 제보' };
export const KIND_COLOR: Record<ReportKind, string> = { sos: '#DC2626', hazard: '#F97316' };

export type SubOption = { code: string; label: string };
// 세부 종류. code는 전송 크기를 줄이려고 한 글자로 쓰고, 서버(reportsStore.js의 KINDS)와 같은 값이어야 한다.
export const SUBS: Record<ReportKind, SubOption[]> = {
  sos: [
    { code: 'i', label: '부상' },
    { code: 't', label: '갇힘' },
    { code: 'f', label: '화재' },
    { code: 'l', label: '길 잃음' },
  ],
  hazard: [
    { code: 'w', label: '침수' },
    { code: 'c', label: '붕괴' },
    { code: 'f', label: '화재' },
    { code: 'b', label: '통행 불가' },
  ],
};

export function subLabel(kind: ReportKind, code: string): string {
  return SUBS[kind].find(s => s.code === code)?.label ?? code;
}

export const REPORT_TTL_MS = 12 * 60 * 60 * 1000; // 12시간이 지나면 목록에서 사라짐 (서버와 같은 값)
export const NOTE_MAX_CHARS = 16; // 짧은 메모 (블루투스 패킷 크기를 고려한 한도)
export const MAX_COUNT = 99;
// 블루투스로 보내는 JSON의 최대 바이트. 협상한 MTU(185) 안에 여유를 두고 들어가도록 정한 값이며, 실제 한도는 기기에서 확인이 필요하다.
export const MAX_PACKET_BYTES = 150;
const MAX_BOOK = 200;
const MAX_TOMBS = 500;

export type Draft = { kind: ReportKind; sub: string; count: number; note: string };

export type Report = {
  id: string;
  kind: ReportKind;
  sub: string;
  count?: number; // 구조 요청의 인원 수
  lat?: number;
  lng?: number;
  posAge?: number; // 위치를 확인한 지 몇 분이 지났는지 (0이면 방금)
  note?: string;
  at: number; // 만들어진 시각(서버 경유) 또는 처음 받은 시각(블루투스), ms
  owner?: string; // 블루투스: 보낸 기기의 영구 ID
  mine: boolean;
  resolved: boolean;
  via: 'net' | 'ble';
};

// ---------- 블루투스 전송 형식 ----------
// 패킷 크기를 줄이려고 키를 한 글자로 쓴다.
//   i 메시지 id, f 보낸 기기(실행마다 바뀌는 ID), h 남은 홉, o 요청을 만든 기기의 영구 ID
//   k 's' 구조 요청 / 'd' 위험 제보 / 'x' 취소·해결, a 세부 종류, c 인원, y 위도×1e5, z 경도×1e5, w 위치 확인 후 경과 분, n 메모, r 취소·해결 대상 id
export type WireReport = {
  i: string;
  f: string;
  h: number;
  k: 's' | 'd';
  o: string;
  a: string;
  c?: number;
  y?: number;
  z?: number;
  w?: number;
  n?: string;
};
export type WireResolve = { i: string; f: string; h: number; k: 'x'; o: string; r: string };

export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

export function trimToBytes(s: string, maxBytes: number): string {
  let out = '';
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    const len = c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
    if (n + len > maxBytes) {
      break;
    }
    out += ch;
    n += len;
  }
  return out;
}

type Encodable = Pick<Report, 'id' | 'kind' | 'sub' | 'count' | 'lat' | 'lng' | 'posAge' | 'note'>;

export function encodeReport(r: Encodable, sender: string, owner: string, hops: number): WireReport {
  const w: WireReport = { i: r.id, f: sender, h: hops, k: r.kind === 'sos' ? 's' : 'd', o: owner, a: r.sub };
  if (r.kind === 'sos' && r.count !== undefined && r.count > 1) {
    w.c = Math.min(r.count, MAX_COUNT);
  }
  if (r.lat !== undefined && r.lng !== undefined) {
    w.y = Math.round(r.lat * 1e5);
    w.z = Math.round(r.lng * 1e5);
    if (r.posAge) {
      w.w = Math.min(Math.round(r.posAge), 9999);
    }
  }
  const note = (r.note ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (note) {
    // 메모는 남은 크기에 맞춰 자른다
    const room = MAX_PACKET_BYTES - utf8Length(JSON.stringify(w)) - utf8Length(',"n":""');
    const n = trimToBytes(note, Math.max(room, 0));
    if (n) {
      w.n = n;
    }
  }
  return w;
}

export function encodeResolve(id: string, sender: string, owner: string, hops: number, target: string): WireResolve {
  return { i: id, f: sender, h: hops, k: 'x', o: owner, r: target };
}

export type Decoded =
  | { type: 'report'; report: Report }
  | { type: 'resolve'; target: string; owner: string };

const isId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9]{1,12}$/.test(v);
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

// 받은 데이터를 검사해서 해석한다. 형식이 맞지 않으면 null (옛 형식·잘못된 값은 무시)
export function decodeWire(obj: unknown, now: number): Decoded | null {
  if (!obj || typeof obj !== 'object') {
    return null;
  }
  const w = obj as Record<string, unknown>;
  if (!isId(w.i) || !isId(w.f) || !isId(w.o)) {
    return null;
  }
  if (w.k === 'x') {
    return isId(w.r) ? { type: 'resolve', target: w.r, owner: w.o } : null;
  }
  if (w.k !== 's' && w.k !== 'd') {
    return null;
  }
  const kind: ReportKind = w.k === 's' ? 'sos' : 'hazard';
  if (typeof w.a !== 'string' || !SUBS[kind].some(s => s.code === w.a)) {
    return null;
  }

  let count: number | undefined;
  if (kind === 'sos') {
    if (w.c === undefined) {
      count = 1;
    } else if (isInt(w.c, 1, MAX_COUNT)) {
      count = w.c;
    } else {
      return null;
    }
  }

  let lat: number | undefined;
  let lng: number | undefined;
  if (w.y !== undefined || w.z !== undefined) {
    if (!isInt(w.y, -9_000_000, 9_000_000) || !isInt(w.z, -18_000_000, 18_000_000)) {
      return null;
    }
    lat = w.y / 1e5;
    lng = w.z / 1e5;
  }

  const posAge = isInt(w.w, 0, 9999) ? w.w : 0;
  const note =
    typeof w.n === 'string' ? w.n.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 40) || undefined : undefined;

  return {
    type: 'report',
    report: {
      id: w.i,
      kind,
      sub: w.a,
      count,
      lat,
      lng,
      posAge,
      note,
      at: now,
      owner: w.o,
      mine: false,
      resolved: false,
      via: 'ble',
    },
  };
}

// ---------- 받은 요청 목록 (블루투스) ----------
// tomb: 대상 요청보다 취소·해결 메시지가 먼저 도착한 경우를 위해 기억해 둔다
export type Book = {
  items: Map<string, Report>;
  tomb: Map<string, { owner: string; at: number }>;
};

export const createBook = (): Book => ({ items: new Map(), tomb: new Map() });

export function bookAdd(book: Book, report: Report): 'added' | 'duplicate' | 'resolved' {
  if (book.items.has(report.id)) {
    return 'duplicate';
  }
  const r: Report = { ...report };
  const t = book.tomb.get(r.id);
  if (t && t.owner === r.owner) {
    r.resolved = true;
  }
  if (book.items.size >= MAX_BOOK) {
    // 가장 오래된 것부터 정리
    let oldest: Report | null = null;
    book.items.forEach(x => {
      if (!oldest || x.at < oldest.at) {
        oldest = x;
      }
    });
    if (oldest) {
      book.items.delete((oldest as Report).id);
    }
  }
  book.items.set(r.id, r);
  return r.resolved ? 'resolved' : 'added';
}

// 요청을 만든 기기(owner)만 취소·해결할 수 있다. 대상을 아직 모르면 나중에 도착할 것에 적용하려고 기억해 둔다
export function bookResolve(
  book: Book,
  id: string,
  owner: string,
  now: number,
): 'resolved' | 'unknown' | 'forbidden' {
  const r = book.items.get(id);
  if (!r) {
    if (book.tomb.size >= MAX_TOMBS) {
      const first = book.tomb.keys().next().value;
      if (first !== undefined) {
        book.tomb.delete(first);
      }
    }
    book.tomb.set(id, { owner, at: now });
    return 'unknown';
  }
  if (r.owner !== owner) {
    return 'forbidden';
  }
  r.resolved = true;
  return 'resolved';
}

// 만료된 것을 지운다. 바뀐 게 있으면 true
export function bookPrune(book: Book, now: number): boolean {
  let changed = false;
  book.items.forEach((r, id) => {
    if (now - r.at > REPORT_TTL_MS) {
      book.items.delete(id);
      changed = true;
    }
  });
  book.tomb.forEach((t, id) => {
    if (now - t.at > REPORT_TTL_MS) {
      book.tomb.delete(id);
    }
  });
  return changed;
}

export function bookActive(book: Book, now: number): Report[] {
  const out: Report[] = [];
  book.items.forEach(r => {
    if (!r.resolved && now - r.at <= REPORT_TTL_MS) {
      out.push(r);
    }
  });
  return out;
}

// ---------- 화면 표시용 ----------
// 구조 요청이 먼저, 그 안에서는 내 위치에서 가까운 순(위치를 모르면 최신순). 위치 정보가 없는 요청은 뒤로
export function sortReports(list: Report[], pos: { lat: number; lng: number } | null): Report[] {
  const dist = (r: Report): number => {
    if (!pos || r.lat === undefined || r.lng === undefined) {
      return Infinity;
    }
    const dy = r.lat - pos.lat;
    const dx = (r.lng - pos.lng) * Math.cos((pos.lat * Math.PI) / 180);
    return dx * dx + dy * dy;
  };
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'sos' ? -1 : 1;
    }
    if (pos) {
      const da = dist(a);
      const db = dist(b);
      if (da !== db) {
        return da < db ? -1 : 1;
      }
    }
    return b.at - a.at;
  });
}

export function ageText(at: number, now: number): string {
  const min = Math.floor(Math.max(now - at, 0) / 60_000);
  if (min < 1) {
    return '방금';
  }
  if (min < 60) {
    return `${min}분 전`;
  }
  return `${Math.floor(min / 60)}시간 전`;
}
