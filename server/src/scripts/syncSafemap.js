import 'dotenv/config';
import crypto from 'crypto';
import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { initPool, query } from '../db.js';

const BASE_URL = 'https://safemap.go.kr/openapi2';

function clean(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
}

function toNumber(v) {
  const s = clean(v);
  if (s === null) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// 지진실내구호소: 완전히 같은 행은 버리고, 같은 건물(이름+주소)은 면적을 합산
function mergeEarthquakeItems(items) {
  const seen = new Set();
  const groups = new Map();

  for (const item of items) {
    const full = JSON.stringify(item);
    if (seen.has(full)) continue;
    seen.add(full);

    const key = [item.ctprvn_nm, item.signgu_nm, item.fclty_nm, item.detail_adres].join('|');
    const area = toNumber(item.aceptnc_posbl_ar);
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, { ...item, aceptnc_posbl_ar: area });
    } else {
      existing.aceptnc_posbl_ar = (existing.aceptnc_posbl_ar ?? 0) + (area ?? 0);
    }
  }
  return [...groups.values()];
}

// API별 설정: 응답 항목을 SHELTER 테이블의 공통 컬럼으로 변환
const SOURCES = {
    earthquake: {
    label: '지진실내구호소',
    apiId: 'IF_0124',
    keyEnv: 'SAFEMAP_KEY_EARTHQUAKE',
    prepare: mergeEarthquakeItems,
    normalize(item) {
      const sido = clean(item.ctprvn_nm);
      const sigungu = clean(item.signgu_nm);
      const name = clean(item.fclty_nm);
      const detail = clean(item.detail_adres);
      if (!name && !detail) return null;

      // 지오코딩용 전체 주소 만들기
      let fullAddress = null;
      if (detail) {
        if (sido === '세종특별자치시') {
          // 세종은 시도명/시군구명이 겹쳐서 접두사를 정리하고 하나만 붙임
          const rest = detail
            .replace(/^(세종특별자치시|세종시)\s+/, '')
            .replace(/^(세종특별자치시|세종시)\s+/, '');
          fullAddress = `세종특별자치시 ${rest}`;
        } else {
          const parts = [];
          if (sido && !detail.startsWith(sido)) parts.push(sido);
          if (sigungu && !detail.includes(sigungu)) parts.push(sigungu);
          parts.push(detail);
          fullAddress = parts.join(' ');
        }
      }

      // 고유 ID는 기존 방식(원본 detail 기준)을 유지해야 기존 행이 갱신됨. 바꾸지 마세요.
      const hash = crypto
        .createHash('sha1')
        .update([sido, sigungu, name, detail].join('|'))
        .digest('hex')
        .slice(0, 32);

      return {
        sourceId: `EQ:${hash}`,
        category: 'EARTHQUAKE',
        name,
        shelterType: '지진실내구호소',
        capacity: null,
        area: toNumber(item.aceptnc_posbl_ar),
        detailAddress: fullAddress,
        roadAddress: null,
        legalDongCode: clean(item.legaldong_code),
        normalUseType: null,
        isOpen: null,
        manageAgency: null,
      };
    },
  },

  tsunami: {
    label: '지진해일긴급대피장소',
    apiId: 'IF_0126',
    keyEnv: 'SAFEMAP_KEY_TSUNAMI',
    normalize(item) {
      // 대표주소가 아닌 행은 건너뜀 (값이 'N' 또는 '0'일 때)
      const flag = String(item.reprsnt_yn ?? '').trim().toUpperCase();
      if (flag === 'N' || flag === '0') return null;

      const mngNo = clean(item.obj_mng_no);
      if (!mngNo) return null;

      const road = clean(item.rn);
      const main = clean(item.adres_mnnm);
      const sub = clean(item.adres_slno);
      const buildingNo = main ? (sub && sub !== '0' ? `${main}-${sub}` : main) : null;

      // 도로명이 없으면 주소를 만들지 않음 (동 단위 대략 좌표는 오해를 부르므로)
      const roadAddress = road
        ? [clean(item.ctp_kor_nm), clean(item.sig_kor_nm), road, buildingNo].filter(Boolean).join(' ')
        : null;

      return {
        sourceId: `TS:${mngNo}:${clean(item.adres_no) ?? '0'}`,
        category: 'TSUNAMI',
        name: clean(item.obj_nm),
        shelterType: '지진해일긴급대피장소',
        capacity: null,
        area: null,
        detailAddress: null,
        roadAddress,
        legalDongCode: clean(item.adm_cd),
        normalUseType: null,
        isOpen: null,
        manageAgency: null,
      };
    },
  },
};

