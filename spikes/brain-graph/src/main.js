import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const topics = {
  'AI 시스템': { color: '#81a7ff', className: 'ai' },
  '세컨드 브레인': { color: '#b59aff', className: 'brain' },
  '워크플로': { color: '#67ddc4', className: 'flow' },
  '아이디어': { color: '#ffc47d', className: 'ideas' },
};

const coreNodeId = 'brain-core';

const nodes = [
  { id: coreNodeId, title: '세컨드 브레인', topic: '세컨드 브레인', kind: '중심 허브', summary: '18개의 샘플 자료와 생각을 연결하는 세컨드 브레인 중심 허브.', tags: ['지식 관리', '탐색'], x: 0, y: 0, z: 0 },
  { id: 'ssr-plus', title: '나만의 AI 업무 시스템', topic: 'AI 시스템', kind: '노트', summary: 'Skill, Second Brain, Routine, Extension으로 일하는 방식을 연결하는 개인 AI 시스템.', tags: ['SSR+', '개인 AI'], x: -2.6, y: 1.6, z: 0.4 },
  { id: 'agent-skills', title: '재사용 가능한 AI 스킬', topic: 'AI 시스템', kind: '가이드', summary: '반복 업무를 작은 지침과 도구 조합으로 만들고 필요할 때 불러오는 방법.', tags: ['스킬', '자동화'], x: -3.2, y: 0.3, z: 1.1 },
  { id: 'prompt-design', title: '좋은 프롬프트의 구조', topic: 'AI 시스템', kind: '노트', summary: '목표, 맥락, 제약, 결과 형식을 분리하면 실행 결과를 더 안정적으로 다룰 수 있다.', tags: ['프롬프트', '설계'], x: -1.6, y: 2.4, z: -0.8 },
  { id: 'local-first', title: '로컬 우선 데이터 원칙', topic: 'AI 시스템', kind: '원칙', summary: '데이터 저장 위치와 AI 처리 위치를 구분하고 매 실행의 자료 범위를 확인한다.', tags: ['프라이버시', '로컬'], x: -4.1, y: 1.3, z: -0.7 },
  { id: 'second-brain', title: '세컨드 브레인 설계', topic: '세컨드 브레인', kind: '프로젝트', summary: '자료를 모으고 연결하며 다시 꺼내 쓸 수 있도록 개인 지식의 구조를 설계한다.', tags: ['지식 관리', '탐색'], x: 0.1, y: 1.2, z: 0.2 },
  { id: 'zettelkasten', title: '제텔카스텐 메모법', topic: '세컨드 브레인', kind: '노트', summary: '원자적인 메모를 연결해 생각을 발전시키는 지식 관리 방법.', tags: ['메모', '링크'], x: 1.2, y: 2.2, z: -0.6 },
  { id: 'knowledge-graph', title: '지식 그래프와 연결', topic: '세컨드 브레인', kind: '노트', summary: '문서, 태그, 폴더의 관계를 시각적으로 탐색하고 연결 이유를 이해한다.', tags: ['그래프', '관계'], x: 1.3, y: 0.3, z: 1.3 },
  { id: 'capture-loop', title: '수집에서 회고까지', topic: '세컨드 브레인', kind: '워크플로', summary: '수집, 정리, 연결, 재발견을 반복하는 개인 지식 관리 루프.', tags: ['수집', '회고'], x: 2.6, y: 1.1, z: -0.8 },
  { id: 'daily-review', title: '데일리 리뷰', topic: '워크플로', kind: '루틴', summary: '하루의 기록과 남은 일을 짧게 검토해 다음 행동을 정하는 루틴.', tags: ['리뷰', '루틴'], x: 3.3, y: 0.1, z: 0.2 },
  { id: 'weekly-review', title: '주간 회고 템플릿', topic: '워크플로', kind: '템플릿', summary: '한 주의 성과, 배움, 막힌 점을 돌아보고 다음 주의 초점을 선택한다.', tags: ['회고', '템플릿'], x: 3.4, y: 1.8, z: 0.9 },
  { id: 'automation', title: '작은 업무 자동화', topic: '워크플로', kind: '가이드', summary: '명확한 입력과 완료 조건이 있는 반복 작업부터 안전하게 자동화한다.', tags: ['자동화', '실행'], x: 2.6, y: -0.9, z: 1.2 },
  { id: 'focus-time', title: '집중 시간 만들기', topic: '워크플로', kind: '노트', summary: '주의를 분산시키는 요소를 줄이고 에너지가 높은 시간에 중요한 일을 배치한다.', tags: ['집중', '시간'], x: 4.2, y: -0.6, z: -0.5 },
  { id: 'idea-garden', title: '아이디어 정원', topic: '아이디어', kind: '프로젝트', summary: '아직 완성되지 않은 아이디어를 저장하고 연결해 천천히 키우는 공간.', tags: ['아이디어', '창작'], x: -0.4, y: -1.7, z: 1.5 },
  { id: 'learning-map', title: '나만의 학습 지도', topic: '아이디어', kind: '아이디어', summary: '배우고 싶은 주제를 작은 질문과 실험으로 나누어 진행 상황을 기록한다.', tags: ['학습', '지도'], x: 0.8, y: -2.1, z: 0.4 },
  { id: 'writing-seed', title: '글쓰기 씨앗 노트', topic: '아이디어', kind: '노트', summary: '문장 하나, 사례 하나처럼 나중에 글로 발전시킬 작은 재료를 모은다.', tags: ['글쓰기', '초안'], x: -1.7, y: -2.1, z: -0.3 },
  { id: 'curiosity', title: '호기심 질문 모음', topic: '아이디어', kind: '질문', summary: '답을 아직 모르는 질문을 남겨 두고 자료와 경험을 통해 탐구한다.', tags: ['질문', '탐구'], x: -2.9, y: -1.5, z: 0.7 },
  { id: 'reading-notes', title: '읽기와 생각의 기록', topic: '세컨드 브레인', kind: '노트', summary: '읽은 내용을 요약하는 데서 그치지 않고 기존 생각과 연결해 내 언어로 남긴다.', tags: ['독서', '기록'], x: -0.3, y: 0.2, z: -1.5 },
  { id: 'weekly-planning', title: '주간 계획 보드', topic: '워크플로', kind: '템플릿', summary: '이번 주에 할 수 있는 일의 양을 정하고 가장 중요한 결과에 집중한다.', tags: ['계획', '우선순위'], x: 1.7, y: -1.2, z: -1.3 },
];

