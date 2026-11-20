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
- [x] 검증 결과 표를 `docs/02_ARCHITECTURE.md#3`에 반영(통과/대체안)
- [x] CLI가 설정된 원격 AI 서비스와 통신할 수 있다는 사실과 동의 화면에서 표시 가능한 서비스 정보를 기록
- [x] 재현 스크립트 실행 로그 `.nomad/logs/`

## 검증 계획 (2026-11-20, challenger 지적 반영 — 팀장 확정)
1. **격리**: 저장소 밖 임시 빈 폴더를 cwd로 쓴다. `DISABLE_AUTOUPDATER=1`로 CLI 2.1.323 고정. `CLAUDE_CONFIG_DIR` 격리·로그인 정보 복사 금지. `login`·`logout` 등 상태를 바꾸는 명령 금지. 사용자 범위 MCP·설정 파일 수정 금지.
2. **설정 출처 두 조건 측정**: (A) `--setting-sources ""`로 사용자·프로젝트 설정을 끈 상태 (B) 기본값(사용자 settings·hooks 로드). B에서 사용자 allow 규칙이나 defaultMode가 브리지보다 먼저 판정하는지 기록한다. 제품에서 설정을 뺄지는 결과를 보고 사람이 정한다.
3. **T-01 브리지**: MCP SDK 없이 손으로 쓴 JSON-RPC stdio 서버(Node, 새 의존성 0)를 둔다. 앱 Main 대역과의 채널은 무작위 이름 named pipe + `--mcp-config` env 토큰으로 인증한다. 판정은 모델의 답 텍스트가 아니라 **브리지 요청·응답 로그(1:1)와 파일 시스템 결과**로 한다. 확인할 경우: ① deny → 파일 없음 ② allow → 파일 생성 ③ 출력 폴더 밖 경로 거부(`..`·대소문자·`/`와 `\`·junction·8.3 이름 정규화) ④ `updatedInput`으로 경로 변경 가능 여부 ⑤ cwd·`--add-dir` 안의 Write도 브리지를 거치는지 ⑥ 응답을 90초 늦췄을 때 CLI가 시간 초과로 끊는지(Q19) ⑦ Task·Agent·Skill·NotebookEdit 등 차단 목록 밖 도구가 브리지를 거치는지 — 결과에 따라 허용 목록(`--tools`/`--allowedTools`) 방식으로 바꿀지 권고한다.
4. **T-03 차단 증명**: 격리 cwd의 `.mcp.json`에 실행되면 표식 파일을 쓰는 카나리아 서버를 둔다. stream-json `system/init`의 mcp_servers·tools에 브리지만 있는지 단언한다. claude.ai 원격 커넥터·plugin MCP도 빠지는지 따로 확인한다. T-01 실행의 init 이벤트로 함께 판정해 실행 수를 줄인다.
5. **T-02**: 원격 호출이 없는 확인 방법을 우선한다. 출력에 담긴 계정 식별자는 로그에 쓰기 전에 마스킹한다.
6. **비용**: 인자 검증(`--verbose` 필요 여부 등)은 원격 호출 없이 먼저 한다. `--model haiku`, `--max-turns` 최소. 원격 실행 상한 15회, 같은 경우의 재시도는 1회.
7. **최소 버전**: 검증한 버전 2.1.323을 지원 하한으로 기록한다. "동의와 CLI 구성 충돌" 항목은 init 이벤트에서 동의 화면에 표시할 수 있는 정보(모델·인증 출처 종류·원격 서비스)를 표로 남기는 것으로 판정한다.
8. **로그**: `.nomad/logs/task-004/`에 저장하고 계정 이메일·조직 ID는 마스킹한다.

## 결과 (2026-11-20 완료)
- 사용자 결정: 도구 허용 목록 `--tools Read,Grep,Glob,Write,Edit` · 설정 출처 A(`--setting-sources ""`) · 권한 무응답 5분 후 거부 확정.
- 리뷰: challenger REVISE → 계획 반영, codex-reviewer(code)·reviewer(security) REQUEST_CHANGES → 반영 완료. `node --test spikes/claude-cli/` 22건 통과(팀장 재실행 확인), 원격 누적 11회, 로그 이메일 0건.
- task-012로 넘기는 것: pipe DACL·원격 클라이언트 거부(Node `net` 불가 → 네이티브/Electron 측 구현 결정), 권한 요청 다중화(동시 연결 1 제한 해소), Grep 경로 `..` 앱 측 정규화, 대상 없는 파일 심볼릭 링크 판정(이 PC에서 생성 권한 없어 미확인), 로그아웃 상태 출력(logout 금지로 미확인).
- 주의: `--no-session-persistence`여도 CLI가 `~/.claude/projects/`에 세션 폴더를 만든다 → 제품 실행 시 정리 정책 필요(task-012).