async function fetchPage(apiId, serviceKey, pageNo) {
  const { data } = await axios.get(`${BASE_URL}/${apiId}`, {
    params: { serviceKey, pageNo, numOfRows: 1000, returnType: 'json' },
  });

  if (typeof data === 'string' && data.trim().startsWith('<')) {
    return await parseStringPromise(data, { explicitArray: false });
  }
  return data;
}

async function upsert(row, item) {
  await query(
    `MERGE INTO SHELTER t
     USING (SELECT :sourceId AS SOURCE_ID FROM DUAL) s
     ON (t.SOURCE_ID = s.SOURCE_ID)
     WHEN MATCHED THEN UPDATE SET
       CATEGORY = :category, NAME = :shelterName, SHELTER_TYPE = :shelterType,
       CAPACITY = :capacity, AREA_SQM = :area,
       DETAIL_ADDRESS = :detailAddress, ROAD_ADDRESS = :roadAddress,
       LEGAL_DONG_CODE = :legalDongCode, NORMAL_USE_TYPE = :normalUseType,
       IS_OPEN = :isOpen, MANAGE_AGENCY = :manageAgency,
       RAW_DATA = :rawData, UPDATED_AT = SYSTIMESTAMP
     WHEN NOT MATCHED THEN INSERT
       (SOURCE_ID, CATEGORY, NAME, SHELTER_TYPE, CAPACITY, AREA_SQM, DETAIL_ADDRESS, ROAD_ADDRESS,
        LEGAL_DONG_CODE, NORMAL_USE_TYPE, IS_OPEN, MANAGE_AGENCY, RAW_DATA)
     VALUES
       (:sourceId, :category, :shelterName, :shelterType, :capacity, :area, :detailAddress, :roadAddress,
        :legalDongCode, :normalUseType, :isOpen, :manageAgency, :rawData)`,
    {
      sourceId: row.sourceId,
      category: row.category,
      shelterName: row.name,
      shelterType: row.shelterType,
      capacity: row.capacity,
      area: row.area,
      detailAddress: row.detailAddress,
      roadAddress: row.roadAddress,
      legalDongCode: row.legalDongCode,
      normalUseType: row.normalUseType,
      isOpen: row.isOpen,
      manageAgency: row.manageAgency,
      rawData: JSON.stringify(item),
    },
    { autoCommit: true }
  );
}

async function syncOne(key) {
  const src = SOURCES[key];
  const serviceKey = process.env[src.keyEnv] || process.env.SAFEMAP_SERVICE_KEY;
  if (!serviceKey) {
    console.error(`[${src.label}] .env에 SAFEMAP_SERVICE_KEY(또는 ${src.keyEnv})가 필요합니다.`);
    return;
  }

  console.log(`\n=== ${src.label} (${src.apiId}) 수집 시작 ===`);

  // 1단계: 전체 페이지 수집
  const fetched = [];
  let pageNo = 1;
  let totalCount = null;

  while (true) {
    const data = await fetchPage(src.apiId, serviceKey, pageNo);

    if (data.header?.resultCode !== '00') {
      console.error('API 오류:', data.header);
      return;
    }

    const body = data.body ?? {};
    let list = body.items?.item ?? [];
    if (!Array.isArray(list)) list = [list];

    if (totalCount === null && body.totalCount !== undefined) {
      totalCount = Number(body.totalCount);
      console.log(`전체 건수: ${totalCount}`);
    }

    if (list.length === 0) break;

    fetched.push(...list);
    console.log(`수집 진행: ${fetched.length}${totalCount ? '/' + totalCount : ''}`);

    if (totalCount && fetched.length >= totalCount) break;
    pageNo++;
  }

  // 2단계: 필요하면 중복 정리 후 저장
  const items = src.prepare ? src.prepare(fetched) : fetched;
  if (src.prepare) console.log(`중복 정리: ${fetched.length}건 → ${items.length}건`);

  let saved = 0;
  let skipped = 0;
  for (const item of items) {
    const row = src.normalize(item);
    if (!row) {
      skipped++;
      continue;
    }
    await upsert(row, item);
    saved++;
  }

  console.log(`[${src.label}] 완료: 저장 ${saved}건, 건너뜀 ${skipped}건`);
}
async function main() {
  const target = process.argv[2];
  const keys = target === 'all' ? Object.keys(SOURCES) : [target];

  if (!target || keys.some((k) => !SOURCES[k])) {
    console.error('사용법: npm run sync-safemap -- earthquake | tsunami | all');
    process.exit(1);
  }

  await initPool();
  for (const k of keys) {
    await syncOne(k);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('수집 실패:', e.response?.data ?? e.message);
  process.exit(1);
});