const links = [
  ['brain-core', 'ssr-plus'], ['brain-core', 'second-brain'], ['brain-core', 'idea-garden'], ['brain-core', 'daily-review'],
  ['ssr-plus', 'agent-skills'], ['ssr-plus', 'prompt-design'], ['ssr-plus', 'local-first'],
  ['ssr-plus', 'second-brain'], ['ssr-plus', 'automation'], ['agent-skills', 'prompt-design'],
  ['agent-skills', 'automation'], ['local-first', 'second-brain'], ['second-brain', 'zettelkasten'],
  ['second-brain', 'knowledge-graph'], ['second-brain', 'capture-loop'], ['second-brain', 'reading-notes'],
  ['zettelkasten', 'reading-notes'], ['knowledge-graph', 'capture-loop'], ['capture-loop', 'daily-review'],
  ['daily-review', 'weekly-review'], ['weekly-review', 'weekly-planning'], ['automation', 'daily-review'],
  ['automation', 'focus-time'], ['idea-garden', 'learning-map'], ['idea-garden', 'writing-seed'],
  ['idea-garden', 'curiosity'], ['learning-map', 'curiosity'], ['writing-seed', 'reading-notes'],
];

const nodeById = new Map(nodes.map((node) => [node.id, node]));
const linkData = links.map(([source, target]) => ({ source, target }));
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const canvas = document.querySelector('#graph-canvas');
const host = document.querySelector('#canvas-host');
const labelLayer = document.querySelector('#label-layer');
const map2d = document.querySelector('#map-2d');
const listView = document.querySelector('#node-list-view');
const graphLayout = document.querySelector('.graph-layout');
const dashboardPage = document.querySelector('#dashboard-page');
const brainPage = document.querySelector('#brain-page');
const status = document.querySelector('#graph-status');
const details = document.querySelector('#node-details');
const relatedList = document.querySelector('#related-list');
const relatedCount = document.querySelector('#related-count');
const emptyMessage = document.querySelector('#graph-empty');
const searchInput = document.querySelector('#search-input');
const topicFilter = document.querySelector('#topic-filter');
const viewButtons = [...document.querySelectorAll('.view-button')];
const timer = new THREE.Timer();
timer.connect(document);
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const projected = new THREE.Vector3();
const worldPosition = new THREE.Vector3();
const nodeObjects = new Map();
const labelElements = new Map();

let renderer;
let scene;
let orbitGroup;
let camera;
let controls;
let linkGeometry;
let linkLines;
let selectedId = null;
let activeView = '3d';
let motionPaused = reducedMotion.matches;
let visibleNodes = new Set(nodes.map(({ id }) => id));
let width = 0;
let height = 0;

const createSpherePoints = (count, radius) => {
  const positions = new Float32Array(count * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const y = 1 - (index / (count - 1)) * 2;
    const ringRadius = Math.sqrt(1 - y * y);
    const angle = goldenAngle * index;
    const pointRadius = radius * (0.72 + ((index * 17) % 29) / 100);
    positions[index * 3] = Math.cos(angle) * ringRadius * pointRadius;
    positions[index * 3 + 1] = y * pointRadius;
    positions[index * 3 + 2] = Math.sin(angle) * ringRadius * pointRadius;
  }

  return positions;
};

