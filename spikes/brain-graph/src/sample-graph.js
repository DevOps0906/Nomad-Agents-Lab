// 벤치마크 전용 합성 그래프 생성기. 실제 사용자 자료를 쓰지 않고, 같은 시드는 항상 같은 그래프를 만든다.
export const BENCH_NODE_COUNTS = [100, 500, 1000, 2000, 5000];
export const BENCH_DEFAULT_SEED = 20261120;
export const BENCH_LINK_RATIO = 1.5;

const sampleTopics = ['AI 시스템', '세컨드 브레인', '워크플로', '아이디어'];
const sampleKinds = ['노트', '가이드', '프로젝트', '템플릿', '질문'];

// mulberry32: 작은 결정적 PRNG
export const createRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

// nodeCount는 중심 허브를 포함한 전체 노드 수, 관계 수는 round(nodeCount * linkRatio)
export const generateSampleGraph = ({ nodeCount, seed = BENCH_DEFAULT_SEED, coreId = 'brain-core', linkRatio = BENCH_LINK_RATIO }) => {
  const random = createRandom(seed);
  const radius = 3 * Math.cbrt(Math.max(nodeCount, 20) / 20);
  const nodes = [{
    id: coreId,
    title: '세컨드 브레인',
    topic: '세컨드 브레인',
    kind: '중심 허브',
    summary: `합성 벤치마크 그래프의 중심 허브(${nodeCount}개 노드).`,
    tags: ['벤치마크'],
    x: 0,
    y: 0,
    z: 0,
  }];

  for (let index = 1; index < nodeCount; index += 1) {
    const topicIndex = Math.floor(random() * sampleTopics.length);
    // 주제별 군집 중심 주위에 흩뿌린다.
    const clusterAngle = (topicIndex / sampleTopics.length) * Math.PI * 2;
    const theta = clusterAngle + (random() - 0.5) * 1.6;
    const phi = Math.acos(2 * random() - 1);
    const distance = radius * (0.45 + random() * 0.55);
    nodes.push({
      id: `sample-${String(index).padStart(5, '0')}`,
      title: `샘플 자료 ${String(index).padStart(4, '0')}`,
      topic: sampleTopics[topicIndex],
      kind: sampleKinds[Math.floor(random() * sampleKinds.length)],
      summary: `합성 벤치마크용 샘플 자료 ${index}. 실제 문서가 아닙니다.`,
      tags: [`태그${index % 17}`, `묶음${index % 5}`],
      x: Math.sin(phi) * Math.cos(theta) * distance,
      y: Math.cos(phi) * distance,
      z: Math.sin(phi) * Math.sin(theta) * distance,
    });
  }

  const targetLinkCount = Math.round(nodeCount * linkRatio);
  const links = [];
  const seen = new Set();
  const addLink = (a, b) => {
    if (a === b) return false;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) return false;
    seen.add(key);
    links.push([nodes[a].id, nodes[b].id]);
    return true;
  };

  // 연결 그래프 보장: 각 노드를 앞쪽 노드 하나에 잇는다(허브 연결 비중을 둔다).
  for (let index = 1; index < nodeCount; index += 1) {
    addLink(index, random() < 0.08 ? 0 : Math.floor(random() * index));
  }
  // 나머지는 같은 주제를 우선한 임의 관계
  let guard = 0;
  while (links.length < targetLinkCount && guard < targetLinkCount * 20) {
    guard += 1;
    const a = 1 + Math.floor(random() * (nodeCount - 1));
    let b = 1 + Math.floor(random() * (nodeCount - 1));
    for (let attempt = 0; attempt < 4 && nodes[b].topic !== nodes[a].topic && random() < 0.7; attempt += 1) {
      b = 1 + Math.floor(random() * (nodeCount - 1));
    }
    addLink(a, b);
  }

  return { nodes, links, seed, nodeCount, linkCount: links.length };
};
