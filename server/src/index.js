import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { initPool, query } from './db.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

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

const CATEGORIES = ['CIVIL_DEFENSE', 'EARTHQUAKE', 'TSUNAMI'];

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
      name: r.NAME,
      type: r.SHELTER_TYPE,
      address: r.ROAD_ADDRESS || r.DETAIL_ADDRESS,
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

initPool()
  .then(() => app.listen(PORT, () => console.log(`Server on :${PORT}`)))
  .catch((e) => {
    console.error('DB init failed', e);
    process.exit(1);
  });