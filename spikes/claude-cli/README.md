# spikes/claude-cli — task-004 기술 검증 T-01~T-03

Claude Code CLI 2.1.323(Windows 11, Node 26.13.1)으로 권한 브리지·출력 폴더 강제·MCP 차단·로그인 확인을 재현한다.
제품 코드가 아니다. 새 npm 의존성 없음(Node 내장 모듈만). 결과 표는 `docs/02_ARCHITECTURE.md#3`.

## 파일
| 파일 | 역할 |
|---|---|
| `host.mjs` | 앱 Main 대역. `%TEMP%` 격리 폴더 생성 → 무작위 이름 named pipe + 토큰 → `claude -p` 실행 → 브리지 질의에 시나리오 정책으로 응답 → 로그 기록 후 격리 폴더 삭제 |
| `bridge.mjs` | `--permission-prompt-tool`로 등록하는 MCP stdio 서버(손으로 쓴 JSON-RPC). 질의를 pipe로 host에 넘기고 결정을 돌려준다. 요청별 타이머(`BRIDGE_TIMEOUT_MS`, 기본 5분)·응답 스키마 검증, 모든 이상은 거부 |
| `bridge.test.mjs` | 브리지 fail-closed 단위 검증(이상 응답·무응답·null·파싱 실패·연결 불가) |
| `pathguard.mjs` | 출력 폴더 강제: `..`·`/`·대소문자 정규화 + `realpathSync.native`로 junction·8.3 이름 해소, 대상 없는 링크·UNC·장치 경로·ADS 거부 |
| `pathguard.test.mjs` | 위 판정 단위 검증(원격 호출 없음) |
| `verbose-check.mjs` | stream-json의 `--verbose` 필수 여부(원격 모델 호출 없음) |
| `remask-logs.mjs` | 기존 로그에 홈 경로·사용자명·이메일·조직 ID 마스킹 재적용 |
| `canary.mjs` | T-03 카나리아. 격리 cwd의 `.mcp.json`에 등록되어, 실행되면 표식 파일을 쓴다 |
| `t02-auth.mjs` | T-02 `claude auth status --json`(프록시를 닿지 않는 주소로 두고 실행, 계정 식별자 마스킹) |

## 실행법 (저장소 루트에서)
```sh
node --test spikes/claude-cli/                      # 단위 검증 전부, 원격 없음
node spikes/claude-cli/t02-auth.mjs                 # 원격 없음
node spikes/claude-cli/verbose-check.mjs            # 원격 모델 호출 없음
node spikes/claude-cli/host.mjs init A              # 원격 없음(ANTHROPIC_BASE_URL을 닿지 않는 주소로) — init 이벤트만
node spikes/claude-cli/host.mjs control B           # 원격 모델 없음, --strict-mcp-config 뺀 대조군(카나리아가 떠야 정상)
node spikes/claude-cli/host.mjs <deny|allow|rewrite|paths|delay|tools> <A|B>   # 원격 1회씩
node spikes/claude-cli/host.mjs read A              # 읽기 도구 경계(가짜 비밀 + junction), 원격 1회
BRIDGE_TIMEOUT_MS=10000 node spikes/claude-cli/host.mjs timeout A   # host 무응답 → 브리지 타이머 deny, 원격 1회
HOST_TOOLS=blocklist node spikes/claude-cli/host.mjs tools A        # 예전 차단 목록 방식 재현
```
- 도구는 기본이 허용 목록 `--tools Read,Grep,Glob,Write,Edit`(사용자 결정 2026-11-20). `HOST_TOOLS`로 바꿀 수 있다.
- 토큰은 argv가 아니라 격리 폴더의 `--mcp-config` 파일로 넘기고 실행 후 폴더째 지운다. pipe는 동시 연결 1·요청 1 MiB 상한, 토큰은 `timingSafeEqual`로 비교.
- 조건 A = `--setting-sources ""`(사용자·프로젝트 설정 끔), B = 기본값(사용자 settings·hooks·plugins 로드).
- 공통 인자: `-p --output-format stream-json --verbose --model haiku --max-turns N --no-session-persistence --strict-mcp-config --mcp-config <브리지만 등록한 파일> --permission-prompt-tool mcp__ssrbridge__permission_prompt --tools Read,Grep,Glob,Write,Edit --add-dir <extra>`. 1~9회차 원격 실행은 당시 기본이던 `--disallowedTools Bash WebFetch WebSearch`로 했다(로그 `argv` 참조).
- `DISABLE_AUTOUPDATER=1`, 부모 세션의 `CLAUDE*` 환경변수는 지운다. `CLAUDE_CONFIG_DIR`은 건드리지 않는다.
- CLI 위치는 `CLAUDE_BIN`으로 바꿀 수 있다(기본: npm 전역 `claude.exe`).
- 원격 실행은 `.nomad/logs/task-004/remote-slots/<n>` 슬롯 파일을 `wx`로 원자적으로 잡아야 시작하고(15개), `remote-count.log`에 한 줄씩 남는다.

