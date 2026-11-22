import { getItem, setItem } from './storage';

// 이 기기의 요청 식별 정보.
//  - ownerId: 블루투스로 퍼지는 짧은 ID. "누가 만든 요청인지" 표시하는 용도 (인증은 아님)
//  - secretKey: 인터넷 서버에 요청을 올릴 때 쓰는 비밀 키. 서버에는 해시만 저장되고, 이 키가 같아야만 내 요청을 취소·해결할 수 있다.
const ID_KEY = 'emap.owner.id';
const SECRET_KEY = 'emap.owner.key';

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const KEYCHARS = ALNUM + '-_';

function randomString(len: number, chars: string): string {
  const bytes = new Uint8Array(len);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export type Identity = { ownerId: string; secretKey: string };
let cached: Identity | null = null;
let loading: Promise<Identity> | null = null;

export function getIdentity(): Promise<Identity> {
  if (cached) {
    return Promise.resolve(cached);
  }
  if (!loading) {
    loading = (async () => {
      let ownerId = await getItem(ID_KEY);
      let secretKey = await getItem(SECRET_KEY);
      if (!ownerId || !/^[A-Za-z0-9]{6,12}$/.test(ownerId)) {
        ownerId = randomString(8, ALNUM);
        await setItem(ID_KEY, ownerId);
      }
      if (!secretKey || !/^[A-Za-z0-9_-]{16,64}$/.test(secretKey)) {
        secretKey = randomString(32, KEYCHARS);
        await setItem(SECRET_KEY, secretKey);
      }
      cached = { ownerId, secretKey };
      return cached;
    })().finally(() => {
      loading = null;
    });
  }
  return loading;
}

// 요청·메시지 id (블루투스 중복 제거용). 이 기기가 만든 것끼리만 겹치지 않으면 되고, 다른 기기와는 owner로 구분된다.
export function newMessageId(): string {
  return randomString(8, ALNUM);
}
