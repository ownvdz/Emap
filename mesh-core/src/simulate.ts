import { MeshNode, MAX_TTL, type MeshMessage, type Transport } from './mesh.js';

interface Pos { x: number; y: number }

class SimNetwork {
  nodes = new Map<string, { node: MeshNode; pos: Pos }>();
  broadcasts = 0;

  constructor(private range: number, private lossRate = 0) {}

  add(id: string, pos: Pos): MeshNode {
    const transport: Transport = { broadcast: (msg) => this.broadcast(id, msg) };
    const node = new MeshNode(id, transport);
    this.nodes.set(id, { node, pos });
    return node;
  }

  private broadcast(fromId: string, msg: MeshMessage): void {
    this.broadcasts++;
    const from = this.nodes.get(fromId)!;
    for (const [id, { node, pos }] of this.nodes) {
      if (id === fromId) continue;
      if (Math.hypot(pos.x - from.pos.x, pos.y - from.pos.y) > this.range) continue; // 범위 밖
      if (Math.random() < this.lossRate) continue;                                    // 전송 손실
      setTimeout(() => node.receive(msg), 5 + Math.random() * 20);                    // 전송 지연
    }
  }
}

// ---- 시나리오: 80m 간격으로 7명이 일렬로 서 있고, 한 번에 닿는 거리는 100m ----
const net = new SimNetwork(100, 0.1);
for (let i = 0; i < 7; i++) net.add(`N${i}`, { x: i * 80, y: 0 });

const sent = net.nodes.get('N0')!.node.send('SOS', '지하 2층에 도움이 필요합니다');

setTimeout(() => {
  console.log(`\n보낸 메시지: ${sent.id} (최대 ${MAX_TTL}홉)\n`);
  for (const [id, { node }] of net.nodes) {
    const got = node.inbox.find((m) => m.id === sent.id);
    const hops = got ? MAX_TTL - got.ttl + 1 : null;
    console.log(`${id}: ${got ? `수신 (${hops}홉)` : id === 'N0' ? '발신자' : '수신 못함'}, 중복 폐기 ${node.duplicatesDropped}회`);
  }
  console.log(`\n전체 전송 횟수: ${net.broadcasts}`);
}, 1000);