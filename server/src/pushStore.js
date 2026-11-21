// 푸시를 받을 기기 토큰 저장소 (JSON 파일). 토큰은 기기를 식별하는 값이므로 파일 권한을 600으로 둔다.
// 위치: server/data/push-tokens.json  (PUSH_TOKEN_FILE 환경변수로 바꿀 수 있음). 이 폴더는 git에 올리지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE =
  process.env.PUSH_TOKEN_FILE ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'push-tokens.json');

export const MAX_TOKENS = 5000; // 가짜 등록이 쌓여도 무한히 커지지 않게 상한을 둔다
// FCM 토큰이 가질 수 있는 문자와 대략의 길이만 확인한다
export const isValidToken = (t) => typeof t === 'string' && /^[A-Za-z0-9:_\-]{50,400}$/.test(t);

let cache = null; // Map<token, { first: number, last: number }>
let writing = Promise.resolve();

async function load() {
  if (cache) return cache;
  try {
    const obj = JSON.parse(await fs.readFile(FILE, 'utf8'));
    cache = new Map(Object.entries(obj));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[push] 토큰 파일을 읽지 못해 빈 목록으로 시작합니다:', e.message);
    cache = new Map();
  }
  return cache;
}

// 저장은 한 번에 하나씩, 임시 파일에 쓴 뒤 바꿔치기해서 도중에 꺼져도 파일이 깨지지 않게 한다
function persist() {
  writing = writing
    .then(async () => {
      await fs.mkdir(path.dirname(FILE), { recursive: true });
      const tmp = `${FILE}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(cache)), { mode: 0o600 });
      await fs.rename(tmp, FILE);
    })
    .catch((e) => console.error('[push] 토큰 파일 저장 실패:', e.message));
  return writing;
}

// 새 토큰이면 추가, 이미 있으면 마지막 확인 시각만 갱신. 상한을 넘으면 새 토큰은 거절(false).
export async function saveToken(token, now = Date.now()) {
  const map = await load();
  const prev = map.get(token);
  if (!prev && map.size >= MAX_TOKENS) return false;
  map.set(token, { first: prev?.first ?? now, last: now });
  await persist();
  return true;
}

export async function listTokens() {
  return [...(await load()).keys()];
}

export async function removeTokens(tokens) {
  const map = await load();
  let n = 0;
  for (const t of tokens) if (map.delete(t)) n++;
  if (n > 0) await persist();
  return n;
}
