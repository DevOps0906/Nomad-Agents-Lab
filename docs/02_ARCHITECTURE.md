# 02 아키텍처 — SSR+ (1차 MVP)

> 그림: [`diagrams/architecture.mmd`](diagrams/architecture.mmd) — 코드가 생기면 `deps2mmd`로 다시 생성
> 스택: [ADR-0005](adr/0005-desktop-stack.md)(제안) · AI 엔진: [ADR-0001](adr/0001-ai-engine-claude-code-cli.md) · 스킬: [ADR-0002](adr/0002-skill-format-skill-md.md) · 그래프: [ADR-0003](adr/0003-graph-links-and-tags.md) · 범위: [ADR-0006](adr/0006-balanced-mvp-scope.md)
> IPC 계약: [`04_API.md`](04_API.md) · 테이블: [`05_DATA_MODEL.md`](05_DATA_MODEL.md)

## 1. 구성 요소
| 요소 | 책임 | 기술 | 소유 경로(제안) |
|---|---|---|---|
| Renderer | 화면 S-01~S-08 렌더링, IPC 호출만 한다. **권한 없음**(Node·파일·프로세스·네트워크 접근 없음) | React + TS + Vite, Fluent UI v9 | `src/renderer/` |
| Preload | `contextBridge`로 A-01~A-17 이름 허용 목록만 노출(`invoke`, `runs` 이벤트 구독) | Electron preload | `src/preload/` |
| IPC 라우터 | 발신 창 확인 → 입력 스키마 검증 → 서비스 호출 → 오류 코드 변환 | Electron main | `src/main/ipc/` |
| 환경 점검 | Claude Code 설치·버전·로그인 확인(A-01) | 자식 프로세스 | `src/main/env/` |
| 소스·색인 | 연결 폴더 관리, 읽기 전용 순회, Markdown·PDF 텍스트 추출, 링크·태그 추출 | Node fs, 로컬 파서(라이브러리 미정) | `src/main/indexer/` |
| 검색·그래프 | FTS5 질의(A-04), 노드·관계 조립(A-05), 미리보기(A-06) | SQLite FTS5 | `src/main/search/` |
| 스킬 카탈로그 | `SKILL.md` 폴더 스캔·frontmatter(`ssr:`) 파싱(A-07·A-08) | Node fs | `src/main/skills/` |
| 실행 관리자 | 외부 처리 동의 확인 → 범위 확정·기억한 허용 대조 → 실행 상태·동의 이벤트 저장, 취소·재시도 | Electron main | `src/main/runs/` |
| **Claude Code 어댑터** | `claude` 명령 조립·실행·stream-json 파싱. CLI 의존은 **이 모듈 1곳**에만. CLI가 구성된 원격 AI 서비스와 통신할 수 있음 | 자식 프로세스 | `src/main/claude/` |
| 권한 브리지 | `--permission-prompt-tool`이 부르는 로컬 MCP 도구 → 실행 관리자 → Renderer 승인 요청 | 로컬 MCP 서버(stdio) — T-01 검증 후 확정 | `src/main/claude/permission/` |
| 저장소 | SQLite 단일 파일(데이터 위치 폴더 안) | SQLite + FTS5 | `src/main/db/` |
| 부트 설정 | 데이터 위치 경로 1개만 보관(DB 위치를 DB에 둘 수 없으므로) | Electron `userData` JSON | `src/main/boot/` |

