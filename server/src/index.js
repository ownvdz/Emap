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

app.get('/api/shelters', async (req, res) => {
  const swLat = Number(req.query.swLat);
  const swLng = Number(req.query.swLng);
  const neLat = Number(req.query.neLat);
  const neLng = Number(req.query.neLng);

  if ([swLat, swLng, neLat, neLng].some((v) => !Number.isFinite(v))) {
    return res.status(400).json({ error: 'swLat, swLng, neLat, neLng가 필요합니다.' });
  }

  const limit = Math.min(Number(req.query.limit) || 500, 2000);

  try {
    const result = await query(
      `SELECT SHELTER_ID, NAME, SHELTER_TYPE, ROAD_ADDRESS, CAPACITY, LATITUDE, LONGITUDE
       FROM SHELTER
       WHERE GEOCODE_STATUS = 'DONE'
         AND LATITUDE BETWEEN :swLat AND :neLat
         AND LONGITUDE BETWEEN :swLng AND :neLng
       FETCH FIRST :maxRows ROWS ONLY`,
      { swLat, neLat, swLng, neLng, maxRows: limit + 1 }
    );

    const truncated = result.rows.length > limit;
    const items = result.rows.slice(0, limit).map((r) => ({
      id: r.SHELTER_ID,
      name: r.NAME,
      type: r.SHELTER_TYPE,
      address: r.ROAD_ADDRESS,
      capacity: r.CAPACITY,
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