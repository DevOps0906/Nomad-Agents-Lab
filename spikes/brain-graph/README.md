# Second Brain 3D 프로토타입

대시보드와 Second Brain을 포함한 독립 실행형 화면 프로토타입입니다. 실제 사용자 자료나 네트워크 API는 사용하지 않으며, 한국어 샘플 지표·기록과 18개 샘플 자료, 중앙 허브를 포함한 19개 그래프 노드만 사용합니다.

## 실행

```powershell
npm install
npm run dev
```

터미널에 표시되는 로컬 URL을 브라우저에서 엽니다. 기본 경로는 대시보드이며, 사이드바에서 Second Brain으로 이동할 수 있습니다. 배포용 정적 빌드 확인:

```powershell
npm run build
```

## 구현된 상호작용

- `/` 또는 `/#dashboard`의 대시보드: 색인·실행 요약, 7일/30일 활동 전환, 이전 기간 비교 토글, 샘플 실행·자료 목록
- `/#brain`의 Second Brain 3D 그래프 및 2D·목록 대체 경로
- 중앙 particle-sphere 허브 `세컨드 브레인`과 주위를 도는 18개 샘플 자료 노드, 허브 중심 라벨 및 2D 중심 허브
- 스마트폰·태블릿 화면 높이에 맞춘 무문서 스크롤 레이아웃과 작은 화면의 노드 상세 오버레이
- Fibonacci 구형 점 배치의 particle-sphere 문서 노드와 스프링·반발력 기반 force-directed 3D 레이아웃
- Three.js `OrbitControls`의 damping/inertia, 회전·줌, 카메라 초기화
- 노드별 staggered intro, 점진적 등장과 선택·연결 강조
- `Raycaster` 포인트 선택과 관계 노드 하이라이트
- `Vector3.project(camera)`로 위치를 계산하는 키보드 접근 가능한 HTML 라벨 오버레이
- 검색·주제 필터, 같은 자료를 표시하는 2D 맵과 키보드 조작 가능한 목록
- WebGL 생성 실패 시 2D 보기로 전환, `prefers-reduced-motion`과 수동 동작 감소 설정 지원
- 반응형 상세 패널과 샘플 자료 전용 고지

## 범위

이 디렉터리는 승인된 화면을 빠르게 확인하기 위한 독립 UI 프로토타입이며, 그래프는 ADR-0006의 실제 구현 전 성능·조작성 검증용 스파이크입니다. 대시보드와 그래프 모두 샘플 데이터만 사용합니다. Electron 앱 통합, 로컬 자료 인덱싱, Claude Code 연결, 실제 실행 기록과 문서 미리보기는 포함하지 않습니다. 그래프 표시 상한은 대상 기기에서 벤치마크한 뒤 결정해야 합니다.