## 2. 경계 규칙 (누가 누구를 부르나)
| 호출자 | 대상 | 방법 | 금지 |
|---|---|---|---|
| Renderer | Main | Preload가 노출한 A-01~A-17 `invoke`, A-13 이벤트 구독 | `nodeIntegration`, 원격 콘텐츠 로드, `ipcRenderer` 직접 노출, 임의 채널 |
| Main(IPC 라우터) | 서비스 | 함수 호출(스키마 검증 통과 후) | Renderer가 준 경로·명령 인자를 검증 없이 사용, Renderer 경로 입력(A-02·A-17 새 경로는 Main이 연 대화상자 결과만) |
| 소스·색인 | 연결 폴더 | 읽기 전용 fs. 기본 제외: 숨김 폴더, `.git`, `node_modules`, 파일 크기 상한 초과(5MB, PRD Q14) | 원본 쓰기·이동·삭제, 연결 폴더 밖 경로(정규화 후 접두 검사) |
| 실행 관리자 | Claude Code 어댑터 | 확정된 범위 객체 1개 전달 | Renderer 입력을 CLI 인자로 직접 전달 |
| Claude Code 어댑터 | `claude` CLI | `spawn`(셸 없음, 인자 배열), 프롬프트는 stdin | 셸 문자열 조립, API 키 보관·주입 |
| 권한 브리지 | 실행 관리자 | 내부 호출(대기 중 요청 1건 = 응답 1건) | 사용자 응답 없이 자동 허용 |
| Renderer / Main | 외부 네트워크 | 직접 연결 없음. 앱 텔레메트리·AI API 요청·업데이트 확인 없음 | Renderer의 네트워크 API, 원격 콘텐츠 |
| Claude Code CLI | 구성된 AI 서비스 | 실행별 사용자 동의 후 CLI 인증·설정에 따라 원격 요청 | 동의 전 실행, 앱이 통제하지 않는 별도 MCP·도구 |
| Main | OS 셸 | `shell.openPath`는 허용 목록만: 색인된 문서 경로(A-06), 등록된 스킬 폴더(A-08) | 임의 URL·실행 파일 열기 |

### Electron 하드닝(필수)
`contextIsolation: true` · `sandbox: true` · `nodeIntegration: false` · `webSecurity: true` · 엄격한 CSP(`script-src 'self'`) · `will-navigate`·`setWindowOpenHandler` 차단 · 퓨즈(`RunAsNode` 끔 등) — 상세 체크는 `security-baseline`.

## 3. Claude Code 어댑터 경계
| 항목 | 규칙 |
|---|---|
| 실행 형태 | `claude -p --output-format stream-json --verbose --setting-sources "" --strict-mcp-config --mcp-config <앱 설정 파일> --permission-prompt-tool <브리지 도구명> --tools Read,Grep,Glob,Write,Edit`(2.1.323에서 `--verbose` 필수 확인 — 3.1) |
| 설정 출처 | `--setting-sources ""`로 사용자·프로젝트·로컬 설정을 싣지 않는다(사용자 결정 2026-11-20). 기본값(B)은 승인 폴더의 `.claude/settings.json`이 hook·allow 규칙을 주입할 수 있어 기각 |
| 작업 디렉터리 | 승인된 첫 폴더. 나머지 승인 폴더는 `--add-dir` 반복 |
| 도구(1차 고정) | 허용 목록 `--tools Read,Grep,Glob,Write,Edit`만 노출한다(사용자 결정 2026-11-20 — 차단 목록 방식은 Agent·Skill이 브리지를 우회해 기각, 3.1 ⑦). `Read`·`Grep`·`Glob`은 승인 폴더(cwd·`--add-dir`) 안에서 브리지 없이 자동 허용되고, 승인 폴더 밖 경로만 브리지로 온다 → 앱은 실제 경로가 승인 폴더 밖이면 거부. `Write`·`Edit`는 항상 브리지를 거치며 실행별 출력 폴더 안만 허용(실제 경로 판정 — 3.1 ③, 출력 폴더 위치는 팀장 결정 필요) |
| MCP | 1차는 MCP 사용 안 함. 항상 `--strict-mcp-config` + 앱이 만든 설정(앱의 권한 브리지 1개만 등록)으로 사용자 MCP를 차단(T-03 통과 — 3.1). 사용자 MCP 연결은 2차(ADR-0006) |
| 권한 질의 | `--permission-prompt-tool <권한 브리지 도구명>` → S-07에서 승인·거부(A-10). 왕복 동작 T-01 통과(3.1). CLI는 시간 초과를 하지 않으므로 앱이 요청마다 **5분 무응답이면 거부로 확정**하고, 그 뒤 들어온 승인은 무시한다(Q19, 사용자 결정 2026-11-20) |
| 회차 제한 | `--max-turns 20`(2026-11-20 팀장 결정, PRD Q16) |
| 입력 | 스킬명 + 사용자 입력을 프롬프트로 stdin 전달(ADR-0002) |
| 출력 | 줄 단위 JSON 파싱 → `run_events` 저장 → A-13 구독으로 Renderer 전달. 파싱 실패 줄은 `error` 이벤트로 기록 |
| 취소 | A-11 → 프로세스 트리 종료(Windows는 트리 단위 종료 필요) → 상태 `cancelled` |
| 재시작 정리 | 앱 시작 시 `starting`·`running`·`waiting_permission` 실행을 모두 `failed`(`error_code=interrupted`)로 바꾼다 |
| 인증 | Claude Code가 관리. 앱은 키·토큰을 읽거나 저장하지 않음 |
| 버전 | 지원 CLI 버전을 기록하고 A-01에서 범위 밖이면 경고(지원 하한 2.1.323 — 검증한 버전, 상한 미정) |

