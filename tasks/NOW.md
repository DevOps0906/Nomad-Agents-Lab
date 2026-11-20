# NOW — 재진입 스냅샷

- 갱신: 2026-11-20
- 현재 작업: W0 선행 검증 진행 — task-004(CLI 검증)·task-006(디자인 토큰)·task-017(3D 성능 측정) 병렬 진행 중
- 마지막으로 한 일: task-003 스택 채택(ADR-0005, 사용자 승인), task-005 보안 L1 완료(nomad-doctor 보안 ✅), task-004 검증 계획을 challenger 지적 반영해 확정
- 다음 한 걸음: W0 세 작업 결과 리뷰 → W0 게이트 판정 → W1(task-007 앱 뼈대·task-008 DB) 착수 전 challenger
- 계획 변경 제안(사용자 동의): W1 다음은 수직 슬라이스 먼저 — 폴더 연결 → 목록 검색 → 스킬 1개 승인 후 실행 → 기록. 작업 표 순서 반영은 W0 게이트 후
- 열린 결정: 제품 실행에서 사용자 settings·hooks 제외 여부(task-004 결과 보고 결정), 그래프 표시 상한(task-017 측정 후)
- 주의: `.azure/`는 Copilot 초기 기획 원본 — 수정하지 않는다. README `## 초기 기획 이력` 절 보존
- SDLC 단계: 05 상세 설계 정합화·W0 선행 검증
- 담당 모델/역할: 팀장(opus) · builder(opus: task-004·017) · designer(haiku: task-006) · challenger
- 수정 파일: `docs/adr/0005-desktop-stack.md`, `AGENTS.md#1·2`, `docs/01_PRD.md#8`(보안 레벨 표기), `SECURITY.md`, `.github/dependabot.yml`, `tasks/**`
- 테스트 상태: nomad-doctor ❌ 0 · ⚠️ 1(상시 로드 규칙 토큰 초과, 보안 무관)
- 남은 작업: task-002 인터뷰는 개인 알파 후, 외부 사용자 확대 전에 진행
