import axios from 'axios';

const API_URL = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-00247';
const LOOKBACK_DAYS = 3;        // 최근 며칠치를 볼지
const PAGE_SIZE = 100;
const MAX_PAGES = 5;            // 시도 하나당 최대 500건까지 수집
const CACHE_TTL_MS = 60 * 1000; // API 갱신주기(1분)에 맞춤

// 허용 시도 목록 (이 값만 외부 API로 전달됨)
export const REGIONS = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '대전광역시', '울산광역시',
  '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도',
  '전북특별자치도', '경상북도', '경상남도', '제주특별자치도', '전남광주통합특별시',
];

const cache = new Map(); // 시도 -> { at, payload }  (시군구 필터 적용 전 전체 결과)

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

// 시도 하나의 문자를 모든 페이지에서 받아옴 (응답이 시간순이 아니라서 한 페이지만 받으면 최신 문자를 놓칠 수 있음)
async function fetchSidoFromApi(region) {
  const crtDt = toYmd(new Date(Date.now() - LOOKBACK_DAYS * 86400000));
  const byId = new Map(); // 페이지가 겹쳐도 같은 문자가 두 번 들어가지 않게 일련번호로 중복 제거
  let total = 0;

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const { data } = await axios.get(API_URL, {
      params: {
        serviceKey: process.env.SAFETYDATA_SERVICE_KEY,
        returnType: 'json',
        pageNo,
        numOfRows: PAGE_SIZE,
        crtDt,
        rgnNm: region,
      },
      timeout: 8000,
    });

    const header = data?.header ?? data?.response?.header;
    if (header?.resultCode && String(header.resultCode) !== '00') {
      throw new Error(`API 오류 ${header.resultCode} ${header.resultMsg ?? ''}`);
    }

    const rows = extractItems(data);
    total = Number(data?.totalCount ?? rows.length);
    if (rows.length === 0 && total > 0) {
      console.warn('재난문자 응답 구조를 해석하지 못했습니다. 최상위 키:', Object.keys(data ?? {}));
    }

    for (const row of rows) {
      const item = normalize(row);
      byId.set(item.id, item);
    }

    if (rows.length === 0 || byId.size >= total) break;
  }

  const items = [...byId.values()].sort(
    (a, b) => Number(b.id) - Number(a.id) || b.createdAt.localeCompare(a.createdAt)
  );
  return { items, partial: byId.size < total, stale: false };
}

async function getSidoData(region) {
  const hit = cache.get(region);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.payload;

  if (!process.env.SAFETYDATA_SERVICE_KEY) {
    throw new Error('SAFETYDATA_SERVICE_KEY가 설정되지 않았습니다.');
  }

  try {
    const payload = await fetchSidoFromApi(region);
    cache.set(region, { at: Date.now(), payload });
    return payload;
  } catch (e) {
    if (hit) return { ...hit.payload, stale: true }; // 실패하면 예전에 받은 내용을 대신 보여줌
    throw e;
  }
}

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// 선택한 시군구로 발송된 문자 + 시도 전체로 발송된 문자
function matchesSub(rgn, sido, sub) {
  const whole = norm(rgn);
  if (whole.includes(`${sido} ${sub}`)) return true;
  return whole.split(',').map(norm).some((p) => p === sido || p === `${sido} 전체`);
}

export async function fetchAlerts(region, sub = '') {
  const base = await getSidoData(region);
  const items = sub ? base.items.filter((a) => matchesSub(a.region, region, sub)) : base.items;
  return { items, partial: base.partial, stale: base.stale, lookbackDays: LOOKBACK_DAYS };
}