const createParticleTexture = () => {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 32;
  textureCanvas.height = 32;
  const context = textureCanvas.getContext('2d');
  if (!context) throw new Error('Particle texture canvas is unavailable.');
  const gradient = context.createRadialGradient(16, 16, 0, 16, 16, 16);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(textureCanvas);
};

const createGatherPositions = (targetPositions) => {
  const positions = new Float32Array(targetPositions.length);
  const count = targetPositions.length / 3;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < count; index += 1) {
    const y = 1 - ((index + 0.5) / count) * 2;
    const ringRadius = Math.sqrt(1 - y * y);
    const angle = goldenAngle * index;
    const spread = 1.8 + ((index * 37) % 101) / 100 * 1.25;
    positions[index * 3] = Math.cos(angle) * ringRadius * spread;
    positions[index * 3 + 1] = y * spread;
    positions[index * 3 + 2] = Math.sin(angle) * ringRadius * spread;
  }

  return positions;
};

const particleTexture = createParticleTexture();

const addNode = (node, index) => {
  const topic = topics[node.topic];
  const isCore = node.id === coreNodeId;
  const anchor = isCore
    ? new THREE.Vector3()
    : new THREE.Vector3(node.x, node.y * 0.72, node.z).normalize().multiplyScalar(3 + (index % 3) * 0.48);
  const pointCount = isCore ? 840 : 96;
  const pointRadius = isCore ? 1.02 : 0.28;
  const geometry = new THREE.BufferGeometry();
  const targetPositions = createSpherePoints(pointCount, pointRadius);
  const startPositions = isCore ? createGatherPositions(targetPositions) : null;
  const particlePositions = startPositions ?? targetPositions;
  geometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
  if (isCore) {
    const colors = new Float32Array(pointCount * 3);
    for (let particleIndex = 0; particleIndex < pointCount; particleIndex += 1) {
      const color = particleIndex % 8 === 0
        ? new THREE.Color('#ffffff')
        : new THREE.Color().setHSL(0.73 + ((particleIndex * 13) % 17) / 100, 0.52, 0.62 + ((particleIndex * 29) % 35) / 100);
      colors[particleIndex * 3] = color.r;
      colors[particleIndex * 3 + 1] = color.g;
      colors[particleIndex * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  const material = new THREE.PointsMaterial({
    color: isCore ? '#ffffff' : topic.color,
    map: particleTexture,
    alphaTest: isCore ? 0.015 : 0.08,
    size: isCore ? 0.32 : 0.38,
    sizeAttenuation: true,
    transparent: true,
    opacity: isCore ? 0.04 : 0.08,
    depthWrite: false,
    depthTest: !isCore,
    vertexColors: isCore,
    blending: isCore ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.position.copy(anchor);
  points.scale.setScalar(0.01);
  points.userData = {
    nodeId: node.id,
    introDelay: index * 75,
    targetScale: isCore ? 1 : 0.75 + ((index * 7) % 5) * 0.09,
    anchor,
    isCore,
    ...(isCore ? { startPositions, targetPositions } : {}),
  };
  points.rotation.set((index % 4) * 0.17, (index % 6) * 0.13, 0);
  if (isCore) {
    points.frustumCulled = false;
    points.renderOrder = 10;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: particleTexture,
        color: topic.color,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    glow.scale.set(4.2, 4.2, 1);
    glow.userData.isCoreGlow = true;
    glow.renderOrder = 11;
    points.add(glow);

    for (const [radius, tilt] of [[1.24, 0.28], [1.48, -0.46]]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(radius, 0.009, 6, 112),
        new THREE.MeshBasicMaterial({
          color: topic.color,
          transparent: true,
          opacity: 0.52,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
        }),
      );
      ring.rotation.x = Math.PI / 2 + tilt;
      ring.userData = { isCoreRing: true, rotationSpeed: radius > 1.2 ? -0.06 : 0.08 };
      ring.renderOrder = 12;
      points.add(ring);
    }
  }
  if (isCore) scene.add(points);
  else orbitGroup.add(points);
  nodeObjects.set(node.id, points);

  const label = document.createElement('button');
  label.className = `node-label ${topic.className}${isCore ? ' is-core' : ''}`;
  label.type = 'button';
  label.dataset.nodeId = node.id;
  label.tabIndex = 0;
  label.textContent = isCore ? '세컨드 브레인' : node.title;
  label.setAttribute('aria-label', `${isCore ? '세컨드 브레인 중심 노드' : node.title}, ${node.topic}`);
  label.addEventListener('click', () => selectNode(node.id));
  labelLayer.append(label);
  labelElements.set(node.id, label);
};

const createScene = () => {
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch {
    return false;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  raycaster.params.Points.threshold = 0.28;
  scene = new THREE.Scene();
  orbitGroup = new THREE.Group();
  scene.add(orbitGroup);
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.2, 12.5);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.75;
  controls.minDistance = 5.3;
  controls.maxDistance = 22;
  controls.target.set(0, 0, 0);
  controls.autoRotate = false;

  for (let index = 0; index < nodes.length; index += 1) addNode(nodes[index], index);

  linkGeometry = new THREE.BufferGeometry();
  linkGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(links.length * 6), 3));
  const linkMaterial = new THREE.LineBasicMaterial({ color: '#536588', transparent: true, opacity: 0.34 });
  linkLines = new THREE.LineSegments(linkGeometry, linkMaterial);
  orbitGroup.add(linkLines);

  const starPositions = createSpherePoints(300, 11);
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: '#7b8bae',
    map: particleTexture,
    alphaTest: 0.08,
    size: 0.07,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  }));
  scene.add(stars);

  resizeRenderer();
  return true;
};

