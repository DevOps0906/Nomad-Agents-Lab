# NOW — 재진입 스냅샷

- 갱신: 2026-11-20
- 현재 작업: 슬라이스 1 — task-018 완료, 다음 task-019(Markdown 색인) — 브랜치 `w0-preflight`
- 마지막으로 한 일: task-018 첫 실행(env.check·데이터 위치·연결 폴더·경로 검사) 구현, 리뷰(security ACCEPT·code REQUEST_CHANGES) 반영, vitest 143건
- 다음 한 걸음: task-019 착수 전 challenger → builder(opus)
- 열린 결정: 권한 브리지 실행 방식(RunAsNode 없이, task-012) · 실행 기록에 저장되는 파일 내용의 보존·마스킹(PRD Q6, task-015 전) · 첫 실행 기본 데이터 위치는 S-01에서 사용자 지정(현재 동작 유지)
- 주의: `.azure/`는 Copilot 초기 기획 원본 — 수정 금지. README `## 초기 기획 이력` 절 보존. app/dist의 default_app.asar 잠금(EBUSY) — 패키징은 임시 출력 폴더 사용
- SDLC 단계: 06 구현(W1 완료)
- 테스트 상태: app typecheck·lint 통과, vitest 143/143 · spikes/claude-cli 22/22
