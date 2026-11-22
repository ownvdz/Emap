// 구조 요청·위험 제보 저장소 (인터넷이 되는 기기끼리 서버로 주고받는 경로).
// 재난 상황의 임시 데이터라 DB 대신 메모리 + JSON 파일에 둔다. 위치 정보가 들어 있으므로 파일 권한은 600.
// 위치: server/data/reports.json (REPORT_FILE 환경변수로 바꿀 수 있음). 이 폴더는 git에 올리지 않는다.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE =
  process.env.REPORT_FILE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'reports.json');

export const TTL_MS = 12 * 60 * 60 * 1000; // 12시간이 지나면 자동으로 사라짐
const RESOLVED_KEEP_MS = 60 * 60 * 1000; // 해결·취소된 것은 1시간 뒤 정리
export const MAX_REPORTS = 2000;
export const MAX_ACTIVE_PER_OWNER = 5; // 한 기기가 동시에 올려 둘 수 있는 요청 수
const MAX_NOTE_CHARS = 40;

// 종류별로 허용하는 세부 코드 (앱과 같은 값)
export const KINDS = {
  sos: ['i', 't', 'f', 'l'], // 부상, 갇힘, 화재, 길 잃음
  hazard: ['w', 'c', 'f', 'b'], // 침수, 붕괴, 화재, 통행 불가
};

const inKorea = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

export const isValidKey = (k) => typeof k === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(k);
// 기기만 아는 비밀 키는 저장하지 않고 해시만 저장한다 (남의 요청을 취소하지 못하게 하는 용도)
const hashKey = (k) => crypto.createHash('sha256').update(k).digest('hex').slice(0, 32);

const cleanNote = (s) =>
  typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NOTE_CHARS) : '';

function distKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

let cache = null; // Map<id, report>
let writing = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    const arr = JSON.parse(await fs.readFile(FILE, 'utf8'));
    cache = new Map(arr.map((r) => [r.id, r]));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[reports] 파일을 읽지 못해 빈 목록으로 시작합니다:', e.message);
    cache = new Map();
  }
  return cache;
}

// 저장은 한 번에 하나씩, 임시 파일에 쓴 뒤 바꿔치기해서 도중에 꺼져도 파일이 깨지지 않게 한다
function persist() {
  writing = writing
    .then(async () => {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify([...cache.values()]), { mode: 0o600 });
      await fs.rename(tmp, FILE);
    })
    .catch((e) => console.error('[reports] 파일 저장 실패:', e.message));
  return writing;
}

// 만료된 것과 오래된 해결 건을 정리. 바뀐 게 있으면 true
function purge(map, now) {
  let changed = false;
  for (const [id, r] of map) {
    const expired = now - r.createdAt > TTL_MS;
    const doneOld = r.resolvedAt && now - r.resolvedAt > RESOLVED_KEEP_MS;
    if (expired || doneOld) {
      map.delete(id);
      changed = true;
    }
  }
  return changed;
}

const active = (r, now) => !r.resolvedAt && now - r.createdAt <= TTL_MS;