const resizeRenderer = () => {
  if (!renderer) return;
  const bounds = host.getBoundingClientRect();
  width = Math.max(bounds.width, 1);
  height = Math.max(bounds.height, 1);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};

const applyForces = (delta) => {
  const timeStep = Math.min(delta, 0.035);
  const forces = new Map(nodes.map(({ id }) => [id, new THREE.Vector3()]));

  for (let left = 0; left < nodes.length; left += 1) {
    const a = nodeObjects.get(nodes[left].id);
    const aForce = forces.get(nodes[left].id);
    for (let right = left + 1; right < nodes.length; right += 1) {
      const b = nodeObjects.get(nodes[right].id);
      const deltaPosition = a.position.clone().sub(b.position);
      const distanceSquared = Math.max(deltaPosition.lengthSq(), 0.22);
      deltaPosition.multiplyScalar(0.7 / distanceSquared);
      aForce.add(deltaPosition);
      forces.get(nodes[right].id).sub(deltaPosition);
    }
  }

  for (const { source, target } of linkData) {
    const a = nodeObjects.get(source);
    const b = nodeObjects.get(target);
    const spring = b.position.clone().sub(a.position);
    const length = spring.length();
    spring.multiplyScalar((length - 1.72) * 0.055);
    forces.get(source).add(spring);
    forces.get(target).sub(spring);
  }

  for (const node of nodes) {
    const object = nodeObjects.get(node.id);
    const force = forces.get(node.id);
    if (node.id === coreNodeId) continue;
    force.addScaledVector(object.userData.anchor.clone().sub(object.position), 0.022);
    object.userData.velocity ??= new THREE.Vector3();
    object.userData.velocity.addScaledVector(force, timeStep).multiplyScalar(0.93);
    object.position.addScaledVector(object.userData.velocity, timeStep * 8);
  }
};

const updateLinks = () => {
  const positions = linkGeometry.attributes.position;
  let offset = 0;

  for (const { source, target } of linkData) {
    const from = nodeObjects.get(source).position;
    const to = nodeObjects.get(target).position;
    const isVisible = (source === coreNodeId || visibleNodes.has(source)) && (target === coreNodeId || visibleNodes.has(target));
    positions.setXYZ(offset, isVisible ? from.x : 0, isVisible ? from.y : 0, isVisible ? from.z : 0);
    positions.setXYZ(offset + 1, isVisible ? to.x : 0, isVisible ? to.y : 0, isVisible ? to.z : 0);
    offset += 2;
  }
  positions.needsUpdate = true;
  linkGeometry.computeBoundingSphere();

  const selectedTopic = selectedId ? nodeById.get(selectedId)?.topic : null;
  const colors = linkLines.material;
  colors.opacity = selectedId ? 0.74 : 0.34;
  linkLines.geometry.attributes.position.needsUpdate = true;
  linkData.forEach(({ source, target }, index) => {
    const active = selectedId && (source === selectedId || target === selectedId);
    const start = index * 2;
    colors.opacity = active ? 0.8 : selectedId ? 0.12 : 0.34;
    const tint = active ? topics[selectedTopic].color : '#7785a0';
    const color = new THREE.Color(tint);
    linkLines.geometry.attributes.color ??= new THREE.BufferAttribute(new Float32Array(links.length * 6), 3);
    linkLines.geometry.attributes.color.setXYZ(start, color.r, color.g, color.b);
    linkLines.geometry.attributes.color.setXYZ(start + 1, color.r, color.g, color.b);
  });
  if (!linkLines.geometry.attributes.color) return;
  linkLines.geometry.attributes.color.needsUpdate = true;
  linkLines.material.vertexColors = true;
  linkLines.material.opacity = 0.74;
};

