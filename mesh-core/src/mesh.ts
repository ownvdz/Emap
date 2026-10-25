export type MessageType = 'SOS' | 'TEXT' | 'SHELTER_INFO';

export interface MeshMessage {
  id: string;        // 발신자ID-순번. 같은 메시지를 중복 처리하지 않기 위한 고유값
  origin: string;    // 최초 발신 노드
  type: MessageType;
  body: string;
  ttl: number;       // 앞으로 몇 홉 더 전달할 수 있는지
  createdAt: number;
}

// 통신 수단(BLE, Wi-Fi, 시뮬레이터)은 이 인터페이스만 구현하면 된다
export interface Transport {
  broadcast(msg: MeshMessage): void;
}

export const MAX_TTL = 5;

export class MeshNode {
  private seen = new Map<string, number>(); // 이미 처리한 메시지 ID -> 시각
  private seq = 0;
  readonly inbox: MeshMessage[] = [];
  duplicatesDropped = 0;

  constructor(
    readonly id: string,
    private transport: Transport,
    private seenTtlMs = 10 * 60 * 1000,
    private maxSeen = 2000,
  ) {}

  send(type: MessageType, body: string): MeshMessage {
    const msg: MeshMessage = {
      id: `${this.id}-${++this.seq}`,
      origin: this.id,
      type,
      body,
      ttl: MAX_TTL,
      createdAt: Date.now(),
    };
    this.remember(msg.id); // 내가 보낸 메시지가 되돌아와도 무시하기 위해
    this.transport.broadcast(msg);
    return msg;
  }

  receive(msg: MeshMessage): void {
    if (this.seen.has(msg.id)) {
      this.duplicatesDropped++;
      return; // 이미 본 메시지는 버린다 (무한 전파 방지)
    }
    this.remember(msg.id);
    this.inbox.push(msg);

    if (msg.ttl > 1) {
      this.transport.broadcast({ ...msg, ttl: msg.ttl - 1 }); // 이웃에게 중계
    }
  }

  // 오래됐거나 너무 많이 쌓인 기록은 앞에서부터 지운다 (Map은 삽입 순서를 유지)
  private remember(id: string): void {
    const now = Date.now();
    this.seen.set(id, now);
    for (const [key, t] of this.seen) {
      if (now - t > this.seenTtlMs || this.seen.size > this.maxSeen) this.seen.delete(key);
      else break;
    }
  }
}