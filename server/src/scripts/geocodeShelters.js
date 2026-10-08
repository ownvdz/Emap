import 'dotenv/config';
import axios from 'axios';
import { initPool, query } from '../db.js';

const GEOCODE_URL = 'https://maps.apigw.ntruss.com/map-geocode/v2/geocode';

async function geocode(address) {
  const { data } = await axios.get(GEOCODE_URL, {
    params: { query: address },
    headers: {
      'x-ncp-apigw-api-key-id': process.env.NAVER_GEOCODE_CLIENT_ID,
      'x-ncp-apigw-api-key': process.env.NAVER_GEOCODE_CLIENT_SECRET,
    },
  });

  const result = data.addresses?.[0];
  if (!result) return null;
  return { latitude: Number(result.y), longitude: Number(result.x) };
}

async function main() {
  await initPool();

  const { rows } = await query(
    `SELECT SHELTER_ID, ROAD_ADDRESS, DETAIL_ADDRESS
     FROM SHELTER
     WHERE GEOCODE_STATUS = 'PENDING'
     FETCH FIRST 5000 ROWS ONLY`
  );

  console.log(`지오코딩 대상: ${rows.length}건`);

  for (const row of rows) {
    const address = row.ROAD_ADDRESS || row.DETAIL_ADDRESS;
    if (!address) {
      await query(`UPDATE SHELTER SET GEOCODE_STATUS = 'FAILED' WHERE SHELTER_ID = :id`,
        { id: row.SHELTER_ID }, { autoCommit: true });
      continue;
    }

    try {
      const coords = await geocode(address);
      if (coords) {
        await query(
          `UPDATE SHELTER SET LATITUDE = :lat, LONGITUDE = :lng, GEOCODE_STATUS = 'DONE'
           WHERE SHELTER_ID = :id`,
          { lat: coords.latitude, lng: coords.longitude, id: row.SHELTER_ID },
          { autoCommit: true }
        );
      } else {
        await query(`UPDATE SHELTER SET GEOCODE_STATUS = 'FAILED' WHERE SHELTER_ID = :id`,
          { id: row.SHELTER_ID }, { autoCommit: true });
      }
    } catch (e) {
      console.error(`실패 [${row.SHELTER_ID}]:`, e.response?.data ?? e.message);
    }

    await new Promise((r) => setTimeout(r, 100)); // API 호출 제한 대비 속도 조절
  }

  console.log('지오코딩 완료');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});