const updateLabels = () => {
  for (const node of nodes) {
    const object = nodeObjects.get(node.id);
    const label = labelElements.get(node.id);
    const visible = visibleNodes.has(node.id);
    label.hidden = !visible;
    if (!visible || activeView !== '3d') continue;

    object.getWorldPosition(worldPosition);
    projected.copy(worldPosition).project(camera);
    const inFront = projected.z < 1;
    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-projected.y * 0.5 + 0.5) * height;
    label.style.transform = node.id === coreNodeId
      ? `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`
      : `translate3d(${x + 12}px, ${y}px, 0) translateY(-50%)`;
    label.classList.toggle('is-selected', selectedId === node.id);
    label.classList.toggle('is-dimmed', selectedId !== null && selectedId !== node.id);
    label.classList.toggle('is-related', selectedId !== null && linkData.some(({ source, target }) => (source === selectedId && target === node.id) || (target === selectedId && source === node.id)));
    label.hidden = !inFront || x < -90 || x > width + 60 || y < -30 || y > height + 40;
  }
};

const animate = (timestamp) => {
  requestAnimationFrame(animate);
  if (!renderer || activeView !== '3d' || !dashboardPage.hidden) {
    if (renderer) timer.update(timestamp);
    return;
  }
  timer.update(timestamp);
  const delta = timer.getDelta();
  const elapsed = timer.getElapsed();
  controls.update();

  if (!motionPaused && elapsed < 4.5) applyForces(delta);
  if (!motionPaused) orbitGroup.rotation.y += delta * 0.16;

  for (const [index, node] of nodes.entries()) {
    const object = nodeObjects.get(node.id);
    const introDuration = object.userData.isCore ? 2200 : 850;
    const progress = motionPaused ? 1 : THREE.MathUtils.clamp((elapsed * 1000 - object.userData.introDelay) / introDuration, 0, 1);
    const eased = 1 - (1 - progress) ** 3;
    const selected = selectedId === node.id;
    const dimmed = selectedId !== null && !isRelated(selectedId, node.id) && selectedId !== node.id;
    if (object.userData.isCore) {
      const positions = object.geometry.attributes.position;
      const pulse = progress === 1 && !motionPaused ? 1 + Math.sin(elapsed * 1.8) * 0.012 : 1;
      for (let particleIndex = 0; particleIndex < positions.count; particleIndex += 1) {
        const offset = particleIndex * 3;
        const start = object.userData.startPositions;
        const target = object.userData.targetPositions;
        positions.array[offset] = (start[offset] + (target[offset] - start[offset]) * eased) * pulse;
        positions.array[offset + 1] = (start[offset + 1] + (target[offset + 1] - start[offset + 1]) * eased) * pulse;
        positions.array[offset + 2] = (start[offset + 2] + (target[offset + 2] - start[offset + 2]) * eased) * pulse;
      }
      positions.needsUpdate = true;
      object.scale.setScalar(object.userData.targetScale * eased * pulse * (selected ? 1.08 : 1));
      object.material.opacity = (0.12 + eased * 0.78) * (dimmed ? 0.24 : 1);
      object.material.size = selected ? 0.38 : 0.32;
    } else {
      object.scale.setScalar(object.userData.targetScale * eased * (selected ? 1.32 : 1));
      object.material.opacity = (0.28 + eased * 0.54) * (dimmed ? 0.24 : 1);
      object.material.size = selected ? 0.48 : 0.38;
    }
    object.rotation.y += motionPaused ? 0 : delta * (0.1 + (index % 4) * 0.018);
    if (object.userData.isCore) {
      for (const child of object.children) {
        if (child.userData.isCoreRing) child.rotation.z += motionPaused ? 0 : child.userData.rotationSpeed;
        if (child.userData.isCoreGlow) child.material.opacity = (0.06 + eased * 0.2) * (selected ? 1.25 : 1);
      }
    }
  }

  updateLinks();
  updateLabels();
  renderer.render(scene, camera);
};

const isRelated = (sourceId, targetId) => linkData.some(({ source, target }) => (source === sourceId && target === targetId) || (target === sourceId && source === targetId));

const getRelatedNodes = (id) => linkData
  .filter(({ source, target }) => source === id || target === id)
  .map(({ source, target }) => nodeById.get(source === id ? target : source));

