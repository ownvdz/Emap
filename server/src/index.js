import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initPool, query } from './db.js';
import { decodeEntities } from './utils/text.js';
import { fetchAlerts, REGIONS } from './alerts.js';
import { getRegionTree } from './regions.js';
import { startPushWorker } from './push.js';
import { isValidToken, saveToken } from './pushStore.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.set('trust proxy', 'loopback'); // Caddy 뒤에서 실제 접속자 IP를 속도 제한에 쓰기 위함

// 푸시 받을 기기 등록 (앱이 켜질 때마다 호출). 같은 IP에서 10분에 20번까지만 허용
const registerHits = new Map(); // ip -> { count, resetAt }
app.post('/api/push/register', async (req, res) => {
  const now = Date.now();
  const hit = registerHits.get(req.ip);
  if (!hit || now > hit.resetAt) registerHits.set(req.ip, { count: 1, resetAt: now + 10 * 60_000 });
  else if (++hit.count > 20) return res.status(429).json({ error: '요청이 너무 많습니다.' });

  const token = req.body?.token;
  if (!isValidToken(token)) return res.status(400).json({ error: '잘못된 토큰입니다.' });
  try {
    const saved = await saveToken(token);
    if (!saved) return res.status(507).json({ error: '등록 가능한 기기 수를 넘었습니다.' });
    res.json({ ok: true });
  } catch (e) {
    console.error('push register error:', e.message);
    res.status(500).json({ error: '등록하지 못했습니다.' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/db-check', async (req, res) => {
  try {
    const result = await query('SELECT SYSDATE AS NOW FROM DUAL');
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const CATEGORIES = [
  'CIVIL_DEFENSE', 'EARTHQUAKE_OUTDOOR', 'EARTHQUAKE_INDOOR',
  'TSUNAMI', 'HEAT_SHELTER', 'COLD_SHELTER',
];

app.get('/api/shelters', async (req, res) => {
  const swLat = Number(req.query.swLat);
  const swLng = Number(req.query.swLng);
  const neLat = Number(req.query.neLat);
  const neLng = Number(req.query.neLng);

  if ([swLat, swLng, neLat, neLng].some((v) => !Number.isFinite(v))) {
    return res.status(400).json({ error: 'swLat, swLng, neLat, neLng가 필요합니다.' });
  }

  // categories 파라미터가 없으면 전체, 있으면 허용된 값만 사용
  const categories =
    req.query.categories === undefined
      ? CATEGORIES
      : String(req.query.categories).split(',').filter((c) => CATEGORIES.includes(c));

  if (categories.length === 0) {
    return res.json({ items: [], truncated: false });
  }

  const limit = Math.min(Number(req.query.limit) || 500, 2000);

  // IN (:cat0, :cat1, ...) 형태로 바인드 변수 생성 (값은 직접 SQL에 넣지 않음)
  const catBinds = {};
  const catPlaceholders = categories
    .map((c, i) => {
      catBinds[`cat${i}`] = c;
      return `:cat${i}`;
    })
    .join(', ');

  try {
    const result = await query(
      `SELECT SHELTER_ID, CATEGORY, NAME, SHELTER_TYPE, ROAD_ADDRESS, DETAIL_ADDRESS,
              CAPACITY, AREA_SQM, LATITUDE, LONGITUDE
       FROM SHELTER
       WHERE GEOCODE_STATUS = 'DONE'
         AND CATEGORY IN (${catPlaceholders})
         AND LATITUDE BETWEEN :swLat AND :neLat
         AND LONGITUDE BETWEEN :swLng AND :neLng
       FETCH FIRST :maxRows ROWS ONLY`,
      { ...catBinds, swLat, neLat, swLng, neLng, maxRows: limit + 1 }
    );

    const truncated = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map((r) => ({
      id: r.SHELTER_ID,
      category: r.CATEGORY,
      name: decodeEntities(r.NAME),
      type: decodeEntities(r.SHELTER_TYPE),
      address: decodeEntities(r.ROAD_ADDRESS || r.DETAIL_ADDRESS),
      capacity: r.CAPACITY,
      area: r.AREA_SQM,
      lat: r.LATITUDE,
      lng: r.LONGITUDE,
    }));

    res.json({ items, truncated });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '대피소 조회 중 오류가 발생했습니다.' });
  }
});

app.get('/api/regions', async (req, res) => {
  try {
    res.json(await getRegionTree());
  } catch (e) {
    console.error('regions route error:', e.message);
    res.status(500).json({ error: '지역 목록을 불러오지 못했습니다.' });
  }
});

app.get('/api/alerts', async (req, res) => {
  const region = String(req.query.region ?? '').trim();
  const sub = String(req.query.sub ?? '').trim();

  if (!REGIONS.includes(region)) {
    return res.status(400).json({ error: '지원하지 않는 지역입니다.' });
  }
  if (sub && !/^[가-힣0-9 ]{1,20}$/.test(sub)) {
    return res.status(400).json({ error: '잘못된 시군구 값입니다.' });
  }

  try {
    res.json(await fetchAlerts(region, sub));
  } catch (e) {
    console.error('alerts error:', e.response?.status, e.response?.data ?? e.message);
    res.status(502).json({ error: '재난문자를 불러오지 못했습니다.' });
  }
});

app.get('/api/map-center', async (req, res) => {
  const region = String(req.query.region ?? '').trim();
  const sub = String(req.query.sub ?? '').trim();
  const category = String(req.query.category ?? '').trim();

  if (!REGIONS.includes(region) || !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }
  if (sub && !/^[가-힣0-9 ]{1,20}$/.test(sub)) {
    return res.status(400).json({ error: '잘못된 시군구 값입니다.' });
  }

  const prefix = `${region}${sub ? ` ${sub}` : ''}%`;

  try {
    const result = await query(
      `SELECT MEDIAN(LATITUDE) AS LAT, MEDIAN(LONGITUDE) AS LNG, COUNT(*) AS CNT
       FROM SHELTER
       WHERE GEOCODE_STATUS = 'DONE'
         AND CATEGORY = :category
         AND COALESCE(ROAD_ADDRESS, DETAIL_ADDRESS) LIKE :prefix`,
      { category, prefix }
    );
    const row = result.rows[0];
    res.json({ lat: row.LAT, lng: row.LNG, count: row.CNT });
  } catch (e) {
    console.error('map-center error:', e.message);
    res.status(500).json({ error: '중심 좌표를 구하지 못했습니다.' });
  }
});

// 가까운 대피소 탐색 반경(km). 마지막 값까지 못 채우면 그 반경의 결과를 그대로 돌려준다.
const NEARBY_RADII_KM = [3, 10, 30, 100, 400];

app.get('/api/shelters/nearby', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const category = String(req.query.category ?? '').trim();
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);

  const inKorea =
    Number.isFinite(lat) && Number.isFinite(lng) && lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132;
  if (!inKorea || !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: '잘못된 요청입니다.' });
  }

  try {
    // 전체 행의 거리를 계산하지 않도록, 내 위치 주변 사각형으로 먼저 거른다 (IDX_SHELTER_CAT_LAT_LNG 인덱스 사용).
    // 반경을 3km부터 늘려가며, 반경 안에서 limit개를 채우면 멈춘다.
    // 반경 r(km)의 원은 한 변 2r인 사각형 안에 완전히 들어가므로, 원 안의 결과만 세면 정확한 최근접 순서가 보장된다.
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const sqlBase = `SELECT SHELTER_ID, CATEGORY, NAME, SHELTER_TYPE, ROAD_ADDRESS, DETAIL_ADDRESS,
              CAPACITY, AREA_SQM, LATITUDE, LONGITUDE,
              SQRT(POWER((LATITUDE - :lat) * 111.0, 2)
                 + POWER((LONGITUDE - :lng) * 111.0 * COS(:lat * 3.14159265358979 / 180), 2)) AS DIST_KM
       FROM SHELTER
       WHERE GEOCODE_STATUS = 'DONE' AND CATEGORY = :category`;

    let rows = [];
    for (const radiusKm of NEARBY_RADII_KM) {
      const dLat = radiusKm / 111.0;
      const dLng = radiusKm / (111.0 * cosLat);
      const result = await query(
        `${sqlBase}
           AND LATITUDE BETWEEN :minLat AND :maxLat
           AND LONGITUDE BETWEEN :minLng AND :maxLng
         ORDER BY DIST_KM
         FETCH FIRST :maxRows ROWS ONLY`,
        {
          lat, lng, category, maxRows: limit,
          minLat: lat - dLat, maxLat: lat + dLat,
          minLng: lng - dLng, maxLng: lng + dLng,
        }
      );
      rows = result.rows;
      const inside = rows.filter((r) => r.DIST_KM <= radiusKm).length;
      if (inside >= limit) {
        rows = rows.filter((r) => r.DIST_KM <= radiusKm);
        break;
      }
    }
    const result = { rows };

    res.json({
      items: result.rows.map((r) => ({
        id: r.SHELTER_ID,
        category: r.CATEGORY,
        name: decodeEntities(r.NAME),
        type: decodeEntities(r.SHELTER_TYPE),
        address: decodeEntities(r.ROAD_ADDRESS || r.DETAIL_ADDRESS),
        capacity: r.CAPACITY,
        area: r.AREA_SQM,
        lat: r.LATITUDE,
        lng: r.LONGITUDE,
        distKm: Math.round(r.DIST_KM * 100) / 100,
      })),
    });
  } catch (e) {
    console.error('nearby error:', e.message);
    res.status(500).json({ error: '가까운 대피소를 찾지 못했습니다.' });
  }
});

initPool()
  .then(() =>
    app.listen(PORT, () => {
      console.log(`Server on :${PORT}`);
      startPushWorker(); // PUSH_ENABLED=1 일 때만 동작
    })
  )
  .catch((e) => {
    console.error('DB init failed', e);
    process.exit(1);
  });