### 3.1 기술 검증 결과 (task-004, 2026-11-20, CLI 2.1.323 · Windows 11 · Node 26.13.1)
재현: `spikes/claude-cli/README.md`, 로그: `.nomad/logs/task-004/`. 판정은 브리지 요청·응답 로그와 파일 시스템 결과로 했다. 원격 실행 11회(haiku, 상한 15, 재시도 0). 단위 검증 `node --test spikes/claude-cli/` 22건.

| 항목 | 조건 | 결과 | 근거·대체안 |
|---|---|---|---|
| stream-json `--verbose` | — | 필수 | 빠지면 `Error: When using --print, --output-format=stream-json requires --verbose`, 종료 코드 1. `--verbose`를 넣으면 `system/init`부터 나옴(원격 모델 호출 없는 실행 로그 `verbose-check.json`) |
| T-01 ① deny → 파일 없음 | A·B | 통과 | 브리지 1회 호출, 파일 없음, `result.permission_denials`에 기록 |
| T-01 ② allow → 파일 생성 | A·B | 통과 | allow 응답에 `updatedInput` 포함 |
| T-01 ③ 출력 폴더 밖 거부 | A | 통과(앱 판정 필수) | CLI는 `..`·`/`를 정규화해 브리지로 넘기지만 **junction·8.3 이름은 그대로 넘긴다**. 앱이 `realpath.native`로 판정해야 함(`pathguard.mjs`, 단위 15건·실행 8경로 모두 기대대로). UNC·`\\?\`·ADS·대상 없는 junction(거부)·미생성 하위 폴더(허용)는 단위 검증만. 대상 없는 파일 심볼릭 링크는 이 PC에서 만들 권한이 없어 미확인. 판정과 실제 쓰기 사이에 링크가 바뀌는 경쟁(TOCTOU)은 막지 못함 |
| T-01 ④ `updatedInput` 경로 변경 | A | 통과 | `orig.txt` 요청 → `rewritten.txt`로 생성. 앱은 바꾼 경로도 다시 판정해야 함 |
| T-01 ⑤ cwd·`--add-dir` 안 Write | A | 통과 | 둘 다 브리지를 거쳐 거부됨(자동 허용 없음, 기본 permissionMode) |
| T-01 ⑥ 응답 90초 지연 | A | CLI 시간 초과 없음 | 92.9초 후 allow 반영, 정상 종료. **시간 초과·거부는 앱이 구현**(Q19: 5분 확정) |
| 브리지 시간 초과 거부 | A | 통과 | host 무응답 + 브리지 타이머 10초(검증용) → 10초에 deny, 파일 없음, `permission_denials` 기록, 늦은 응답은 무시(요청당 결정 1개). 이상 응답·null·파싱 실패·스키마 위반·연결 불가 → deny는 단위 검증(`bridge.test.mjs`) |
| T-01 ⑦ 차단 목록 밖 도구 | A | 실패 → 허용 목록 채택(사용자 결정) | Agent(하위 에이전트의 Read 포함)·Skill은 브리지 없이 실행. NotebookEdit는 브리지 경유. Bash 차단 시 PowerShell도 비활성. init에 Cron·RemoteTrigger·SendToProject·Workflow·EnterWorktree 등 노출. **`--tools Read,Grep,Glob,Write,Edit`로 바꾸면 init 도구가 그 5개뿐이고 브리지 왕복도 통과** |
| T-03 사용자 MCP 차단 | A·B | 통과 | `--strict-mcp-config` + 브리지 설정: init `mcp_servers`=ssrbridge 1개, 카나리아 미실행. 대조군(strict 없음, B)은 카나리아 실행 + user 15·plugin 7·claude.ai 커넥터 14개 로드 → strict가 claude.ai 원격 커넥터·plugin MCP도 뺀다. permission-prompt 도구는 모델 도구 목록(`mcp__*`)에 안 보임 |
| T-02 로그인 상태 | — | 통과 | `claude auth status --json`, 프록시를 닿지 않는 주소로 둬도 0.8초 성공(원격 없음). `loggedIn`·`authMethod`·`apiProvider`·`subscriptionType`·`loginExpiresAt` 제공. email·orgId·orgName 포함 → 앱은 저장·로그 금지. **로그아웃 상태의 출력·종료 코드는 미확인**(logout 금지) |
| 설정 출처 A/B | A vs B | 둘 다 브리지가 판정 | 이 환경의 사용자 allow는 MCP 도구뿐이고 defaultMode 없음 → B에서도 Write는 브리지로 감. 단 B는 사용자 hooks가 cwd에 `.nomad/` 폴더를 만들고 사용자 agents·plugins·skills를 싣는다(비용 약 3배). 사용자 hook·allow 규칙이 브리지보다 먼저 결정하는 경우는 **미확인**(이 환경에 그런 규칙 없음). **A 확정**(사용자 결정 2026-11-20: B는 승인 폴더 `.claude/settings.json`의 hook·allow 주입 위험으로 기각) |
| 읽기 도구 경계 | A, 허용 목록 | 통과(앱 판정 필수) | `Read`(cwd·`--add-dir`)·`Grep`·`Glob`(cwd 안)은 브리지 없이 실행. 승인 폴더 안 junction으로 밖 파일 `Read` → CLI가 실제 경로로 브리지에 질의 → 거부. `Grep`·`Glob`은 junction을 따라가지 않음(가짜 비밀 미노출). `Glob` `../밖/*.txt`는 결과 없음, 절대경로 패턴은 브리지 질의. `Grep` 경로 `ws\..\밖`은 **`..`가 정규화되지 않은 채** 브리지로 옴 → 앱이 정규화·실제 경로로 판정해야 함. CLI 출력 전체에 가짜 비밀 표식 0건 |
| 최소 버전 | — | 2.1.323 | 검증한 버전을 하한으로 기록 |
| CLI 부수 기록 | A·B | 주의 | `--no-session-persistence`여도 `~/.claude/projects/<cwd>` 폴더가 생기고 하위 에이전트 메타 파일이 남음 |

동의 화면에 표시할 수 있는 정보(원격 처리 고지와 CLI 구성 충돌 없음 — 아래 값은 실행 전 원격 호출 없이 얻는다):

| 정보 | 출처 | 예(이번 환경) |
|---|---|---|
| 원격 AI 서비스 | `auth status`의 `apiProvider` | `firstParty`(Anthropic). Bedrock·Vertex 등이면 해당 클라우드 |
| 인증 출처 종류 | `auth status`의 `authMethod`, init `apiKeySource` | `claude.ai`(구독 로그인), `none` |
| 모델 | 실행 인자 `--model`, init `model` | `claude-haiku-5-5` |
| 연결 MCP | init `mcp_servers` | 앱 브리지 1개만(외부 커넥터 없음) |

제품 구현 요건(검증·리뷰에서 도출):
- 브리지 판정: 모든 도구 요청을 정규화(`..`·`/`·대소문자) + 실제 경로(junction·8.3 해소)로 판정하고, 대상 없는 링크·UNC·장치 경로·ADS는 거부. `updatedInput`으로 바꾼 경로도 다시 판정. 읽기 도구도 승인 폴더 밖이면 거부.
- 읽기 경계 대체 대책: 승인 폴더 안의 심볼릭 링크·junction은 색인·Grep·Glob 결과에서 제외하고, 폴더 승인 전에 재분석 지점(reparse point)을 스캔해 밖을 가리키면 승인 화면에 경고한다(TOCTOU는 남음).
- 시간 초과·장애: 요청마다 5분 타이머 후 거부 확정, 이후 승인 무시. 응답 스키마 검증, 예외·null·파싱 실패·연결 끊김은 모두 거부. 요청 버퍼 상한(스파이크 1 MiB), 동시 연결 1(초과 연결은 끊겨 거부됨 — 병렬 도구 요청이 거부될 수 있으므로 제품은 요청 다중화 검토).
- 채널 인증: pipe 이름 무작위 + 토큰 상수시간 비교(`timingSafeEqual`). 토큰은 argv가 아니라 `--mcp-config` **파일 경로**로 넘기고 실행 후 삭제(스파이크 구현, Windows에서 mode 0600은 사실상 무시되므로 파일 DACL 필요). pipe DACL을 현재 사용자로 제한하고 `PIPE_REJECT_REMOTE_CLIENTS`를 켠다 — 둘 다 Node `net`으로는 설정할 수 없어 **미확인**(네이티브 모듈 또는 Electron 측 구현 필요, 팀장 확인 필요). DACL로도 같은 사용자 권한의 다른 프로세스는 막지 못한다.
- CLI 환경변수: 부모 환경을 그대로 넘기지 말고 허용 목록으로 구성할지 검토(스파이크는 `CLAUDE*` 세션 변수만 제거). `ANTHROPIC_BASE_URL`·프록시 변수는 원격 서비스와 동의 화면 표시를 바꾼다.
- 로그: 도구 결과의 파일 내용, 사용자 홈 경로·사용자명, 이메일·조직 ID를 마스킹한 뒤 저장(`auth status` 원문 저장 금지).
- CLI는 `--no-session-persistence`여도 `~/.claude/projects/<cwd>` 폴더를 만든다 → 제품 고지 또는 정리 정책 필요.

#### task-012 HTTP 브리지 재검증 (2026-11-20, CLI 2.1.323 · Node 26.13.1)
방식: Main 대역 안 로컬 HTTP MCP 서버(`spikes/claude-cli/http-host.mjs`, 의존성 0) + `--mcp-config` type http·`Authorization: Bearer` 헤더(설정 파일로 전달). 조건 A·`--tools Read,Grep,Glob,Write,Edit`·env 허용 목록·`NO_PROXY`. 재현: `spikes/claude-cli/README.md` "task-012 1단계", 로그: `.nomad/logs/task-012/`. 원격 실행 6회(haiku, 상한 10, 재시도 0), 원격 없는 실행 2회. 단위 `node --test spikes/claude-cli/` 34건(HTTP 12건 포함).

| 항목 | 결과 | 근거(로그)·대체안 |
|---|---|---|
| CLI HTTP 접속 모양 | 확인 | `server/discover`(우리 서버는 method not found 응답) → `initialize` → `notifications/initialized` → `GET /mcp`(SSE 시도, 405 응답에도 정상 진행) → `tools/list`. Host=`127.0.0.1:<port>`, Origin 없음 → 방어 규칙과 충돌 없음(`init.summary.json`) |
| ① 왕복 allow·deny·updatedInput | 통과 | `a-deny.txt` deny → 파일 없음·`permission_denials` 1건, `b-allow.txt` 생성, `c-orig.txt` → `c-rewritten.txt`로 생성. 요청·결정 1:1(`multi.summary.json`) |
| ② 응답 5분 지연 | 실패 → 대체안 통과 | 기본값(`MCP_TOOL_TIMEOUT` 미설정): HTTP 도구 호출을 **60.0초에 CLI가 끊음**(`The operation timed out`, 도구 오류 — deny가 아님), 모델이 새 tool_use_id로 1회 재시도 → 다시 60초에 끊김, 파일 없음(`delay.summary.json`; stdio 브리지는 90초에도 안 끊겼음). `MCP_TOOL_TIMEOUT=400000`을 넣으면 60초 상한은 풀리지만 별도의 **무응답 감시 300초**에 끊김(`no response or progress for 300s`, 안내: 서버별 `"timeout"` 또는 `CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT`, `delay-mtt400k.summary.json`). **mcp-config 서버 항목 `"timeout": 360000`만 넣으면(env 추가 없음) 310초 뒤 allow가 반영되어 파일 생성**(`delay-srvto360k.summary.json`) → 대체안: 앱 mcp-config에 `timeout` > 5분(예 360000) 지정, 5분 확정 거부는 앱 타이머가 먼저 낸다. 상한은 CLI 버전에 따라 바뀔 수 있어 앱은 클라이언트 연결 끊김(요청 취소)을 받으면 그 요청을 거부로 닫고 S-07 질의를 내린다 |
| ③ 401·잘못된 토큰 | 통과(OAuth 탐색 없음) | 401(WWW-Authenticate 없음) 2회 후 `/.well-known/*`·`/register` 요청 0건, init `ssrbridge: failed`, 자격 파일 변경 없음(`badtoken.summary.json`). 이 상태에서 Write 지시 → `permission_prompt not found` 도구 오류, 파일 없음, `result` 이벤트 없이 종료 코드 1(`badwrite.summary.json`) → **앱은 init의 브리지 status가 `connected`가 아니면 즉시 실행 실패 처리** |
| ④ `--strict-mcp-config`·init 도구 | 통과 | init `mcp_servers`=ssrbridge(connected, source dynamic) 1개, `tools`=Edit·Glob·Grep·Read·Write 5개(`mcp__*` 없음) — 모든 실행 동일 |
| ⑤ 병렬 권한 요청 | 통과(도구별 차이) | 승인 폴더 밖 Read 3개(한 메시지) → `tools/call` 3건이 0.2초 간격으로 겹쳐 도착, 요청별 4초 후 각각 deny(`pread.summary.json`, 출력에 파일 내용 0건). Write 3개(한 메시지) → CLI가 **직렬로** 질의(앞 응답 뒤에 다음 요청, `multi.summary.json`) → 앱 5분 타이머는 요청마다, 최악 대기는 요청 수 × 5분 |
| ⑥ 허용 목록에서 Write 브리지 경유 | 통과 | cwd 아래 출력 폴더 Write 3건 모두 브리지 질의 후에만 실행(자동 허용 없음, permissionMode default) |
| 노출 면 방어 | 통과(단위) | Host 위조 5종·Origin 3종 403, 토큰 틀림·없음·형식 다름 401, 본문 초과 413, 거부 요청은 결정 함수 미호출, 같은 tool_use_id 재요청 deny, `close()` 후 접속 불가(`http-host.test.mjs`) |
| CLI 부수 기록 | 주의 | 실행마다 `~/.claude/projects/C--Users-<user>-AppData-Local-Temp-t012-<시나리오>-<무작위>-ws` 생성(원격 없는 실행 포함), `~/.claude.json` 갱신 시각 바뀜 |


## 4. 주요 흐름
| 흐름 | 순서 | 화면 · IPC |
|---|---|---|
| 첫 실행 | 설치·로그인 점검 → 데이터 위치 선택(부트 설정) → DB 생성 → 첫 폴더 연결 또는 샘플 → 색인 대상 미리보기(대상·제외 수) | S-01 · A-01, A-17, A-02, A-03 |
| 색인 | 폴더 추가 → 순회(Markdown·PDF, 기본 제외 [2장](#2-경계-규칙-누가-누구를-부르나)) → `documents`·`doc_fts`·`links`·`tags` 갱신(해시 비교로 증분) → 상태 조회 | S-01·S-08 · A-02, A-03 |
| 탐색 | 검색어 → FTS5 → 결과 선택 → 미리보기 + 관련 노드, 제한된 이웃 그래프를 3D·2D·목록으로 표시 | S-03 · A-04, A-05, A-06, A-16 |
| 스킬 실행 | 스킬 선택 → 원격 처리·폴더·도구 범위 고지 → 매 실행 동의 → 이번만/범위 기억 선택 → 기억한 접근 허용 대조(확대 시 재질의) → 어댑터 실행 → 이벤트 스트림·권한 응답 → 종료 | S-04→S-05→S-07 · A-07~A-11, A-13, A-14 |
| 기록·대시보드 | 실행 목록·상세, 색인·실행 요약 | S-06·S-02 · A-12, A-13, A-15 |

- 시퀀스 그림: [`diagrams/seq-skill-run.mmd`](diagrams/seq-skill-run.mmd)(스킬 실행) · [`diagrams/seq-indexing.mmd`](diagrams/seq-indexing.mmd)(색인)

## 5. 데이터 위치·보존
- 원본은 연결 폴더에 그대로 둔다. DB에는 메타데이터·추출 텍스트·관계·실행 기록만([`05_DATA_MODEL.md`](05_DATA_MODEL.md)).
- 앱의 색인·저장은 로컬이지만 Claude Code CLI 실행은 원격 AI 처리를 수반할 수 있다. S-05의 매 실행 동의를 거치지 않은 실행은 Main에서 거부한다. 폴더 승인만으로 사전에 정확한 읽기 파일 목록을 보장하지 않는다는 점을 UI에 표시한다.
- 데이터 위치 변경(A-17): 새 위치는 Main 대화상자 결과만 → 새 위치로 복사 → 검증 → 다음 재시작 때 부트 설정 전환. 원본은 앱이 지우지 않고 사용자가 삭제한다.
- 실행 기록 보존 기간 기본값: 30일([PRD Q6](01_PRD.md#7), 2026-11-20 사용자 결정)(S-08에서 사용자가 변경).
- 비밀값 저장 대상 없음(ADR-0001). 2차 MCP/API 연결 시 OS 보호 저장소를 다시 검토한다.
