import 'dotenv/config';
import axios from 'axios';
import { initPool, query } from '../db.js';

const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';
const BATCH_SIZE = 500;
const cache = new Map();
let apiCalls = 0;

function cleanAddress(addr) {
  if (!addr) return null;
  const cleaned = addr
    .replace(/\([^)]*\)/g, '')
    .replace(/(\d+)-0\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

async function geocode(address) {
  if (cache.has(address)) return cache.get(address);

  apiCalls++;
  const { data } = await axios.get(GEOCODE_URL, {
    params: { query: address },
    headers: {
      'x-ncp-apigw-api-key-id': process.env.NAVER_GEOCODE_CLIENT_ID,
      'x-ncp-apigw-api-key': process.env.NAVER_GEOCODE_CLIENT_SECRET,
    },
  });

  const first = data.addresses?.[0];
  const result = first ? { lat: Number(first.y), lng: Number(first.x) } : null;
  cache.set(address, result);
  return result;
}

async function geocodeRow(row) {
  const candidates = [cleanAddress(row.ROAD_ADDRESS), cleanAddress(row.DETAIL_ADDRESS)]
    .filter(Boolean);
  for (const addr of candidates) {
    const coords = await geocode(addr);
    if (coords) return coords;
  }
  return null;
}

async function main() {
  // 사용법:
  //   npm run geocode-shelters -- 20                (20건 테스트)
  //   npm run geocode-shelters -- 20 전남광주        (해당 지역 주소로 시작하는 20건)
  //   npm run geocode-shelters -- all               (전체)
  const countArg = process.argv[2];
  const region = process.argv[3] || null;

  if (!countArg) {
    console.error('건수를 지정하세요. 예: npm run geocode-shelters -- 20  또는  -- all');
    process.exit(1);
  }
  const maxCount = countArg === 'all' ? Infinity : Number(countArg);
  if (!Number.isFinite(maxCount) && countArg !== 'all') {
    console.error(`잘못된 건수: ${countArg}`);
    process.exit(1);
  }

  if (!process.env.NAVER_GEOCODE_CLIENT_ID || !process.env.NAVER_GEOCODE_CLIENT_SECRET) {
    console.error('.env에 NAVER_GEOCODE_CLIENT_ID / NAVER_GEOCODE_CLIENT_SECRET를 입력하세요.');
    process.exit(1);
  }

  console.log(`처리 상한: ${maxCount === Infinity ? '전체' : maxCount + '건'}${region ? `, 지역: ${region}` : ''}`);

  await initPool();

  let lastId = 0;
  let done = 0, failed = 0, processed = 0;

  while (processed < maxCount) {
    const batch = Math.min(BATCH_SIZE, maxCount - processed);
    const binds = { lastId, batch };
    let regionFilter = '';
    if (region) {
      regionFilter = 'AND ROAD_ADDRESS LIKE :region';
      binds.region = region + '%';
    }

    const { rows } = await query(
      `SELECT SHELTER_ID, ROAD_ADDRESS, DETAIL_ADDRESS
       FROM SHELTER
       WHERE GEOCODE_STATUS = 'PENDING' AND SHELTER_ID > :lastId ${regionFilter}
       ORDER BY SHELTER_ID
       FETCH FIRST :batch ROWS ONLY`,
      binds
    );

    if (rows.length === 0) break;

    for (const row of rows) {
      lastId = row.SHELTER_ID;
      processed++;

      try {
        const coords = await geocodeRow(row);
        if (coords) {
          await query(
            `UPDATE SHELTER SET LATITUDE = :lat, LONGITUDE = :lng, GEOCODE_STATUS = 'DONE'
             WHERE SHELTER_ID = :id`,
            { lat: coords.lat, lng: coords.lng, id: row.SHELTER_ID },
            { autoCommit: true }
          );
          done++;
        } else {
          await query(
            `UPDATE SHELTER SET GEOCODE_STATUS = 'FAILED' WHERE SHELTER_ID = :id`,
            { id: row.SHELTER_ID },
            { autoCommit: true }
          );
          failed++;
        }
      } catch (e) {
        const status = e.response?.status;
        console.error(`오류 [${row.SHELTER_ID}] ${status ?? ''}`, e.response?.data ?? e.message);
        if (status === 401 || status === 403) {
          console.error('인증/권한 오류입니다. Geocoding 상품 활성화와 키를 확인하세요.');
          process.exit(1);
        }
        if (status === 429) await new Promise((r) => setTimeout(r, 2000));
      }

      await new Promise((r) => setTimeout(r, 50));
    }

    console.log(`진행: ${processed}건 (성공 ${done}, 실패 ${failed}, API 호출 ${apiCalls}회)`);
  }

  console.log(`종료: 처리 ${processed}건, 성공 ${done}, 실패 ${failed}, API 호출 ${apiCalls}회`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});