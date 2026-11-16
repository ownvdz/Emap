// 메시 토폴로지 그래프: 각 기기가 "내 이웃 목록"을 알리면, 받은 기기들이 이를 모아 연결 그래프를 만든다.
// 화면에는 내 기기를 뿌리로 한 트리로 보여주지만, 내부는 그래프라서 중간 기기가 사라져도 다른 경로로 이어진다.

export type NodeInfo = {
  seq: number; // 그 기기가 보낸 최신 순번 (오래된 갱신을 걸러내는 용도)
  neighbors: string[]; // 그 기기가 알린 직접 이웃
  seenAt: number; // 내가 이 갱신을 받은 시각(ms)
};
export type Graph = Map<string, NodeInfo>;

export type TreeNode = { id: string; depth: number; children: TreeNode[] };
export type TreeLine = { id: string; depth: number; text: string };

export function createGraph(): Graph {
  return new Map();
}

// 다른 기기의 이웃 목록을 반영한다. 이미 같은 순번 이하를 받았다면 false(중계도 하지 않음).
export function applyTopology(
  g: Graph,
  id: string,
  seq: number,
  neighbors: string[],
  now: number,
): boolean {
  const prev = g.get(id);
  if (prev && seq <= prev.seq) {
    return false;
  }
  g.set(id, { seq, neighbors: Array.from(new Set(neighbors.filter(n => n && n !== id))), seenAt: now });
  return true;
}

// 일정 시간 갱신이 없는 기기를 지운다. 지워진 id 목록을 돌려준다.
export function pruneGraph(g: Graph, now: number, ttlMs: number): string[] {
  const removed: string[] = [];
  g.forEach((info, id) => {
    if (now - info.seenAt > ttlMs) {
      g.delete(id);
      removed.push(id);
    }
  });
  return removed;
}

// 내(root)가 직접 아는 이웃 + 그래프의 모든 이웃 목록을 합쳐 무방향 간선으로 보고, 너비 우선으로 트리를 만든다.
// 같은 기기가 여러 경로로 보이면 가장 가까운(홉이 적은) 경로 아래에만 나타난다.
export function buildTree(g: Graph, rootId: string, rootNeighbors: string[]): TreeNode {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!a || !b || a === b) {
      return;
    }
    if (!adj.has(a)) {
      adj.set(a, new Set());
    }
    if (!adj.has(b)) {
      adj.set(b, new Set());
    }
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  };
  rootNeighbors.forEach(n => link(rootId, n));
  g.forEach((info, id) => info.neighbors.forEach(n => link(id, n)));

  const root: TreeNode = { id: rootId, depth: 0, children: [] };
  const visited = new Set<string>([rootId]);
  const queue: TreeNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const next = Array.from(adj.get(node.id) ?? []).sort();
    for (const id of next) {
      if (visited.has(id)) {
        continue;
      }
      visited.add(id);
      const child: TreeNode = { id, depth: node.depth + 1, children: [] };
      node.children.push(child);
      queue.push(child);
    }
  }
  return root;
}

export function countNodes(root: TreeNode): number {
  return root.children.reduce((sum, c) => sum + countNodes(c), 1);
}

// 트리를 "├─ └─ │" 모양의 텍스트 줄로 펼친다.
export function flattenTree(root: TreeNode, rootLabel?: string): TreeLine[] {
  const lines: TreeLine[] = [{ id: root.id, depth: 0, text: rootLabel ?? root.id }];
  const walk = (node: TreeNode, prefix: string) => {
    node.children.forEach((child, i) => {
      const last = i === node.children.length - 1;
      lines.push({
        id: child.id,
        depth: child.depth,
        text: `${prefix}${last ? '└─ ' : '├─ '}${child.id}`,
      });
      walk(child, prefix + (last ? '   ' : '│  '));
    });
  };
  walk(root, '');
  return lines;
}
