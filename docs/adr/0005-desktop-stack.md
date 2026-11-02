# ADR-0005 데스크톱 스택: Electron + React + TS + Vite + Fluent UI v9 + SQLite FTS5

- 상태: 제안
- 날짜: 2026-11-03

| 항목 | 내용 |
|---|---|
| 맥락 | 로컬 폴더 읽기·Claude Code CLI 자식 프로세스 실행(ADR-0001)·로컬 검색이 필요하다. 웹 앱은 파일·프로세스 접근이 없고, SSR은 요구가 아니다(`.azure/project-plan.md#4`). |
| 선택 | 셸 Electron · UI React + TypeScript + Vite · 컴포넌트 Fluent UI v9 · 저장 SQLite(FTS5 전문 검색) · 2D 그래프 라이브러리는 기술 검증 후 선택. **버전은 모두 착수 시 최신 stable 확인 후 기록.** SQLite 바인딩(네이티브 모듈 여부)도 착수 시 선택. |
| 대안 | Tauri 2 + React: 크기·메모리 이점 가능, Rust 학습과 Node 기반 CLI·MCP 통합 검증 비용 → 배포 크기가 핵심 제약이면 재평가. 웹 앱/PWA: 파일·프로세스 접근 불가로 기각. 로컬 벡터 인덱스: 의미 검색 요구 확인 전까지 보류(ADR-0003). |
| 결과 | 얻는 것: Node에서 `spawn`·fs·MCP 통합이 단순, Windows 우선 배포. 잃는 것: 번들·메모리 큼, Electron 하드닝 책임(`02_ARCHITECTURE.md#2`). 되돌리는 비용: Renderer(React)는 재사용, Main(서비스·어댑터)은 Tauri 이전 시 재작성. |
