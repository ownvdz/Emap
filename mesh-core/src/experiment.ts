import { MeshNode, type MeshMessage, type Transport } from './mesh.js';

interface Config { nodes: number; spacing: number; range: number; loss: number }

// 일렬로 선 노드들에서 N0이 SOS를 한 번 보내는 시험을 1회 수행
function runTrial({ nodes, spacing, range, loss }: Config): Promise<{ reached: number; broadcasts: number }> {
  return new Promise((resolve) => {
    const meshNodes: MeshNode[] = [];
    let broadcasts = 0;

    for (let i = 0; i < nodes; i++) {
      const transport: Transport = {
        broadcast: (msg: MeshMessage) => {
          broadcasts++;
          meshNodes.forEach((other, j) => {
            if (j === i) return;
            if (Math.abs(j - i) * spacing > range) return; // 범위 밖
            if (Math.random() < loss) return;              // 전송 손실
            setTimeout(() => other.receive(msg), 5 + Math.random() * 20);
          });
        },
      };
      meshNodes.push(new MeshNode(`N${i}`, transport));
    }

    const sent = meshNodes[0].send('SOS', 'test');
    setTimeout(() => {
      const reached = meshNodes.filter((n) => n.inbox.some((m) => m.id === sent.id)).length;
      resolve({ reached, broadcasts });
    }, 300);
  });
}

async function average(cfg: Config, trials = 300) {
  const results = await Promise.all(Array.from({ length: trials }, () => runTrial(cfg)));
  const avg = (pick: (r: (typeof results)[number]) => number) =>
    (results.reduce((sum, r) => sum + pick(r), 0) / trials).toFixed(2);
  return { reached: avg((r) => r.reached), broadcasts: avg((r) => r.broadcasts) };
}

console.log('[실험 1] 손실률별 평균 (노드 8개 일렬, 간격 80m, 범위 100m, 300회)');
for (const loss of [0, 0.1, 0.3, 0.5]) {
  const r = await average({ nodes: 8, spacing: 80, range: 100, loss });
  console.log(`손실률 ${loss * 100}%  → 도달 ${r.reached}명 / 전송 ${r.broadcasts}회`);
}

console.log('\n[실험 2] 사람 간격별 평균 (노드 12개, 범위 100m, 손실 10%, 300회)');
for (const spacing of [40, 60, 80, 100, 120]) {
  const r = await average({ nodes: 12, spacing, range: 100, loss: 0.1 });
  console.log(`간격 ${spacing}m  → 도달 ${r.reached}명 / 전송 ${r.broadcasts}회`);
}