import 'dotenv/config';
import axios from 'axios';

const URL = 'https://safemap.go.kr/openapi2/IF_0124';

async function fetchAll() {
  const all = [];
  let pageNo = 1;
  while (true) {
    const { data } = await axios.get(URL, {
      params: {
        serviceKey: process.env.SAFEMAP_KEY_EARTHQUAKE || process.env.SAFEMAP_SERVICE_KEY,
        pageNo,
        numOfRows: 1000,
        returnType: 'json',
      },
    });
    let list = data.body?.items?.item ?? [];
    if (!Array.isArray(list)) list = [list];
    if (list.length === 0) break;
    all.push(...list);
    if (all.length >= Number(data.body.totalCount)) break;
    pageNo++;
  }
  return all;
}

const rows = await fetchAll();

const byFull = new Set();
const byKey = new Map();
for (const r of rows) {
  byFull.add(JSON.stringify(r));
  const key = [r.ctprvn_nm, r.signgu_nm, r.fclty_nm, r.detail_adres].join('|');
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push(r);
}

console.log(`전체 ${rows.length}건`);
console.log(`모든 필드가 완전히 같은 행을 합치면: ${byFull.size}건`);
console.log(`이름+주소 기준으로 합치면: ${byKey.size}건`);

let diffArea = 0;
const samples = [];
for (const list of byKey.values()) {
  const areas = new Set(list.map((r) => r.aceptnc_posbl_ar));
  if (list.length > 1 && areas.size > 1) {
    diffArea++;
    if (samples.length < 3) samples.push(list);
  }
}
console.log(`같은 이름+주소인데 면적이 다른 그룹: ${diffArea}개`);
samples.forEach((s) => console.log(JSON.stringify(s)));