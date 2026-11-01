import { query } from './db.js';
import { REGIONS } from './alerts.js';

const TTL_MS = 60 * 60 * 1000; // 1시간
let cached = null; // { at, tree }

// 대피소 주소의 앞 두 단어(시도, 시군구)를 모아 시도별 시군구 목록을 만든다
export async function getRegionTree() {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.tree;

  const tree = Object.fromEntries(REGIONS.map((r) => [r, []]));

  try {
    const result = await query(
      `SELECT DISTINCT REGEXP_SUBSTR(COALESCE(ROAD_ADDRESS, DETAIL_ADDRESS), '^[^ ]+ [^ ]+') AS PAIR
       FROM SHELTER
       WHERE COALESCE(ROAD_ADDRESS, DETAIL_ADDRESS) IS NOT NULL`
    );

    for (const row of result.rows) {
      if (!row.PAIR) continue;
      const [sido, sigungu] = row.PAIR.split(' ');
      if (!REGIONS.includes(sido)) continue;                 // 목록에 없는 시도 표기(오타 등)는 버림
      if (sido === '세종특별자치시') continue;               // 세종은 시군구가 없음
      if (!/^[가-힣]+(시|군|구)$/.test(sigungu)) continue;   // 시/군/구로 끝나는 이름만
      if (!tree[sido].includes(sigungu)) tree[sido].push(sigungu);
    }

    for (const sido of REGIONS) tree[sido].sort((a, b) => a.localeCompare(b, 'ko'));
    cached = { at: Date.now(), tree };
  } catch (e) {
    console.error('regions error:', e.message);
    if (cached) return cached.tree; // DB가 잠시 안 될 땐 이전 목록 유지
    // 첫 실패는 캐시하지 않아서 다음 요청에서 다시 시도한다
  }

  return tree;
}