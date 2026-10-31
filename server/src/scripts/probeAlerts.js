import 'dotenv/config';
import axios from 'axios';

const API_URL = 'https://www.safetydata.go.kr/V2/api/DSSP-IF-00247';
const region = process.argv[2] || '인천광역시';

const d = new Date(Date.now() - 3 * 86400000);
const crtDt = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

try {
  const { data } = await axios.get(API_URL, {
    params: {
      serviceKey: process.env.SAFETYDATA_SERVICE_KEY,
      returnType: 'json',
      pageNo: 1,
      numOfRows: 5,
      crtDt,
      rgnNm: region,
    },
    timeout: 8000,
  });
  console.log('조회 조건:', { region, crtDt });
  console.log('최상위 키:', Object.keys(data));
  console.log(JSON.stringify(data, null, 2).slice(0, 3000));
} catch (e) {
  console.error('실패:', e.response?.status, e.response?.data ?? e.message);
}