# NOW — 재진입 스냅샷

- 갱신: 2026-11-20
- 현재 작업: W0 마무리(task-017 리뷰 반영 중) + W1 task-007 앱 뼈대 착수(builder opus) — 브랜치 `w0-preflight`
- 마지막으로 한 일: task-003·004·005·006 완료, 커밋 bc8b281 푸시. task-017 결정(단일 버퍼 렌더링·상한 2,000/3,000 확정·알파 재측정). W1 challenger REVISE 반영(task-007·008 "계획 보완"), 개발 도구·trigram 승인
- 다음 한 걸음: task-017 완료 확인 → PRD Q11(trigram) 기록 → task-007 리뷰(codex-reviewer code + reviewer security) → task-008 착수
- 계획 변경(사용자 동의): W1 다음은 수직 슬라이스 먼저(폴더 연결 → 목록 검색 → 스킬 1개 승인 실행 → 기록). 작업 표 순서 반영은 W1 후
- 열린 결정: 권한 브리지 실행 방식(RunAsNode 없이, task-012)
- 주의: `.azure/`는 Copilot 초기 기획 원본 — 수정 금지. README `## 초기 기획 이력` 절 보존. PRD는 task-017 builder가 수정 중이라 Q11은 그 뒤에 기록
- SDLC 단계: W0 게이트 → 06 구현(W1)
- 담당: 팀장(opus) · builder(opus: task-007, task-017)
- 테스트 상태: spikes/claude-cli node --test 22/22, nomad-doctor ❌0
