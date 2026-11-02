# task-003 스택 버전 확정·ADR-0005 채택

| 항목 | 내용 |
|---|---|
| 웨이브 | W0 |
| 선행 | — |
| 위험도 | 높음 |
| 보안 영향 | 의존성 |
| 담당 | 팀장 + builder |
| 근거 | `docs/adr/0005-desktop-stack.md`, `docs/01_PRD.md#7` Q1 |
| 쓰기 허용 | `docs/adr/0005-*.md`, `AGENTS.md#2` |

## 할 것
- Electron·React·TypeScript·Vite·Fluent UI v9·SQLite 드라이버 최신 stable 확인 후 버전 기입
- 라이선스·유지보수 상태 확인(`security-baseline`)
- AGENTS.md 기술 상태 표 갱신

## 하지 않을 것
- 의존성 설치

## 완료 조건 (실행 가능한 확인)
- [ ] ADR-0005 상태 `채택` + 버전 표
- [ ] 스택 선택과 버전 표를 사용자에게 제시하고 승인 기록
