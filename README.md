# Nomad-Agents-Lab

NOMAD Agent OS를 적용해 Claude Code 멀티에이전트 개발 환경을 구성하고 검증하는 저장소입니다. 애플리케이션의 제품 요구사항과 기술 스택은 아직 정해지지 않았습니다.

## 시작하기

1. 이 저장소에서 Claude Code를 실행합니다: `claude`
2. `/agents`로 사용 가능한 에이전트를 확인합니다.
3. `/agent-check`로 전역 팀 설치와 프로젝트 설정을 점검합니다.
4. 제품 범위가 정해진 뒤 `/plan <제품명>`으로 기획을 시작합니다.

## 구성

- [`AGENTS.md`](AGENTS.md): 모든 코딩 에이전트가 따르는 프로젝트 지침
- [`CLAUDE.md`](CLAUDE.md): Claude Code용 프로젝트 지침
- [`.claude/`](.claude/): Claude Code 프로젝트 설정과 영역별 규칙
- [`.codex/`](.codex/) · [`.gemini/`](.gemini/): Codex 및 Gemini CLI 프로젝트 설정
- [`tasks/`](tasks/): 작업 목록과 재진입 상태

에이전트 팀 정의와 NOMAD 명령은 전역 Claude 설정에서 제공됩니다. 전역 팀 설치가 없다면 [NOMAD Agent OS 설치 가이드](../nomad-agent-os/docs/INSTALL.md)를 참고하세요.

## 진행 현황 (2026-11-03 기준)

SSR+(Skill · Second Brain · Routine · Extension) 로컬 우선 개인 AI 업무 시스템의 **1차 MVP 기획·설계 문서가 완성**된 상태입니다. 앱 코드는 아직 없습니다.

| 영역 | 현재 상태 |
|---|---|
| 린 검증 | 기준 정의 완료, 검증 전(보류) — `task-002` |
| 기획(PRD) | 1·2·3차 범위, 성공 지표, 보안 L1 정의 |
| UX | 화면 8개 · 흐름 4개 사양, 와이어프레임 생성 (필수 구조 🔴 0) |
| 기술 설계 | 아키텍처 · IPC 17개 · 데이터 모델 13개 · ADR 5건(4건 채택, 스택은 제안) |
| UI 디자인 | 미착수 — `task-006` |
| 구현 | 미착수 — `task-007`부터 |

제한: 스택 버전, Claude Code CLI 권한 연동(T-01~T-03)은 착수 전 검증이 필요합니다. 미결 질문은 [`docs/01_PRD.md#7`](docs/01_PRD.md)에 있습니다.

### 작업 진행률
근거: `tasks/README.md`의 작업 개수(1차 MVP 범위)

| 웨이브 | 내용 | 완료 / 전체 |
|---|---|---|
| 기획 | 문서·사양·작업 분해 | 완료 |
| W0 | 린 검증 · 스택 · 기술 검증 · 보안 · 토큰 | 0 / 5 |
| W1 | 앱 뼈대 · DB | 0 / 2 |
| W2 | 색인 · Second Brain | 0 / 2 |
| W3 | 스킬 · 실행 엔진 · 승인 | 0 / 3 |
| W4 | 기록 · 대시보드 · 설정 | 0 / 2 |
| W5 | QA · 자기 사용 검증 | 0 / 1 |

### 구현된 주요 항목
- [x] NOMAD 멀티에이전트 환경 적용
- [x] 1차 MVP 기획·설계 문서와 화면 사양

### 다음 개발 단계
- [ ] 린 사전 검증(인터뷰 5명) 후 착수 승인 — `task-002`
- [ ] 스택 버전 확정, Claude Code CLI 기술 검증 — `task-003`, `task-004`
- [ ] 수직 슬라이스 구현(폴더 연결 → 검색 → 2D 그래프 → 스킬 실행 → 기록)

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
