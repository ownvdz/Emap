import 'dotenv/config';
import fs from 'fs';
import { initPool, query } from '../db.js';

async function main() {
  await initPool();

  const sql = fs.readFileSync(new URL('../../sql/schema.sql', import.meta.url), 'utf-8');

  // CREATE TABLE과 CREATE INDEX처럼 세미콜론으로 구분된 여러 문장을 순서대로 실행
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    console.log('실행 중:', stmt.slice(0, 50) + '...');
    await query(stmt);
  }

  console.log('스키마 생성 완료');
  process.exit(0);
}

main().catch((e) => {
  console.error('스키마 생성 실패:', e.message);
  process.exit(1);
});