const selectNode = (id) => {
  const node = nodeById.get(id);
  if (!node) return;
  selectedId = id;
  graphLayout.classList.add('has-selection');
  details.innerHTML = `
    <div class="selected-topic"><i class="legend-dot ${topics[node.topic].className}"></i>${node.topic}</div>
    <h3 class="selected-title">${node.title}</h3>
    <p class="selected-summary">${node.summary}</p>
    <div class="detail-meta"><span>${node.kind}</span><span>샘플 자료</span></div>
    <div class="tag-list">${node.tags.map((tag) => `<span>#${tag}</span>`).join('')}</div>
    <button class="open-document" type="button" disabled title="프로토타입에는 실제 문서가 연결되어 있지 않습니다.">자료 미리보기 <span aria-hidden="true">↗</span></button>
  `;
  const related = getRelatedNodes(id);
  relatedCount.textContent = String(related.length).padStart(2, '0');
  relatedList.innerHTML = related.map((relatedNode) => `
    <button class="related-item" type="button" data-node-id="${relatedNode.id}">
      <i class="legend-dot ${topics[relatedNode.topic].className}"></i>
      <span>${relatedNode.title}<small>${node.topic === relatedNode.topic ? '같은 주제' : '연결된 생각'}</small></span>
      <b aria-hidden="true">↗</b>
    </button>
  `).join('');
  relatedList.querySelectorAll('[data-node-id]').forEach((button) => button.addEventListener('click', () => selectNode(button.dataset.nodeId)));
  document.querySelectorAll('.node-label').forEach((label) => {
    label.classList.toggle('is-selected', label.dataset.nodeId === id);
    label.classList.toggle('is-related', isRelated(id, label.dataset.nodeId));
    label.classList.toggle('is-dimmed', label.dataset.nodeId !== id && !isRelated(id, label.dataset.nodeId));
  });
  status.textContent = `${node.title} 선택됨. 연결된 생각 ${related.length}개.`;
  if (activeView === '2d') render2d();
  if (activeView === 'list') renderList();
};

const clearSelection = () => {
  selectedId = null;
  graphLayout.classList.remove('has-selection');
  details.innerHTML = `
    <div class="detail-empty">
      <div class="empty-orbit" aria-hidden="true"><span></span><i></i></div>
      <strong>노드를 선택해 보세요</strong>
      <p>그래프에서 점을 선택하면<br />연결된 생각과 자료를 보여드려요.</p>
    </div>`;
  relatedCount.textContent = '—';
  relatedList.innerHTML = '<p class="related-empty">노드를 선택하면 연결이 표시됩니다.</p>';
  document.querySelectorAll('.node-label').forEach((label) => label.classList.remove('is-selected', 'is-related', 'is-dimmed'));
  if (activeView === '2d') render2d();
  if (activeView === 'list') renderList();
  status.textContent = '선택 해제됨.';
};

const updateVisibleNodes = () => {
  const query = searchInput.value.trim().toLocaleLowerCase('ko');
  const topic = topicFilter.value;
  visibleNodes = new Set(nodes.filter((node) => {
    if (node.id === coreNodeId) return true;
    const matchesText = !query || `${node.title} ${node.summary} ${node.topic} ${node.tags.join(' ')}`.toLocaleLowerCase('ko').includes(query);
    return matchesText && (topic === 'all' || topic === node.topic);
  }).map(({ id }) => id));

  for (const [id, object] of nodeObjects) {
    object.visible = id === coreNodeId || visibleNodes.has(id);
    labelElements.get(id).hidden = id !== coreNodeId && !visibleNodes.has(id);
  }

  const visibleDocumentCount = [...visibleNodes].filter((id) => id !== coreNodeId).length;
  emptyMessage.hidden = visibleDocumentCount !== 0;
  document.querySelector('#document-count').textContent = String(visibleDocumentCount).padStart(2, '0');
  document.querySelector('#footer-node-count').textContent = visibleNodes.size;
  document.querySelector('#connection-count').textContent = linkData.filter(({ source, target }) => visibleNodes.has(source) && visibleNodes.has(target)).length;
  if (selectedId && !visibleNodes.has(selectedId)) clearSelection();
  if (activeView === '2d') render2d();
  if (activeView === 'list') renderList();
};

const render2d = () => {
  const displayedNodes = nodes.filter(({ id }) => id === coreNodeId || visibleNodes.has(id));
  const positions = new Map(displayedNodes.map((node, index) => {
    if (node.id === coreNodeId) return [node.id, { x: 50, y: 50 }];
    const angle = (index / Math.max(displayedNodes.length, 1)) * Math.PI * 2;
    const radius = 30 + (index % 3) * 3;
    return [node.id, { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius * 0.72 }];
  }));
  const lineSvg = linkData.filter(({ source, target }) => positions.has(source) && positions.has(target)).map(({ source, target }) => {
    const from = positions.get(source);
    const to = positions.get(target);
    const active = selectedId && (source === selectedId || target === selectedId);
    return `<line x1="${from.x}%" y1="${from.y}%" x2="${to.x}%" y2="${to.y}%" class="${active ? 'map-line active' : selectedId ? 'map-line dimmed' : 'map-line'}" />`;
  }).join('');
  const circles = displayedNodes.map((node) => {
    const position = positions.get(node.id);
    const topic = topics[node.topic];
    const isCore = node.id === coreNodeId;
    return `<button type="button" class="map-node ${topic.className} ${isCore ? 'is-core' : ''} ${selectedId === node.id ? 'is-selected' : ''} ${selectedId && selectedId !== node.id && !isRelated(selectedId, node.id) ? 'is-dimmed' : ''}" data-node-id="${node.id}" style="left:${position.x}%;top:${position.y}%" aria-label="${isCore ? '중심 허브, 세컨드 브레인' : `${node.title}, ${node.topic}`}"><i></i><span>${isCore ? '세컨드 브레인' : node.title}</span></button>`;
  }).join('');
  map2d.innerHTML = `<svg class="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lineSvg}</svg>${circles}`;
  map2d.querySelectorAll('.map-node').forEach((button) => button.addEventListener('click', () => selectNode(button.dataset.nodeId)));
};

