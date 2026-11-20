# ADR-0005 데스크톱 스택: Electron + React + TS + Vite + Fluent UI v9 + SQLite FTS5

- 상태: 채택 (2026-11-20 사용자 승인)
- 날짜: 2026-11-03

| 항목 | 내용 |
|---|---|
| 맥락 | 로컬 폴더 읽기·Claude Code CLI 자식 프로세스 실행(ADR-0001)·로컬 검색이 필요하다. 웹 앱은 파일·프로세스 접근이 없고, SSR은 요구가 아니다(`.azure/project-plan.md#4`). |
| 선택 | 셸 Electron · UI React + TypeScript + Vite · 컴포넌트 Fluent UI v9 · 저장 SQLite(FTS5 전문 검색) · 3D 그래프와 2D 대체 렌더러는 기술 검증(task-017) 후 선택. **버전은 모두 착수 시 최신 stable 확인 후 기록.** SQLite 바인딩(네이티브 모듈 여부)도 착수 시 선택. |
| 대안 | Tauri 2 + React: 크기·메모리 이점 가능, Rust 학습과 Node 기반 CLI·MCP 통합 검증 비용 → 배포 크기가 핵심 제약이면 재평가. 웹 앱/PWA: 파일·프로세스 접근 불가로 기각. 로컬 벡터 인덱스: 의미 검색 요구 확인 전까지 보류(ADR-0003). |
| 결과 | 얻는 것: Node에서 `spawn`·fs·MCP 통합이 단순, Windows 우선 배포. 잃는 것: 번들·메모리 큼, Electron 하드닝 책임(`02_ARCHITECTURE.md#2`). 되돌리는 비용: Renderer(React)는 재사용, Main(서비스·어댑터)은 Tauri 이전 시 재작성. |

## 확정 버전 (2026-11-20 npm 조회·사용자 승인, task-003)
| 영역 | 패키지 | 버전 | 라이선스 | 비고 |
|---|---|---|---|---|
| 셸 | electron | 45.4.1 | MIT | 내장 Node 24.22.3 · Chrome 156 |
| UI | react · react-dom | 19.3.1 | MIT | Fluent UI 요구 범위 react <20 충족 |
| 언어 | typescript | 7.0.2 | Apache-2.0 | 린트·도구 호환은 W1(task-007)에서 확인 |
| 번들러 | vite · @vitejs/plugin-react | 8.3.8 · 6.3.0 | MIT | plugin 요구 범위 vite ^8 충족 |
| 컴포넌트 | @fluentui/react-components | 9.75.2 | MIT | |
| 저장 | better-sqlite3 (+ FTS5) | 13.2.0 | MIT | N-API 사전 빌드로 Node·Electron 공용, @electron/rebuild 불필요(미설치) |
| 패키징 | electron-builder | 26.18.0 | MIT | |
- 3D·2D 그래프 렌더러는 task-017 결과로 정한다. 설치는 W1(task-007)에서 하며 lockfile을 커밋한다.

## 개발 도구 (2026-11-20 사용자 승인, W1 challenger 검토 반영)
| 용도 | 패키지 | 버전 | 라이선스 | 비고 |
|---|---|---|---|---|
| 빌드(Main·preload·Renderer) | electron-vite | 6.0.0 | MIT | vite ^8 지원. sandbox preload는 단일 CJS 번들 |
| 테스트 | vitest | 5.1.1 | MIT | better-sqlite3 ABI 분리 주의(task-008) |
| IPC 입력 검증 | zod | 4.6.7 | MIT | |
| 린트 | oxlint | 1.94.0 | MIT | typescript-eslint 8.73.0은 TS <6.1만 지원 → TS 7과 함께 쓰지 않음 |
| 퓨즈 확인 | @electron/fuses | 2.1.3 | MIT | |
| 타입 정의(개발 전용) | @types/react · @types/react-dom | 19.3.0 · 19.3.0 | MIT | 2026-11-20 사용자 승인 |

- npm audit(2026-11-20): moderate 6건 — 모두 electron-builder 하위 `minimatch` DoS(빌드 도구 전용, 앱 런타임 미포함) → 수용, electron-builder 업데이트 시 재확인.
