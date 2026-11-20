# NOW — 재진입 스냅샷

- 갱신: 2026-11-20
- 현재 작업: W1 완료(task-007·008). 다음은 수직 슬라이스 작업 순서 재편 — 브랜치 `w0-preflight`
- 마지막으로 한 일: task-008 SQLite 스키마(0001_init.sql, trigram FTS5)·전진 전용 마이그레이션·boot_config·진입점 연결, 리뷰(code REQUEST_CHANGES·contract ACCEPT) 반영
- 다음 한 걸음: 수직 슬라이스(폴더 연결 → 목록 검색 → 스킬 1개 승인 실행 → 기록) 순서로 tasks/README.md 재편 후 사용자 확인 → 첫 슬라이스 작업 착수 전 challenger
- 열린 결정: 권한 브리지 실행 방식(RunAsNode 없이, task-012) · 실행 기록에 저장되는 파일 내용의 보존·마스킹(PRD Q6, task-015 전) · 첫 실행 기본 데이터 위치는 S-01에서 사용자 지정(현재 동작 유지)
- 주의: `.azure/`는 Copilot 초기 기획 원본 — 수정 금지. README `## 초기 기획 이력` 절 보존. app/dist의 default_app.asar 잠금(EBUSY) — 패키징은 임시 출력 폴더 사용
- SDLC 단계: 06 구현(W1 완료)
- 테스트 상태: app typecheck·lint 통과, vitest 75/75 · spikes/claude-cli 22/22
