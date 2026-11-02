# task-012 Claude Code 어댑터·실행 관리자·권한 브리지

| 항목 | 내용 |
|---|---|
| 웨이브 | W3 |
| 선행 | task-004, task-008 |
| 위험도 | 높음 |
| 보안 영향 | 키·권한 |
| 담당 | builder (착수 전 challenger) |
| 근거 | `docs/02_ARCHITECTURE.md#3`, `docs/04_API.md` A-09~A-11·A-13, `docs/diagrams/seq-skill-run.mmd` |
| 쓰기 허용 | `app/src/main/runner/**` |

## 할 것
- `claude -p` 자식 프로세스, `--add-dir`·`--allowedTools`·`--disallowedTools`·`--strict-mcp-config`·`--max-turns`
- stream-json → `run_events`, 권한 브리지(1회용 requestId, 시간 초과 거부)
- 취소·재시도(새 run)

## 하지 않을 것
- Bash·WebFetch·WebSearch 허용

## 완료 조건 (실행 가능한 확인)
- [ ] 가짜 CLI로 이벤트·권한·취소 테스트 통과
- [ ] P5: 범위 밖 접근 0건 검사 스크립트 통과
