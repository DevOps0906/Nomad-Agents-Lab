# task-004 기술 검증 T-01~T-03 (Claude Code CLI)

| 항목 | 내용 |
|---|---|
| 웨이브 | W0 |
| 선행 | — |
| 위험도 | 높음 |
| 보안 영향 | 키·권한 |
| 담당 | builder (착수 전 challenger) |
| 근거 | `docs/02_ARCHITECTURE.md#3`, `docs/01_PRD.md#7` Q2·Q17·Q18 |
| 쓰기 허용 | `spikes/claude-cli/**` |

## 할 것
- T-01 `--permission-prompt-tool` 권한 브리지 왕복, Write·Edit 출력 폴더 강제 방법
- T-02 로그인 상태 확인 방법
- T-03 `--strict-mcp-config`로 사용자 MCP 차단
- stream-json 형식·`--verbose` 필요 여부, 지원 CLI 최소 버전
- 설정된 AI 서비스로의 원격 처리 고지·실행별 동의가 CLI 구성과 충돌하지 않는지 확인

## 하지 않을 것
- 제품 코드에 섞기(spike 폴더만)

## 완료 조건 (실행 가능한 확인)
- [ ] 검증 결과 표를 `docs/02_ARCHITECTURE.md#3`에 반영(통과/대체안)
- [ ] CLI가 설정된 원격 AI 서비스와 통신할 수 있다는 사실과 동의 화면에서 표시 가능한 서비스 정보를 기록
- [ ] 재현 스크립트 실행 로그 `.nomad/logs/`