## 로그
`.nomad/logs/task-004/<시나리오>-<조건>.summary.json`(브리지 요청·응답 1:1, 도구 호출, 파일 시스템 결과, init 요약)과 `.stream.jsonl`(CLI 출력 원문, 이메일·조직 ID 마스킹).

## task-012 1단계 — 로컬 HTTP MCP 브리지 재검증
named pipe + stdio 브리지 대신 앱 Main 안의 HTTP MCP 서버 하나로 권한 질의를 받는다(사용자 결정). 결과 표는 `docs/02_ARCHITECTURE.md` §3.1 "task-012 HTTP 브리지".

| 파일 | 역할 |
|---|---|
| `http-host.mjs` | `startBridgeServer({decide, timeoutMs, maxBody, log})`. `node:http`만으로 MCP Streamable HTTP 최소 구현(`initialize`·`tools/list`·`tools/call`·`ping`, 알림 202, GET 405, 응답은 `application/json` 단건). 127.0.0.1 무작위 포트, 실행별 토큰(`Authorization: Bearer`, `timingSafeEqual`), Host는 `127.0.0.1:<port>`만, Origin 있으면 403, 본문 1 MiB 상한(413), 401에 `WWW-Authenticate` 없음, 요청별 타이머 후 deny, `tool_use_id`당 결정 1회, `close()`로 토큰 폐기 |
| `http-host.test.mjs` | Host 위조·Origin·토큰 틀림/없음·본문 초과·fail-closed·중복 tool_use_id·동시 요청 다중화(원격 없음) |
| `http-run.mjs` | 격리 실행기. `%TEMP%/t012-*` 빈 cwd, mcp-config는 실행 폴더 파일(type http + 토큰 헤더, argv에 토큰 없음, 실행 후 폴더째 삭제), env 허용 목록 + `NO_PROXY=127.0.0.1,localhost` + `DISABLE_AUTOUPDATER=1`(`MCP_TOOL_TIMEOUT`·`MCP_TIMEOUT`·`NODE_OPTIONS` 제외) |

```sh
node --test spikes/claude-cli/http-host.test.mjs     # 원격 없음
node spikes/claude-cli/http-run.mjs init              # 원격 없음 — ④ init 도구·mcp_servers, CLI가 보내는 HTTP 요청
node spikes/claude-cli/http-run.mjs badtoken          # 원격 없음 — ③ 401 때 OAuth 탐색 여부
node spikes/claude-cli/http-run.mjs multi             # 원격 1 — ① allow·deny·updatedInput, ⑤ 병렬 Write, ⑥
node spikes/claude-cli/http-run.mjs pread             # 원격 1 — ⑤ 승인 폴더 밖 병렬 Read
node spikes/claude-cli/http-run.mjs badwrite          # 원격 1 — ③ 보강: 브리지 failed 상태에서 Write
node spikes/claude-cli/http-run.mjs delay             # 원격 1 — ② 응답 HOLD_MS(기본 310초) 지연
RUN_MCP_TOOL_TIMEOUT=400000 RUN_TAG=mtt400k node spikes/claude-cli/http-run.mjs delay   # 원격 1 — ② 대체안: 앱이 MCP_TOOL_TIMEOUT을 직접 지정
RUN_SERVER_TIMEOUT=360000 RUN_TAG=srvto360k node spikes/claude-cli/http-run.mjs delay  # 원격 1 — ② 대체안: mcp-config 서버 항목 "timeout"
```
- 공통 인자: `-p --output-format stream-json --verbose --model haiku --max-turns 4 --no-session-persistence --setting-sources "" --strict-mcp-config --mcp-config <파일> --permission-prompt-tool mcp__ssrbridge__permission_prompt --tools Read,Grep,Glob,Write,Edit --add-dir <extra>`.
- 원격 실행은 `.nomad/logs/task-012/remote-slots/<n>`(10개)을 `wx`로 잡아야 시작하고 `remote-count.log`에 남는다.
- 로그: `.nomad/logs/task-012/<시나리오>.summary.json`(HTTP 요청 전부·결정·도구 호출 시각·파일 결과·새로 생긴 `~/.claude/projects` 폴더)과 `.stream.jsonl`(CLI 출력, 홈 경로·이메일·조직 ID 마스킹).
