import 'dotenv/config';
import axios from 'axios';
import oracledb from 'oracledb';
import { initPool, query, queryMany } from '../db.js';

const BASE_URL = 'https://www.safetydata.go.kr/V2/api';
const REQUEST_PAGE_SIZE = 1000;
const MAX_PAGES = 2000;
const BATCH_SIZE = 500;

// ---------- 변환 도우미 ----------
const str = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
};

const num = (v) => {
  const s = str(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

// 한글은 글자당 3바이트라서 컬럼 길이(바이트)를 넘지 않게 자름
function cut(v, maxBytes) {
  if (v == null) return null;
  let s = String(v);
  while (Buffer.byteLength(s, 'utf8') > maxBytes) s = s.slice(0, -1);
  return s;
}

const inKorea = (lat, lng) =>
  lat != null && lng != null && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;

// 도·분·초를 십진수 좌표로 (이미 십진수여도 분·초가 0이면 그대로)
function dms(d, m, s) {
  const deg = num(d);
  if (deg == null) return null;
  return deg + (num(m) ?? 0) / 60 + (num(s) ?? 0) / 3600;
}

function extractItems(data) {
  const body = data?.body ?? data?.response?.body;
  if (Array.isArray(body)) return body;
  const items = body?.items ?? body?.item;
  if (Array.isArray(items)) return items;
  if (Array.isArray(items?.item)) return items.item;
  return [];
}

// ---------- API별 설정 ----------
// normalize가 null을 돌려주면 건너뜀 (키 없음, 사용하지 않는 시설 등)
const SOURCES = {
  civil: {
    label: '민방위대피소',
    apiId: 'DSSP-IF-00195',
    keyEnv: 'SAFETYDATA_KEY_CIVIL',
    prefix: 'DSSP00195',
    category: 'CIVIL_DEFENSE',
    normalize(it) {
      const fc = str(it.FCLT_CD);
      if (!fc) return null;
      const unit = str(it.SCL_UNIT) ?? '';
      return {
        key: [str(it.SGG_CD), str(it.SE_CD), fc].filter(Boolean).join('-'),
        name: str(it.FCLT_NM),
        shelterType: '민방위대피소',
        capacity: num(it.SHNT_PSBLTY_NOPE),
        area: /㎡|m2|제곱/i.test(unit) ? num(it.FCLT_SCL) : null,
        detailAddress: str(it.FCLT_ADDR_LOTNO),
        roadAddress: str(it.FCLT_ADDR_RONA),
        legalDongCode: str(it.EMD_CD),
        normalUseType: str(it.ORTM_UTLZ_TYPE),
        isOpen: str(it.OPN_YN),
        manageAgency: str(it.MNG_INST_NM),
        lat: dms(it.LAT_PROVIN, it.LAT_MIN, it.LAT_SEC),
        lng: dms(it.LOT_PROVIN, it.LOT_MIN, it.LOT_SEC),
      };
    },
  },

  outdoor: {
    label: '지진옥외대피장소',
    apiId: 'DSSP-IF-10943',
    keyEnv: 'SAFETYDATA_KEY_OUTDOOR',
    prefix: 'DSSP10943',
    category: 'EARTHQUAKE_OUTDOOR',
    normalize(it) {
      const sn = str(it.ACMDFCLTY_SN);
      if (!sn) return null;
      return {
        key: `${str(it.ARCD) ?? ''}-${sn}`,
        name: str(it.VT_ACMDFCLTY_NM),
        shelterType: '지진옥외대피장소',
        capacity: num(it.VT_ACMD_PSBL_NMPR),
        area: num(it.FCLTY_AR),
        detailAddress: str(it.EQK_ACMDFCLTY_ADRES) ?? str(it.DTL_ADRES),
        roadAddress: str(it.RN_DTL_ADRES),
        legalDongCode: str(it.BDONG_CD),
        normalUseType: null,
        isOpen: null,
        manageAgency: null,
        lat: num(it.LA),
        lng: num(it.LO),
      };
    },
  },

  tsunami: {
    label: '지진해일긴급대피장소',
    apiId: 'DSSP-IF-10944',
    keyEnv: 'SAFETYDATA_KEY_TSUNAMI',
    prefix: 'DSSP10944',
    category: 'TSUNAMI',
    normalize(it) {
      const a = str(it.SHNTDTR_SN);
      const b = str(it.SHNT_PLACE_SN);
      if (!a && !b) return null;
      if (str(it.USE_AT)?.toUpperCase() === 'N') return null; // 사용하지 않는 시설 (가정: 'N' = 미사용)
      return {
        key: `${str(it.ARCD) ?? ''}-${a ?? ''}-${b ?? ''}`,
        name: str(it.SHNT_PLACE_NM),
        shelterType: '지진해일긴급대피장소',
        capacity: num(it.PSBL_NMPR),
        area: null,
        detailAddress: str(it.SHNT_PLACE_DTL_POSITION),
        roadAddress: str(it.RN_DTL_ADRES),
        legalDongCode: null,
        normalUseType: null,
        isOpen: str(it.USE_AT),
        manageAgency: null,
        lat: num(it.LA),
        lng: num(it.LO),
      };
    },
  },

  heat: {
    label: '무더위쉼터',
    apiId: 'DSSP-IF-10941',
    keyEnv: 'SAFETYDATA_KEY_INTEGRATED',
    params: { shlt_se_cd: '2' },
    prefix: 'DSSP10941',
    category: 'HEAT_SHELTER',
    normalize: (it) => normalizeIntegrated(it, '2', '무더위쉼터'),
  },

  cold: {
    label: '한파쉼터',
    apiId: 'DSSP-IF-10941',
    keyEnv: 'SAFETYDATA_KEY_INTEGRATED',
    params: { shlt_se_cd: '1' },
    prefix: 'DSSP10941',
    category: 'COLD_SHELTER',
    normalize: (it) => normalizeIntegrated(it, '1', '한파쉼터'),
  },
};

// 통합대피소: 요청한 구분 코드와 다른 행은 버림 (필터가 적용되지 않을 경우 대비)
function normalizeIntegrated(it, expectedCode, label) {
  // 구분 코드가 "1,2"처럼 여러 개일 수 있음 (한파쉼터와 무더위쉼터를 겸하는 시설)
  const codes = (str(it.SHLT_SE_CD) ?? '').split(',').map((s) => s.trim());
  if (!codes.includes(expectedCode)) return null;
  const sn = str(it.MNG_SN);
  if (!sn) return null;
  return {
    key: `${expectedCode}-${sn}`,
    name: str(it.REARE_NM),
    shelterType: str(it.SHLT_SE_NM) ?? label, // 겸용 시설은 "한파쉼터,무더위쉼터"로 표시됨
    capacity: null,
    area: null,
    detailAddress: null,
    roadAddress: str(it.RONA_DADDR),
    legalDongCode: null,
    normalUseType: null,
    isOpen: null,
    manageAgency: null,
    lat: num(it.LAT),
    lng: num(it.LOT),
  };
}

// ---------- API 호출 ----------
async function getWithRetry(url, params) {
  for (let i = 1; ; i++) {
    try {
      return await axios.get(url, { params, timeout: 30000 });
    } catch (e) {
      if (i >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

// 모든 페이지를 받아옴. 서버가 한 번에 주는 개수를 제한하면 그 크기로 다시 받음
async function fetchAll(apiId, serviceKey, extraParams = {}) {

  let pageSize = REQUEST_PAGE_SIZE;
  let all = [];
  let total = 0;

  for (let attempt = 0; attempt < 2; attempt++) {
    all = [];
    let restart = false;

    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
      const { data } = await getWithRetry(`${BASE_URL}/${apiId}`, {
        serviceKey,
        returnType: 'json',
        pageNo,
        numOfRows: pageSize,
        ...extraParams,
      });

      const header = data?.header;
      if (header?.resultCode && String(header.resultCode) !== '00') {
        throw new Error(`API 오류 ${header.resultCode} ${header.resultMsg ?? ''}`);
      }

      const rows = extractItems(data);
      total = Number(data?.totalCount ?? rows.length);

      if (attempt === 0 && pageNo === 1 && rows.length > 0 && rows.length < Math.min(pageSize, total)) {
        pageSize = rows.length;
        restart = true;
        console.log(`  한 번에 ${pageSize}건까지만 주는 API라서 그 크기로 다시 받습니다.`);
        break;
      }

      all.push(...rows);
      if (pageNo % 10 === 0) console.log(`  수집 중 ${all.length}/${total}`);
      if (rows.length === 0 || all.length >= total) break;
    }

    if (!restart) break;
  }

  return { rows: all, total };
}

// ---------- 저장 ----------
const MERGE_SQL = `MERGE INTO SHELTER t
  USING (SELECT :sourceId AS SOURCE_ID FROM DUAL) s
  ON (t.SOURCE_ID = s.SOURCE_ID)
  WHEN MATCHED THEN UPDATE SET
    CATEGORY = :category, NAME = :shelterName, SHELTER_TYPE = :shelterType,
    CAPACITY = :capacity, AREA_SQM = :area,
    DETAIL_ADDRESS = :detailAddress, ROAD_ADDRESS = :roadAddress,
    LEGAL_DONG_CODE = :legalDongCode, NORMAL_USE_TYPE = :normalUseType,
    IS_OPEN = :isOpen, MANAGE_AGENCY = :manageAgency,
    LATITUDE = :lat, LONGITUDE = :lng, GEOCODE_STATUS = :geoStatus,
    RAW_DATA = :rawData, UPDATED_AT = SYSTIMESTAMP
  WHEN NOT MATCHED THEN INSERT
    (SOURCE_ID, CATEGORY, NAME, SHELTER_TYPE, CAPACITY, AREA_SQM, DETAIL_ADDRESS, ROAD_ADDRESS,
     LEGAL_DONG_CODE, NORMAL_USE_TYPE, IS_OPEN, MANAGE_AGENCY, LATITUDE, LONGITUDE, GEOCODE_STATUS, RAW_DATA)
  VALUES
    (:sourceId, :category, :shelterName, :shelterType, :capacity, :area, :detailAddress, :roadAddress,
     :legalDongCode, :normalUseType, :isOpen, :manageAgency, :lat, :lng, :geoStatus, :rawData)`;

const BIND_DEFS = {
  sourceId: { type: oracledb.STRING, maxSize: 60 },
  category: { type: oracledb.STRING, maxSize: 30 },
  shelterName: { type: oracledb.STRING, maxSize: 300 },
  shelterType: { type: oracledb.STRING, maxSize: 100 },
  capacity: { type: oracledb.NUMBER },
  area: { type: oracledb.NUMBER },
  detailAddress: { type: oracledb.STRING, maxSize: 300 },
  roadAddress: { type: oracledb.STRING, maxSize: 300 },
  legalDongCode: { type: oracledb.STRING, maxSize: 20 },
  normalUseType: { type: oracledb.STRING, maxSize: 300 },
  isOpen: { type: oracledb.STRING, maxSize: 10 },
  manageAgency: { type: oracledb.STRING, maxSize: 300 },
  lat: { type: oracledb.NUMBER },
  lng: { type: oracledb.NUMBER },
  geoStatus: { type: oracledb.STRING, maxSize: 20 },
  rawData: { type: oracledb.STRING, maxSize: 4000 },
};

async function syncOne(key, { dry, noPrune }) {
  const src = SOURCES[key];
  console.log(`\n=== ${src.label} (${src.apiId}${dry ? ', 시험 실행: DB에 저장하지 않음' : ''}) ===`);

  const serviceKey = process.env[src.keyEnv];
  if (!serviceKey) {
    console.error(`.env에 ${src.keyEnv}를 입력하세요. 이 항목은 건너뜁니다.`);
    return;
  }

  const { rows, total } = await fetchAll(src.apiId, serviceKey, src.params);
  console.log(`받은 행: ${rows.length} / 전체 ${total}`);
  if (rows.length > 0) console.log('첫 항목 원본:', JSON.stringify(rows[0]));

  const stats = { skipped: 0, done: 0, swapped: 0, pending: 0, failed: 0, duplicateKeys: 0 };
  const byId = new Map();

  for (const it of rows) {
    const n = src.normalize(it);
    if (!n) {
      stats.skipped++;
      continue;
    }

    let { lat, lng } = n;
    if (!inKorea(lat, lng) && inKorea(lng, lat)) {
      [lat, lng] = [lng, lat]; // 위도와 경도가 뒤바뀐 경우 바로잡음
      stats.swapped++;
    }

    let geoStatus;
    if (inKorea(lat, lng)) {
      geoStatus = 'DONE';
      stats.done++;
    } else if (n.roadAddress || n.detailAddress) {
      lat = null;
      lng = null;
      geoStatus = 'PENDING'; // 좌표가 이상하면 기존 지오코딩으로 넘김
      stats.pending++;
    } else {
      stats.failed++; // 좌표도 주소도 없는 행(시험용 더미 등)은 저장하지 않음
      continue;
    }

    const sourceId = `${src.prefix}:${n.key}`;
    if (byId.has(sourceId)) stats.duplicateKeys++;

    const raw = JSON.stringify(it);
    byId.set(sourceId, {
      sourceId,
      category: src.category,
      shelterName: cut(n.name, 300),
      shelterType: cut(n.shelterType, 100),
      capacity: n.capacity,
      area: n.area,
      detailAddress: cut(n.detailAddress, 300),
      roadAddress: cut(n.roadAddress, 300),
      legalDongCode: cut(n.legalDongCode, 20),
      normalUseType: cut(n.normalUseType, 300),
      isOpen: cut(n.isOpen, 10),
      manageAgency: cut(n.manageAgency, 300),
      lat,
      lng,
      geoStatus,
      rawData: Buffer.byteLength(raw, 'utf8') <= 4000 ? raw : null,
    });
  }

  const list = [...byId.values()];
  console.log(
    `정리 결과: 저장 대상 ${list.length}건 / 건너뜀 ${stats.skipped}건 / 같은 키로 합쳐진 행 ${stats.duplicateKeys}건`
  );
  console.log(
    `좌표: 정상 ${stats.done}건 (위경도 뒤바뀜 보정 ${stats.swapped}건) / 이상해서 주소 변환 대기 ${stats.pending}건 / 좌표·주소 모두 없어 제외 ${stats.failed}건`
  );
  if (list.length > 0) console.log('정리된 첫 항목:', JSON.stringify(list[0], (k, v) => (k === 'rawData' ? undefined : v)));

  const good = list.filter((r) => r.geoStatus === 'DONE');
  [0, Math.floor(good.length / 3), Math.floor((good.length * 2) / 3)].forEach((i) => {
    const r = good[i];
    if (r) console.log('좌표 예시:', r.shelterName, '|', r.roadAddress ?? r.detailAddress, '|', r.lat, r.lng);
  });

  if (dry) return;

  if (list.length === 0) {
    console.log('저장할 데이터가 없어 건너뜁니다.');
    return;
  }

  // 이번 수집 전에 이미 들어 있던 같은 API의 데이터 (사라진 시설 정리용)
  const before = await query('SELECT SOURCE_ID FROM SHELTER WHERE SOURCE_ID LIKE :p', { p: `${src.prefix}:%` });
  const beforeIds = new Set(before.rows.map((r) => r.SOURCE_ID));
  // 같은 prefix를 쓰는 API가 둘(무더위·한파)이라 구분 코드로 한 번 더 좁힘
  const mine = [...beforeIds].filter((id) => id.startsWith(`${src.prefix}:${src.params?.shlt_se_cd ?? ''}`));

  let saved = 0;
  const errors = [];
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const result = await queryMany(MERGE_SQL, batch, { autoCommit: true, batchErrors: true, bindDefs: BIND_DEFS });
    const errs = result.batchErrors ?? [];
    saved += batch.length - errs.length;
    errs.slice(0, 3).forEach((e) => errors.push(e.message));
    if ((i / BATCH_SIZE) % 10 === 0) console.log(`  저장 ${Math.min(i + BATCH_SIZE, list.length)}/${list.length}`);
  }
  console.log(`저장 완료: ${saved}건 성공, ${list.length - saved}건 실패`);
  if (errors.length > 0) console.log('오류 예시:', errors);

  // 사라진 시설 정리: 이전에 있었는데 이번 수집에 없는 것. 수집이 비정상적으로 적으면 건드리지 않음
  if (!noPrune && mine.length > 0) {
    const seen = new Set(list.map((r) => r.sourceId));
    const gone = mine.filter((id) => !seen.has(id));
    if (list.length < mine.length * 0.5) {
      console.log(`이전(${mine.length}건)보다 너무 적게 받아서 사라진 시설 정리는 건너뜁니다.`);
    } else if (gone.length > 0) {
      await queryMany('DELETE FROM SHELTER WHERE SOURCE_ID = :id', gone.map((id) => ({ id })), {
        autoCommit: true,
        bindDefs: { id: { type: oracledb.STRING, maxSize: 60 } },
      });
      console.log(`사라진 시설 ${gone.length}건 삭제`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const noPrune = args.includes('--no-prune');
  const target = args.find((a) => !a.startsWith('--'));
  const keys = target === 'all' ? Object.keys(SOURCES) : [target];

  if (!target || keys.some((k) => !SOURCES[k])) {
    console.error('사용법: npm run sync-dssp -- civil|outdoor|tsunami|heat|cold|all [--dry] [--no-prune]');
    process.exit(1);
  }

  if (!dry) await initPool();
  for (const k of keys) {
    await syncOne(k, { dry, noPrune });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('실패:', e.response?.status, e.response?.data ?? e.message);
  process.exit(1);
});