const renderList = () => {
  const displayedNodes = nodes.filter(({ id }) => visibleNodes.has(id));
  listView.innerHTML = displayedNodes.length ? displayedNodes.map((node) => `
    <button type="button" class="list-node ${selectedId === node.id ? 'is-selected' : ''}" data-node-id="${node.id}">
      <i class="legend-dot ${topics[node.topic].className}"></i>
      <span><strong>${node.title}</strong><small>${node.topic} · ${node.kind}</small></span>
      <span class="list-chevron" aria-hidden="true">›</span>
    </button>
  `).join('') : '<p class="list-empty">검색 결과가 없습니다.</p>';
  listView.querySelectorAll('[data-node-id]').forEach((button) => button.addEventListener('click', () => selectNode(button.dataset.nodeId)));
};

const setView = (view) => {
  if (view !== '3d' && labelLayer.contains(document.activeElement)) {
    viewButtons.find((button) => button.dataset.view === view)?.focus();
  }
  activeView = view;
  host.hidden = view !== '3d';
  map2d.hidden = view !== '2d';
  listView.hidden = view !== 'list';
  document.querySelector('#gesture-hint').hidden = view !== '3d';
  document.querySelector('#view-caption').textContent = view === '3d' ? 'INTERACTIVE KNOWLEDGE MAP' : view === '2d' ? '2D KNOWLEDGE MAP' : 'KNOWLEDGE LIST';
  viewButtons.forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle('selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (view === '2d') render2d();
  if (view === 'list') renderList();
  if (view === '3d') resizeRenderer();
  status.textContent = `${view === '3d' ? '3D 공간' : view === '2d' ? '2D 맵' : '목록'} 보기로 전환됨.`;
};

const handleCanvasClick = (event) => {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...nodeObjects.values()]);
  const match = hits.find(({ object }) => visibleNodes.has(object.userData.nodeId));
  if (match) selectNode(match.object.userData.nodeId);
};

const setMotionPaused = (paused) => {
  motionPaused = paused;
  if (controls) controls.autoRotate = false;
  document.querySelector('#motion-toggle').setAttribute('aria-pressed', String(paused));
  document.querySelector('#motion-toggle').setAttribute('aria-label', paused ? '중심 궤도 회전 시작' : '중심 궤도 회전 멈춤');
  status.textContent = paused ? '중심 허브 주위의 노드 회전을 멈췄습니다.' : '중심 허브 주위의 노드 회전을 시작했습니다.';
};

const dashboardPeriods = {
  '7d': {
    total: 38,
    labels: ['월', '화', '수', '목', '금', '토', '일'],
    values: [3, 5, 4, 7, 5, 8, 6],
    deltas: { documents: '+2', pending: '변화 없음', running: '변화 없음', failed: '-1' },
  },
  '30d': {
    total: 111,
    labels: ['1주', '2주', '3주', '4주'],
    values: [18, 24, 31, 38],
    deltas: { documents: '+6', pending: '+1', running: '변화 없음', failed: '-2' },
  },
};

let selectedPeriod = '7d';
let comparePeriod = true;

const renderActivityChart = () => {
  const period = dashboardPeriods[selectedPeriod];
  const chart = document.querySelector('#activity-chart');
  const maxValue = Math.max(...period.values);
  chart.classList.toggle('is-month', selectedPeriod === '30d');
  chart.setAttribute('aria-label', `${selectedPeriod === '7d' ? '최근 7일' : '최근 30일'} 샘플 스킬 실행 활동, 총 ${period.total}회`);
  chart.innerHTML = period.values.map((value, index) => `
    <div class="activity-bar-group" aria-hidden="true" title="${period.labels[index]}: ${value}회">
      <div class="activity-bar-track"><span class="activity-bar" style="height:${Math.max(8, (value / maxValue) * 92)}%"></span></div>
      <span class="activity-bar-label">${period.labels[index]}</span>
    </div>
  `).join('');
  document.querySelector('#activity-total').innerHTML = `${selectedPeriod === '7d' ? '최근 7일' : '최근 30일'} <strong>${period.total}</strong>회`;
};

