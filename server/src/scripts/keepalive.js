import 'dotenv/config';
import { initPool, query } from '../db.js';

// db 정지 방지를 위한 주기적 발동 쿼리
try {
  await initPool();
  const r = await query('SELECT COUNT(*) AS CNT FROM SHELTER');
  console.log(new Date().toISOString(), 'keepalive ok, rows:', r.rows[0].CNT);
  process.exit(0);
} catch (e) {
  console.error(new Date().toISOString(), 'keepalive FAILED:', e.message);
  process.exit(1);
}