// 요청 등록. 결과는 { status, body } 로 돌려준다 (라우터는 그대로 응답에 쓰기만 하면 됨)
export async function createReport(body, now = Date.now()) {
  const b = body ?? {};
  const kind = b.kind;
  if (!Object.hasOwn(KINDS, kind) || !KINDS[kind].includes(b.sub)) {
    return { status: 400, body: { error: '종류가 올바르지 않습니다.' } };
  }
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!inKorea(lat, lng)) {
    return { status: 400, body: { error: '위치가 올바르지 않습니다.' } };
  }
  if (!isValidKey(b.key)) {
    return { status: 400, body: { error: '기기 키가 올바르지 않습니다.' } };
  }

  let count = null;
  if (kind === 'sos') {
    count = b.count === undefined ? 1 : Number(b.count);
    if (!Number.isInteger(count) || count < 1 || count > 99) {
      return { status: 400, body: { error: '인원 수가 올바르지 않습니다.' } };
    }
  }
  // 오래된 위치를 쓴 경우 몇 분 전 위치인지 (0~9999분)
  let posAge = 0;
  if (b.posAge !== undefined) {
    posAge = Number(b.posAge);
    if (!Number.isInteger(posAge) || posAge < 0 || posAge > 9999) posAge = 0;
  }

  const map = await load();
  purge(map, now);
  const ownerHash = hashKey(b.key);
  let mine = 0;
  for (const r of map.values()) if (r.ownerHash === ownerHash && active(r, now)) mine++;
  if (mine >= MAX_ACTIVE_PER_OWNER) {
    return { status: 429, body: { error: `동시에 올릴 수 있는 요청은 ${MAX_ACTIVE_PER_OWNER}개까지입니다. 이전 요청을 취소·해결 처리해 주세요.` } };
  }
  if (map.size >= MAX_REPORTS) {
    return { status: 507, body: { error: '지금은 더 등록할 수 없습니다.' } };
  }

  const id = crypto.randomBytes(5).toString('hex');
  map.set(id, {
    id,
    kind,
    sub: b.sub,
    count,
    lat,
    lng,
    posAge,
    note: cleanNote(b.note),
    createdAt: now,
    ownerHash,
    resolvedAt: null,
  });
  await persist();
  return { status: 201, body: { id, createdAt: now } };
}

// 목록 조회: 해결·만료되지 않은 것만. 위치를 주면 반경(기본 30km, 최대 200km) 안에서 가까운 순
export async function listReports(query, ownerKey, now = Date.now()) {
  const q = query ?? {};
  const map = await load();
  if (purge(map, now)) await persist();

  const hasPos = q.lat !== undefined && q.lng !== undefined;
  const lat = Number(q.lat);
  const lng = Number(q.lng);
  if (hasPos && !inKorea(lat, lng)) {
    return { status: 400, body: { error: '위치가 올바르지 않습니다.' } };
  }
  const radius = Math.min(Math.max(Number(q.radiusKm) || 30, 1), 200);
  const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 200);
  const myHash = isValidKey(ownerKey) ? hashKey(ownerKey) : null;

  const items = [];
  for (const r of map.values()) {
    if (!active(r, now)) continue;
    const mine = myHash !== null && r.ownerHash === myHash;
    let d;
    if (hasPos) {
      d = distKm(lat, lng, r.lat, r.lng);
      if (d > radius && !mine) continue; // 내 요청은 멀리 있어도 항상 보이게
    }
    items.push({
      id: r.id,
      kind: r.kind,
      sub: r.sub,
      count: r.count,
      lat: r.lat,
      lng: r.lng,
      posAge: r.posAge,
      note: r.note,
      createdAt: r.createdAt,
      mine,
      ...(d !== undefined ? { distKm: Math.round(d * 100) / 100 } : {}),
    });
  }
  items.sort((a, b) => (hasPos ? a.distKm - b.distKm : b.createdAt - a.createdAt));
  return { status: 200, body: { items: items.slice(0, limit), now } };
}

// 취소·해결: 요청을 올린 기기(같은 키)만 가능. 같은 요청을 다시 처리해도 오류 없이 성공으로 본다
export async function resolveReport(id, body, now = Date.now()) {
  const key = body?.key;
  if (!isValidKey(key)) {
    return { status: 400, body: { error: '기기 키가 올바르지 않습니다.' } };
  }
  const map = await load();
  if (purge(map, now)) await persist();
  const r = typeof id === 'string' ? map.get(id) : undefined;
  if (!r) {
    return { status: 404, body: { error: '요청을 찾을 수 없거나 이미 만료되었습니다.' } };
  }
  if (r.ownerHash !== hashKey(key)) {
    return { status: 403, body: { error: '내가 올린 요청만 취소·해결할 수 있습니다.' } };
  }
  if (!r.resolvedAt) {
    r.resolvedAt = now;
    await persist();
  }
  return { status: 200, body: { ok: true } };
}