const updateDashboard = () => {
  const period = dashboardPeriods[selectedPeriod];
  document.querySelectorAll('.period-button').forEach((button) => {
    const active = button.dataset.period === selectedPeriod;
    button.classList.toggle('is-selected', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-delta]').forEach((element) => {
    element.textContent = period.deltas[element.dataset.delta];
  });
  document.querySelectorAll('.metric-compare-label').forEach((element) => {
    element.hidden = !comparePeriod;
  });
  document.querySelectorAll('[data-delta]').forEach((element) => {
    element.hidden = !comparePeriod;
  });
  const compareButton = document.querySelector('#compare-period');
  compareButton.setAttribute('aria-pressed', String(comparePeriod));
  compareButton.setAttribute('aria-label', comparePeriod ? '이전 기간 비교 숨기기' : '이전 기간 비교 표시하기');
  compareButton.firstChild.textContent = comparePeriod ? '이전 기간과 비교 ' : '이전 기간 비교 표시 ';
  renderActivityChart();
};

const updateDashboardViewTime = () => {
  const now = new Date();
  const time = document.querySelector('#dashboard-view-time');
  time.dateTime = now.toISOString();
  time.textContent = `화면 확인 시각 ${new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' }).format(now)}`;
};

const showPrototypeNotice = (message) => {
  document.querySelector('#dashboard-status').textContent = message;
};

const setPageFromHash = () => {
  const showDashboard = location.hash !== '#brain';
  dashboardPage.hidden = !showDashboard;
  brainPage.hidden = showDashboard;
  document.querySelector('#breadcrumb-current').textContent = showDashboard ? '대시보드' : '세컨드 브레인';
  document.title = showDashboard ? 'Nomad · 대시보드' : 'Nomad · Second Brain';
  document.querySelectorAll('.primary-nav .nav-item').forEach((link) => {
    const active = (showDashboard && link.hash === '#dashboard') || (!showDashboard && link.hash === '#brain');
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (!showDashboard && renderer) requestAnimationFrame(resizeRenderer);
};

document.querySelectorAll('.period-button').forEach((button) => {
  button.addEventListener('click', () => {
    selectedPeriod = button.dataset.period;
    updateDashboard();
  });
});
document.querySelector('#compare-period').addEventListener('click', () => {
  comparePeriod = !comparePeriod;
  updateDashboard();
});
document.querySelector('#connect-folder').addEventListener('click', () => {
  showPrototypeNotice('폴더 연결은 제품 앱이 아직 구현되지 않아 사용할 수 없습니다. 현재 대시보드는 샘플 데이터만 표시합니다.');
});
document.querySelector('#browse-skills').addEventListener('click', () => {
  showPrototypeNotice('스킬 검색·실행은 제품 앱이 아직 구현되지 않아 사용할 수 없습니다. 아래 실행 목록은 샘플 기록입니다.');
});
document.querySelector('#refresh-dashboard').addEventListener('click', () => {
  updateDashboardViewTime();
  showPrototypeNotice('화면 표시 시각을 갱신했습니다. 샘플 데이터는 새로 불러오지 않았습니다.');
});
window.addEventListener('hashchange', setPageFromHash);
document.querySelectorAll('.view-button').forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelector('#clear-selection').addEventListener('click', clearSelection);
searchInput.addEventListener('input', updateVisibleNodes);
topicFilter.addEventListener('change', updateVisibleNodes);
canvas.addEventListener('click', handleCanvasClick);
document.querySelector('#reset-camera').addEventListener('click', () => {
  if (!camera || !controls) return;
  camera.position.set(0, 0.2, 12.5);
  controls.target.set(0, 0, 0);
  orbitGroup.rotation.set(0, 0, 0);
  controls.update();
});
document.querySelector('#motion-toggle').addEventListener('click', () => setMotionPaused(!motionPaused));
document.querySelector('#fullscreen-toggle').addEventListener('click', async () => {
  const stage = document.querySelector('.graph-stage');
  if (!document.fullscreenElement) await stage.requestFullscreen?.();
  else await document.exitFullscreen?.();
  resizeRenderer();
});
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    searchInput.value = '';
    updateVisibleNodes();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== searchInput && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    event.preventDefault();
    searchInput.focus();
  }
});
reducedMotion.addEventListener('change', (event) => setMotionPaused(event.matches));
new ResizeObserver(resizeRenderer).observe(host);

document.querySelector('#document-count').textContent = String(nodes.length - 1).padStart(2, '0');
document.querySelector('#connection-count').textContent = String(links.length).padStart(2, '0');
document.querySelector('#footer-node-count').textContent = nodes.length;

if (createScene()) {
  animate();
} else {
  setView('2d');
  render2d();
  document.querySelector('#gesture-hint').hidden = true;
  status.textContent = 'WebGL을 사용할 수 없어 2D 그래프로 전환했습니다.';
}

renderList();
updateDashboard();
updateDashboardViewTime();
setPageFromHash();
