import axios from 'axios';

const API_URL = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-00247';
const LOOKBACK_DAYS = 3;       // 최근 며칠치를 볼지
const PAGE_SIZE = 100;
const CACHE_TTL_MS = 60 * 1000; // API 갱신주기(1분)에 맞춤

// 허용 지역 목록 (이 값만 외부 API로 전달됨)
export const REGIONS = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '대전광역시', '울산광역시',
  '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '경상북도', '경상남도', '제주특별자치도', '전남광주통합특별시',
];

const cache = new Map(); // 지역 -> { at, payload }

function toYmd(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}${m}${d}`;
}

// 응답 구조가 조금 달라도 항목 배열을 찾아냄
function extractItems(data) {
  const body = data?.body ?? data?.response?.body;
  if (Array.isArray(body)) return body;
  const items = body?.items ?? body?.item;
  if (Array.isArray(items)) return items;
  if (Array.isArray(items?.item)) return items.item;
  return [];
}

function normalize(row) {
  return {
    id: String(row.SN ?? ''),
    createdAt: row.CRT_DT ?? '',
    message: row.MSG_CN ?? '',
    region: row.RCPTN_RGN_NM ?? '',
    level: row.EMRG_STEP_NM ?? '',
    type: row.DST_SE_NM ?? '',
  };
}

export async function fetchAlerts(region) {
  const hit = cache.get(region);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

  if (!process.env.SAFETYDATA_SERVICE_KEY) {
    throw new Error('SAFETYDATA_SERVICE_KEY가 설정되지 않았습니다.');
  }

  try {
    const { data } = await axios.get(API_URL, {
      params: {
        serviceKey: process.env.SAFETYDATA_SERVICE_KEY,
        returnType: 'json',
        pageNo: 1,
        numOfRows: PAGE_SIZE,
        crtDt: toYmd(new Date(Date.now() - LOOKBACK_DAYS * 86400000)),
        rgnNm: region,
      },
      timeout: 8000,
    });

    const header = data?.header ?? data?.response?.header;
    if (header?.resultCode && String(header.resultCode) !== '00') {
      throw new Error(`API 오류 ${header.resultCode} ${header.resultMsg ?? ''}`);
    }

    const rows = extractItems(data);
    const total = Number(data?.totalCount ?? data?.body?.totalCount ?? rows.length);
    if (rows.length === 0 && total > 0) {
      console.warn('재난문자 응답 구조를 해석하지 못했습니다. 최상위 키:', Object.keys(data ?? {}));
    }

    const items = rows
      .map(normalize)
      .sort((a, b) => Number(b.id) - Number(a.id) || b.createdAt.localeCompare(a.createdAt));

    const payload = { items, partial: total > rows.length, stale: false, lookbackDays: LOOKBACK_DAYS };
    cache.set(region, { at: Date.now(), payload });
    return payload;
  } catch (e) {
    if (hit) return { ...hit.payload, stale: true }; // 실패하면 예전에 받은 내용을 대신 보여줌
    throw e;
  }
}