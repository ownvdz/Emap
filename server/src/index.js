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
  try {
    const result = await query(
      `SELECT SHELTER_ID, NAME, SHELTER_TYPE, ROAD_ADDRESS, LATITUDE, LONGITUDE, CAPACITY
       FROM SHELTER
       WHERE LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL`
    );
    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

initPool()
  .then(() => app.listen(PORT, () => console.log(`Server on :${PORT}`)))
  .catch((e) => {
    console.error('DB init failed', e);
    process.exit(1);
  });