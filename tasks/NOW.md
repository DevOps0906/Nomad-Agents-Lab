# NOW — 재진입 스냅샷

- 갱신: 2026-11-20
- 현재 작업: 슬라이스 1 — task-018·019·020·011 완료, 다음 task-012(실행 엔진·권한 브리지, 높음) — 브랜치 `w0-preflight`
- 마지막으로 한 일: task-011 스킬 목록·상세(yaml 2.9.1) 구현, 리뷰(code REQUEST_CHANGES·design ACCEPT) 반영, vitest 228건. 사용 가이드 대화로 제공
- 다음 한 걸음: task-012 2단계(앱 구현) builder(opus) → codex-reviewer(code) + reviewer(security·contract)
- 열린 결정: 권한 브리지 실행 방식(RunAsNode 없이, task-012) · 실행 기록에 저장되는 파일 내용의 보존·마스킹(PRD Q6, task-015 전) · 첫 실행 기본 데이터 위치는 S-01에서 사용자 지정(현재 동작 유지)
- 주의: `.azure/`는 Copilot 초기 기획 원본 — 수정 금지. README `## 초기 기획 이력` 절 보존. app/dist의 default_app.asar 잠금(EBUSY) — 패키징은 임시 출력 폴더 사용
- SDLC 단계: 06 구현(W1 완료)
- 테스트 상태: app typecheck·lint 통과, vitest 228/228
