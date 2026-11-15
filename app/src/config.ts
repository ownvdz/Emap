// 개발(디버그) 빌드는 HTTP 주소도 허용되지만, 릴리스 빌드는 HTTPS만 가능합니다.
// DEV: 웹 개발 서버(5173)를 거쳐 /api가 서버로 전달됩니다.
const DEV_API = 'http://138.3.214.235:5173';
// PROD: Caddy로 만든 HTTPS 주소. 실제 만든 하위 도메인 이름으로 바꾸세요.
const PROD_API = 'https://emap-ownvdz.duckdns.org';

export const API_BASE_URL = __DEV__ ? DEV_API : PROD_API;