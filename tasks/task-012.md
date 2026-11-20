# task-012 Claude Code 어댑터·실행 관리자·권한 브리지

| 항목 | 내용 |
|---|---|
| 웨이브 | W3 |
| 선행 | task-004, task-008, task-018 |
| 위험도 | 높음 |
| 보안 영향 | 키·권한 |
| 담당 | builder (착수 전 challenger) |
| 근거 | `docs/02_ARCHITECTURE.md#3`, `docs/04_API.md` A-09~A-11·A-13, `docs/diagrams/seq-skill-run.mmd` |
| 쓰기 허용 | 1단계: `spikes/claude-cli/**`, `.nomad/logs/task-012/**`, `docs/02_ARCHITECTURE.md`(§3·§3.1) / 2단계: `app/src/main/runs/**`, `app/src/main/claude/**`, `app/src/main/ipc/**`, `app/src/shared/ipc.ts`, `app/src/main/index.ts`, `app/src/main/db/recovery.ts`, `app/migrations/0001_init.sql`(배포 전), `app/tests/**`, `app/README.md`, `docs/04_API.md`(A-09~A-13), `docs/05_DATA_MODEL.md` |

## 할 것
- `claude -p` 자식 프로세스, `--add-dir`·`--tools Read,Grep,Glob,Write,Edit`(허용 목록, 2026-11-20 사용자 결정)·`--setting-sources ""`·`--strict-mcp-config`·`--max-turns`
- stream-json → `run_events`, 권한 브리지(1회용 requestId, 시간 초과 거부)
- 취소(재시도는 동의 재수집과 묶어 task-013·021로 이월)

## 하지 않을 것
- Bash·WebFetch·WebSearch 허용

## 완료 조건 (실행 가능한 확인)
- [ ] 가짜 CLI로 이벤트·권한·취소 테스트 통과
- [ ] P5: 범위 밖 접근 0건 검사 스크립트 통과

## 이월 항목 (task-004에서)
- `tasks/task-004.md#결과`의 "task-012로 넘기는 것"과 `docs/02_ARCHITECTURE.md` §3.1 "제품 구현 요건"을 완료 조건에 포함한다.

## 계획 보완 (2026-11-20, challenger REVISE 반영 — 사용자·팀장 확정)
**브리지 방식(사용자 결정): Main 안 로컬 HTTP MCP 서버.** 두 단계로 진행한다.
- **1단계 재검증 스파이크**(`spikes/claude-cli/`, 원격 실행 10회 이내·haiku·재시도 1회): `--mcp-config` type http + Authorization 토큰 헤더로 ① permission-prompt-tool 왕복(allow·deny·updatedInput) ② 응답 5분 지연 시 CLI·MCP_TOOL_TIMEOUT이 먼저 끊는지(끊기면 상한·대체안 기록) ③ 401·잘못된 토큰 때 CLI가 OAuth 탐색을 시도하지 않고 실패하는지 ④ `--strict-mcp-config` 유지·init 도구 목록 ⑤ 병렬 권한 요청 다중화 ⑥ `--tools` 허용 목록과 함께 Write가 브리지를 거치는지 재확인. **1단계 결과를 팀장이 확인하기 전에는 2단계를 시작하지 않는다.** 실패 항목이 있으면 SEA로 전환 여부를 사용자에게 다시 묻는다.
- **노출 면 방어:** 127.0.0.1 무작위 포트(0 바인딩), 실행마다 무작위 토큰(timingSafeEqual), Host 헤더 `127.0.0.1:<port>`만, Origin 헤더가 있으면 거부(브라우저·DNS 리바인딩 차단), 본문 크기 상한, 실행 종료 시 토큰 폐기. CLI env에 `NO_PROXY=127.0.0.1,localhost`. mcp-config는 실행 폴더의 파일(실행 후 삭제)로 넘기고 argv에 토큰을 넣지 않는다.
- **확정 권한은 Main 한 곳:** 5분 타이머·tool_use_id별 1회 결정·A-10 중복 클릭 무시 모두 Main. HTTP라 동시 요청은 요청별로 처리.

**실행 환경(팀장 결정)**
- cwd = 앱 소유 실행 폴더 `<데이터 폴더>/runs/<runId>/`(출력 폴더 겸). 승인 폴더는 `--add-dir`. 그래서 `~/.claude/projects/` 세션 폴더 정리는 앱 실행 폴더에 해당하는 것만 지운다(사용자 세션과 섞이지 않음).
- 동시 실행 1개(두 번째는 E_BUSY). `--max-turns` 기본 20. 모델은 CLI 기본값.
- env 허용 목록: HOME·USERPROFILE·APPDATA·LOCALAPPDATA·SystemRoot·WINDIR·TEMP·TMP·PATH·PATHEXT·ComSpec, 인증(CLAUDE_CONFIG_DIR·ANTHROPIC_API_KEY·ANTHROPIC_BASE_URL·CLAUDE_CODE_USE_BEDROCK/VERTEX와 AWS_*·GOOGLE_*·CLOUD_ML_REGION), 프록시(HTTP(S)_PROXY·NODE_EXTRA_CA_CERTS) + NO_PROXY 덮어쓰기, DISABLE_AUTOUPDATER=1. 제외: NODE_OPTIONS·MCP_TOOL_TIMEOUT·MCP_TIMEOUT·그 외 CLAUDE_CODE_*. env.check(A-01)도 같은 허용 목록을 써서 표시 provider와 실행 provider를 일치시킨다.
- 크래시 고아 CLI: runs에 pid·시작 시각을 저장하고, 재시작 정리에서 같은 pid·시작 시각의 프로세스가 살아 있으면 트리 종료 후 failed. Job Object(네이티브)는 잔여 위험으로 기록.
- run_events: 원문 저장(Q6 사용자 결정), stream-json의 모든 type을 매핑(모르는 type은 `other`로 CHECK 확장 — 배포 전 0001 수정). 로그(콘솔)에는 본문을 남기지 않는다. P5 검사는 Grep 경로까지 실제 경로로 정규화해 판정.

**012와 013의 경계**
- 012는 실행 서비스·브리지·취소(A-11)·이벤트 조회(A-13 내부)까지. `runs.start` IPC는 **등록하지 않는다**(013이 동의 화면과 함께 등록). 012 검증은 서비스 단위 테스트(가짜 CLI) + 개발 전용 스크립트(`!app.isPackaged`가 아닌, Electron 밖 Node 스크립트)로 실 CLI 스모크 3회 이내.
- 요청 다중화·pipe DACL은 HTTP 방식으로 대체되어 범위 밖.

## 1단계 결과와 결정 (2026-11-20)
- 재검증: ①③④⑥ 통과, ⑤ Read는 동시·Write는 순차 질의, ② 기본 설정은 CLI가 60초에 끊음 → mcp-config 서버 항목 `"timeout": 360000`으로 통과(근거 `docs/02_ARCHITECTURE.md` §3.1 "task-012 HTTP 브리지 재검증", 로그 `.nomad/logs/task-012/`).
- **사용자 결정: HTTP 유지 + 서버 timeout 360000 고정.** 2단계 요건 추가: ① CLI가 요청 연결을 먼저 끊으면 그 요청을 deny로 확정하고 화면에 "시간 초과" 표시 ② 브리지가 init에서 connected가 아니면 실행 즉시 failed(사유 코드) ③ Write 순차 질의로 최악 대기 = 요청 수 × 5분임을 S-07에 안내(남은 시간 표시).
- 검증용 세션 폴더 8개(`t012`)는 사용자 승인으로 삭제.
