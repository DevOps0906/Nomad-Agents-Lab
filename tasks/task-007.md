# task-007 Electron 앱 뼈대·보안 하드닝

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-003, task-004 |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 |
| 담당 | builder |
| 근거 | `docs/02_ARCHITECTURE.md#1·2`, `docs/04_API.md#공통 규칙` |
| 쓰기 허용 | `app/**` (경로는 ADR-0005 채택 시 확정) |

## 할 것
- contextIsolation·sandbox·nodeIntegration 끔·CSP
- Preload IPC 허용 목록(A-01~A-17만), 입력 스키마 검증 골격
- 앱 셸·좌측 내비

## 하지 않을 것
- 기능 구현

## 완료 조건 (실행 가능한 확인)
- [ ] typecheck·lint 통과
- [ ] 허용 목록 밖 IPC 호출 거부 테스트 통과
