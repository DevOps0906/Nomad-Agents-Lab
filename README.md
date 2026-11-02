# Nomad-Agents-Lab

NOMAD Agent OS를 적용한 SSR+ 로컬 우선 개인 AI 업무 시스템의 기획·설계 및 개발 저장소입니다. 제품 범위는 승인됐으며, W0 기술·보안·디자인 선행 검증 후 앱 구현에 들어갑니다.

## 시작하기

1. 이 저장소에서 Claude Code를 실행합니다: `claude`
2. `/agents`로 사용 가능한 에이전트를 확인합니다.
3. `/agent-check`로 전역 팀 설치와 프로젝트 설정을 점검합니다.
4. 현재 범위·선행조건은 [`docs/adr/0006-balanced-mvp-scope.md`](docs/adr/0006-balanced-mvp-scope.md)와 [`tasks/NOW.md`](tasks/NOW.md)를 확인합니다.

## 구성

- [`AGENTS.md`](AGENTS.md): 모든 코딩 에이전트가 따르는 프로젝트 지침
- [`CLAUDE.md`](CLAUDE.md): Claude Code용 프로젝트 지침
- [`.claude/`](.claude/): Claude Code 프로젝트 설정과 영역별 규칙
- [`.codex/`](.codex/) · [`.gemini/`](.gemini/): Codex 및 Gemini CLI 프로젝트 설정
- [`tasks/`](tasks/): 작업 목록과 재진입 상태

에이전트 팀 정의와 NOMAD 명령은 전역 Claude 설정에서 제공됩니다. 전역 팀 설치가 없다면 [NOMAD Agent OS 설치 가이드](../nomad-agent-os/docs/INSTALL.md)를 참고하세요.

## 진행 현황 (2026-11-03 기준)

SSR+(Skill · Second Brain · Routine · Extension) 개인 AI 업무 시스템의 **균형 MVP 기획·설계가 승인**됐습니다. 앱 코드는 아직 없으며, 개인 알파를 먼저 구현한 뒤 외부 사용자 확대 전에 인터뷰합니다.

| 영역 | 현재 상태 |
|---|---|
| 린 검증 | 본인 알파 착수 승인, P1~P3·P5는 구현 후 측정, P4는 외부 확대 전 — `task-002`, `task-016` |
| 기획(PRD) | MVP 수직 흐름과 후속 범위, 성공 지표, 보안 L1 정의 — `docs/01_PRD.md` |
| UX | 화면 8개 · 흐름 4개, Second Brain 3D와 2D·목록 대체 경로 — `docs/03_SCREENS_UX.md` |
| 기술 설계 | 아키텍처 · IPC 17개 · 데이터 모델 13개 · ADR 6건(범위 ADR-0006, 스택 미확정) |
| W0 선행 검증 | 진행 중 — Three.js 샘플 그래프 프로토타입 구현 중 (`task-017`), 나머지 스택·CLI·보안·디자인 검증 대기 |
| 구현 | 제품 앱은 미착수 — 대시보드·Second Brain 화면 프로토타입(샘플 전용)을 [`spikes/brain-graph/`](spikes/brain-graph/)에서 검증 중 |

제한: 앱 구현 전 W0의 스택·CLI 권한(T-01~T-03)·보안·디자인·3D 성능 확인이 필요합니다. 미결 질문은 [`docs/01_PRD.md#7`](docs/01_PRD.md)에 있습니다.

### 작업 진행률
근거: `tasks/README.md`의 작업 개수(1차 MVP 범위)

| 웨이브 | 내용 | 완료 / 전체 |
|---|---|---|
| 기획 | 문서·사양·작업 분해 | 완료 |
| W0 | 스택 · CLI · 보안 · 디자인 · 3D 기술 검증 | 0 / 5 |
| W1 | 앱 뼈대 · DB | 0 / 2 |
| W2 | 색인 · Second Brain | 0 / 2 |
| W3 | 스킬 · 실행 엔진 · 승인 | 0 / 3 |
| W4 | 기록 · 대시보드 · 설정 | 0 / 2 |
| W5 | QA · 본인 7일 알파 | 0 / 1 |
| W6 | 외부 사용자 인터뷰(P4) | 0 / 1 |

### 구현된 주요 항목
- [x] NOMAD 멀티에이전트 환경 적용
- [x] 1차 MVP 기획·설계 문서와 화면 사양
- [ ] 대시보드 UI 프로토타입 — 샘플 데이터 전용, 제품 데이터·실행 기록 미연동
- [ ] Second Brain Three.js 스파이크 검증 — [`spikes/brain-graph/`](spikes/brain-graph/)

### 다음 개발 단계
- [ ] 스택·CLI·보안·디자인·3D 성능 선행 검증 — `task-003~006`, `task-017`
- [ ] 수직 슬라이스 구현(폴더 연결 → 검색 → 3D/2D/목록 탐색 → 매 실행 동의 후 Skill 실행 → 기록)

## 콘텐츠 바로가기

| 콘텐츠 | 화면 경로 | 기획·명세 문서 | 구현 코드 |
|---|---|---|---|
| 린 검증 | — | [`docs/00_LEAN.md`](docs/00_LEAN.md) | — |
| 제품 요구사항 | — | [`docs/01_PRD.md`](docs/01_PRD.md) | — |
| 아키텍처 | — | [`docs/02_ARCHITECTURE.md`](docs/02_ARCHITECTURE.md) · [구조도](docs/diagrams/architecture.mmd) | — |
| 화면·흐름 | /onboarding · / · /brain · /skills · /runs · /settings | [`docs/03_SCREENS_UX.md`](docs/03_SCREENS_UX.md) · [와이어프레임](design/wireframes/index.html) · [화면 구조도](docs/diagrams/sitemap.mmd) | — |
| IPC 명세 | — | [`docs/04_API.md`](docs/04_API.md) | — |
| 데이터 모델 | — | [`docs/05_DATA_MODEL.md`](docs/05_DATA_MODEL.md) | — |
| 핵심 결정 | — | [`docs/adr/`](docs/adr/) | — |
| 기획 구조도 | — | [`docs/diagrams/plan-overview.mmd`](docs/diagrams/plan-overview.mmd) | — |
| 벤치마크 | — | [`docs/benchmark.md`](docs/benchmark.md) | — |
| 작업 분해 | — | [`tasks/README.md`](tasks/README.md) | — |

## 초기 기획 이력

<!-- 보존 항목: 이 절은 README를 갱신해도 삭제·수정하지 않는다. -->
- 이 프로젝트의 **초기 MVP는 GitHub Copilot으로 기획**했습니다. 기획 산출물: [`.azure/project-plan.md`](.azure/project-plan.md), [`.azure/requirements.json`](.azure/requirements.json)
