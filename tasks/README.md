# 작업 표

| 번호 | 제목 | 웨이브 | 슬라이스 | 선행 | 위험도 | 담당 | 상태 |
|---|---|---|---|---|---|---|---|
| task-001 | NOMAD 멀티에이전트 환경 적용 | W1 | — | — | 낮음 | builder | 완료 |
| task-003 | 스택 버전 확정·ADR-0005 채택 | W0 | — | — | 높음 | 팀장 | 완료 |
| task-004 | 기술 검증 T-01~T-03 (Claude Code CLI) | W0 | — | — | 높음 | builder | 완료 |
| task-005 | 보안 기본 설정(L1) | W0 | — | — | 낮음 | builder | 완료 |
| task-006 | 디자인 토큰·DESIGN.md (데스크톱 우선) | W0 | — | task-003 | 낮음 | designer | 완료 |
| task-017 | Second Brain 3D 성능 스파이크·상한 확정 | W0 | — | task-003 | 높음 | builder + designer | 완료 |
| task-007 | Electron 앱 뼈대·보안 하드닝 | W1 | — | task-003, task-004, task-005, task-006 | 높음 | builder | 완료 |
| task-008 | SQLite 스키마·마이그레이션·boot_config | W1 | — | task-007 | 높음 | builder | 완료 |
| task-018 | 첫 실행 최소 (S-01: A-01·데이터 위치·폴더 1개 A-02) | W2 | 1 | task-008 | 높음 | builder (착수 전 challenger) | 완료 |
| task-019 | Markdown 색인 (A-03 일부, PDF 제외) | W2 | 1 | task-018 | 높음 | builder | 완료 |
| task-020 | 목록 검색 화면 (S-03 목록 경로, A-04·A-06) | W2 | 1 | task-019 | 보통 | builder | 완료 |
| task-011 | 스킬 색인·목록 (S-04, A-07·A-08) | W3 | 1 | task-008, task-020 | 보통 | builder | 완료 |
| task-012 | Claude Code 어댑터·실행 관리자·권한 브리지 | W3 | 1 | task-004, task-008, task-018 | 높음 | builder (착수 전 challenger) | 진행 |
| task-013 | 실행 승인·외부 처리 동의·실행 상세 (S-05·S-07, A-14 저장 측) | W3 | 1 | task-011, task-012, task-019 | 높음 | builder | 대기 |
| task-021 | 실행 기록 목록·상세 (S-06·S-07 기록 부분, A-12·A-13) | W3 | 1 | task-013 | 보통 | builder | 대기 |
| task-009 | 색인 보강: PDF 등 (A-03 잔여) | W2 | 2 | task-019 | 높음 | builder | 대기 |
| task-010 | Second Brain 보강: 3D·2D 그래프·수동 링크 (S-03 잔여, A-05·A-16) | W2 | 2 | task-020, task-009, task-006, task-017 | 높음 | builder | 대기 |
| task-014 | 대시보드 (S-02, A-15) · 실행 기록 잔여 | W4 | 2 | task-021 | 보통 | builder | 대기 |
| task-015 | 설정 (S-08 전체, A-14·A-17) · 첫 실행 잔여 | W4 | 2 | task-013, task-021, PRD Q6 결정 | 높음 | builder | 대기 |
| task-016 | 1차 QA·자기 사용 검증(P1~P3·P5) | W5 | — | task-010, task-014, task-015 | 보통 | tester | 대기 |
| task-002 | 알파 후 외부 사용자 인터뷰(P4) | W6 | — | task-016 | 낮음 | 팀장 | 대기(외부 사용자 확대 전) |

상태: 대기 / 진행 / 완료 / 보류

- 웨이브: W0 기술·보안·디자인·3D 검증 → W1 기반 → W2 자료·Second Brain → W3 스킬 실행 → W4 기록·설정 → W5 QA·본인 알파 → W6 외부 인터뷰. 1차 MVP 범위는 `docs/adr/0006`.
- 슬라이스: 1 = 수직 슬라이스(폴더 연결 → 목록 검색 → 스킬 1개 승인 실행 → 기록), 표의 착수 순서대로 진행(018→019→020→011→012→013→021). 2 = 보강(PDF·3D·2D 그래프·대시보드·설정 전체). 승인 2026-11-20. 슬라이스 2는 슬라이스 1 완료 후, 이후 task-016·task-002.
- 린 게이트: 사용자 승인으로 본인 알파 개발 착수. P1~P3·P5는 task-016에서 판정하며, P4 인터뷰(task-002)는 외부 사용자 확대 전 수행한다.
- 수익·검증 한 줄: 1차는 본인용 무료 도구로 7일 자기 사용 후 평가, 외부 사용자 확대 전 인터뷰 5명. 수익 모델은 PRD Q9에서 결정.

## 발견한 문제 (범위 밖 — 나중 작업 후보)
| 날짜 | 위치 | 내용 | 제안 |
|---|---|---|---|
| 2026-11-20 | app/src/main/brain/service.ts | 검색 OFFSET 페이지는 색인 중 쪽 사이 순서가 바뀔 수 있음(중복은 화면에서 제거) | 키셋 페이지(bm25·id 커서)로 전환 |
| 2026-11-20 | app/src/main/boot/start.ts | 데이터 위치 unverified 경고가 시스템 드라이브 밖 로컬 디스크(D: 등)에도 뜸 | fsutil fsinfo drivetype 등으로 고정 디스크 판별 후 경고 제외 |
| 2026-11-20 | docs/diagrams/erd.mmd | sources.path NOCASE 표기를 수동 추가 — sql2erd 재생성 시 사라짐 | sql2erd가 COLLATE를 표기하게 하거나 재생성 후 재적용 |
| 2026-11-20 | app/electron-builder.yml | 서명 없는 exe에서는 asar 무결성 검증을 퓨즈+asar 동시 교체로 우회 가능 | 배포 작업에서 코드 서명과 함께 처리 |
| 2026-11-20 | app/src/main/index.ts | 권한 차단 핸들러가 defaultSession에만 걸림 | 새 partition 세션 도입 시 같은 잠금 적용 |
| 2026-11-20 | app/src/main/security.ts | app:// 핸들러는 번들 안 심볼릭 링크 대상을 검사하지 않음(현재 링크 없음) | 번들에 링크가 생기면 realpath 검사 추가 |

## 교훈 (다음 작업에 그대로 적용할 것만, 20줄 이내 유지)
- 제품 스택이나 범위가 정해지기 전에는 템플릿의 예시 기술을 실제 선택처럼 기록하지 않는다.
