// 비교용 단일 버퍼 렌더러: 모든 노드를 Points 1개, 모든 관계를 LineSegments 1개로 그리고
// HTML 라벨은 선택 노드와 이웃(최대 24개)에만 붙인다. 레이아웃은 생성 좌표를 그대로 쓴다(실시간 force 없음).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBenchHarness, readBenchParams } from './bench-harness.js';
import { generateSampleGraph } from './sample-graph.js';

const topicColors = {
  'AI 시스템': '#81a7ff',
  '세컨드 브레인': '#b59aff',
  '워크플로': '#67ddc4',
  '아이디어': '#ffc47d',
};
const maxLabels = 24;

const params = readBenchParams() ?? { nodeCount: 1000, seed: 20261120, warmupMs: 5000, sampleMs: 8000, selections: 20 };
const graph = generateSampleGraph({ nodeCount: params.nodeCount, seed: params.seed });
const harness = createBenchHarness({ params, rendererName: 'single-buffer', linkCount: graph.linkCount });

const canvas = document.querySelector('#graph-canvas');
const labelLayer = document.querySelector('#label-layer');
const indexById = new Map(graph.nodes.map((node, index) => [node.id, index]));
const linkIndex = graph.links.map(([source, target]) => [indexById.get(source), indexById.get(target)]);
const neighbors = graph.nodes.map(() => []);
linkIndex.forEach(([a, b], index) => {
  neighbors[a].push({ node: b, link: index });
  neighbors[b].push({ node: a, link: index });
});

const createParticleTexture = () => {
  const size = 64;
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext('2d');
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.45, 'rgba(255,255,255,0.75)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(textureCanvas);
};

harness.markSceneStart();
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
} catch {
  document.querySelector('#bench-note').textContent = 'WebGL을 사용할 수 없어 벤치마크를 실행하지 못했습니다.';
  throw new Error('WebGL unavailable');
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setClearColor('#090d18');

const scene = new THREE.Scene();
const group = new THREE.Group();
scene.add(group);
const radius = 3 * Math.cbrt(Math.max(params.nodeCount, 20) / 20);
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, radius * 20);
camera.position.set(0, radius * 0.1, radius * 3.4);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;

const baseColors = new Float32Array(graph.nodes.length * 3);
const nodePositions = new Float32Array(graph.nodes.length * 3);
graph.nodes.forEach((node, index) => {
  const color = new THREE.Color(index === 0 ? '#ffffff' : topicColors[node.topic]);
  baseColors.set([color.r, color.g, color.b], index * 3);
  nodePositions.set([node.x, node.y, node.z], index * 3);
});
const nodeGeometry = new THREE.BufferGeometry();
nodeGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
nodeGeometry.setAttribute('color', new THREE.BufferAttribute(baseColors.slice(), 3));
const points = new THREE.Points(nodeGeometry, new THREE.PointsMaterial({
  size: 0.32,
  map: createParticleTexture(),
  vertexColors: true,
  transparent: true,
  alphaTest: 0.05,
  depthWrite: false,
}));
group.add(points);

const linkPositions = new Float32Array(linkIndex.length * 6);
const linkBaseColor = new THREE.Color('#536588');
const linkColors = new Float32Array(linkIndex.length * 6);
linkIndex.forEach(([a, b], index) => {
  linkPositions.set(nodePositions.subarray(a * 3, a * 3 + 3), index * 6);
  linkPositions.set(nodePositions.subarray(b * 3, b * 3 + 3), index * 6 + 3);
  for (let end = 0; end < 2; end += 1) linkColors.set([linkBaseColor.r, linkBaseColor.g, linkBaseColor.b], index * 6 + end * 3);
});
const linkGeometry = new THREE.BufferGeometry();
linkGeometry.setAttribute('position', new THREE.BufferAttribute(linkPositions, 3));
linkGeometry.setAttribute('color', new THREE.BufferAttribute(linkColors, 3));
const lines = new THREE.LineSegments(linkGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }));
group.add(lines);

const raycaster = new THREE.Raycaster();
raycaster.params.Points.threshold = 0.14;
const pointer = new THREE.Vector2();
const projected = new THREE.Vector3();
let selectedIndex = null;
let labelled = [];
const labelPool = Array.from({ length: maxLabels + 1 }, () => {
  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'bench-label';
  label.hidden = true;
  labelLayer.append(label);
  return label;
});

const resize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};
window.addEventListener('resize', resize);
resize();

const selectIndex = (index) => {
  selectedIndex = index;
  const colorAttribute = nodeGeometry.attributes.color;
  const related = new Set(neighbors[index].map(({ node }) => node));
  for (let node = 0; node < graph.nodes.length; node += 1) {
    const factor = node === index || related.has(node) ? 1 : 0.22;
    for (let channel = 0; channel < 3; channel += 1) colorAttribute.array[node * 3 + channel] = baseColors[node * 3 + channel] * factor;
  }
  colorAttribute.array.set([1, 1, 1], index * 3);
  colorAttribute.needsUpdate = true;

  const linkColorAttribute = linkGeometry.attributes.color;
  const dim = linkBaseColor.clone().multiplyScalar(0.3);
  for (let link = 0; link < linkIndex.length; link += 1) {
    for (let end = 0; end < 2; end += 1) linkColorAttribute.array.set([dim.r, dim.g, dim.b], link * 6 + end * 3);
  }
  const active = new THREE.Color(topicColors[graph.nodes[index].topic]);
  for (const { link } of neighbors[index]) {
    for (let end = 0; end < 2; end += 1) linkColorAttribute.array.set([active.r, active.g, active.b], link * 6 + end * 3);
  }
  linkColorAttribute.needsUpdate = true;

  labelled = [index, ...neighbors[index].slice(0, maxLabels).map(({ node }) => node)];
  labelPool.forEach((label, slot) => {
    const node = labelled[slot];
    label.hidden = node === undefined;
    if (node === undefined) return;
    label.textContent = graph.nodes[node].title;
    label.classList.toggle('is-selected', node === index);
  });
};

const pickAt = (clientX, clientY) => {
  pointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(points)[0];
  if (hit) selectIndex(hit.index);
  return hit ? hit.index : null;
};
canvas.addEventListener('click', (event) => pickAt(event.clientX, event.clientY));

const worldOf = (index, target) => target.fromArray(nodePositions, index * 3).applyMatrix4(group.matrixWorld);

const updateLabels = () => {
  labelled.forEach((node, slot) => {
    worldOf(node, projected).project(camera);
    const x = (projected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-projected.y * 0.5 + 0.5) * window.innerHeight;
    labelPool[slot].style.transform = `translate3d(${x + 8}px, ${y - 10}px, 0)`;
  });
};

const timer = new THREE.Timer();
const animate = (timestamp) => {
  requestAnimationFrame(animate);
  const frameStart = performance.now();
  timer.update(timestamp);
  group.rotation.y += timer.getDelta() * 0.16;
  controls.update();
  updateLabels();
  renderer.render(scene, camera);
  harness.frame(performance.now() - frameStart);
  harness.markFirstRender();
};
requestAnimationFrame(animate);

harness.run({
  renderer,
  nodeIds: graph.nodes.map(({ id }) => id),
  extra: () => ({ selectedLabels: labelled.length }),
  selectByRaycast: (id) => {
    const index = indexById.get(id);
    group.updateMatrixWorld();
    worldOf(index, projected).project(camera);
    return pickAt((projected.x * 0.5 + 0.5) * window.innerWidth, (-projected.y * 0.5 + 0.5) * window.innerHeight) === index;
  },
});
