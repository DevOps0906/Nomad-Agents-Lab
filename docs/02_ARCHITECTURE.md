# 02 아키텍처 — SSR+ (1차 MVP)

> 그림: [`diagrams/architecture.mmd`](diagrams/architecture.mmd) — 코드가 생기면 `deps2mmd`로 다시 생성
> 스택: [ADR-0005](adr/0005-desktop-stack.md)(제안) · AI 엔진: [ADR-0001](adr/0001-ai-engine-claude-code-cli.md) · 스킬: [ADR-0002](adr/0002-skill-format-skill-md.md) · 그래프: [ADR-0003](adr/0003-graph-links-and-tags.md) · 범위: [ADR-0004](adr/0004-mvp-vertical-slice.md)
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
| 실행 관리자 | 범위 확정·기억한 허용 대조, 실행 상태·이벤트 저장, 취소·재시도 | Electron main | `src/main/runs/` |
| **Claude Code 어댑터** | `claude` 명령 조립·실행·stream-json 파싱. CLI 의존은 **이 모듈 1곳**에만 | 자식 프로세스 | `src/main/claude/` |
| 권한 브리지 | `--permission-prompt-tool`이 부르는 로컬 MCP 도구 → 실행 관리자 → Renderer 승인 요청 | 로컬 MCP 서버(stdio) — T-01 검증 후 확정 | `src/main/claude/permission/` |
| 저장소 | SQLite 단일 파일(데이터 위치 폴더 안) | SQLite + FTS5 | `src/main/db/` |
| 부트 설정 | 데이터 위치 경로 1개만 보관(DB 위치를 DB에 둘 수 없으므로) | Electron `userData` JSON | `src/main/boot/` |

## 2. 경계 규칙 (누가 누구를 부르나)
| 호출자 | 대상 | 방법 | 금지 |
|---|---|---|---|
| Renderer | Main | Preload가 노출한 A-01~A-17 `invoke`, A-13 이벤트 구독 | `nodeIntegration`, 원격 콘텐츠 로드, `ipcRenderer` 직접 노출, 임의 채널 |
| Main(IPC 라우터) | 서비스 | 함수 호출(스키마 검증 통과 후) | Renderer가 준 경로·명령 인자를 검증 없이 사용, Renderer 경로 입력(A-02·A-17 새 경로는 Main이 연 대화상자 결과만) |
| 소스·색인 | 연결 폴더 | 읽기 전용 fs. 기본 제외: 숨김 폴더, `.git`, `node_modules`, 파일 크기 상한 초과(값 팀장 결정 필요) | 원본 쓰기·이동·삭제, 연결 폴더 밖 경로(정규화 후 접두 검사) |
| 실행 관리자 | Claude Code 어댑터 | 확정된 범위 객체 1개 전달 | Renderer 입력을 CLI 인자로 직접 전달 |
| Claude Code 어댑터 | `claude` CLI | `spawn`(셸 없음, 인자 배열), 프롬프트는 stdin | 셸 문자열 조립, API 키 보관·주입 |
| 권한 브리지 | 실행 관리자 | 내부 호출(대기 중 요청 1건 = 응답 1건) | 사용자 응답 없이 자동 허용 |
| Main | 외부 네트워크 | 없음(앱 자체는 통신하지 않음) | 텔레메트리, 업데이트 확인(1차) |
| Main | OS 셸 | `shell.openPath`는 허용 목록만: 색인된 문서 경로(A-06), 등록된 스킬 폴더(A-08) | 임의 URL·실행 파일 열기 |

### Electron 하드닝(필수)
`contextIsolation: true` · `sandbox: true` · `nodeIntegration: false` · `webSecurity: true` · 엄격한 CSP(`script-src 'self'`) · `will-navigate`·`setWindowOpenHandler` 차단 · 퓨즈(`RunAsNode` 끔 등) — 상세 체크는 `security-baseline`.

## 3. Claude Code 어댑터 경계
| 항목 | 규칙 |
|---|---|
| 실행 형태 | `claude -p --output-format stream-json --verbose`(stream-json 사용 시 `--verbose` 필요 여부는 착수 시 CLI 버전으로 확인) |
| 작업 디렉터리 | 승인된 첫 폴더. 나머지 승인 폴더는 `--add-dir` 반복 |
| 도구(1차 고정) | 기본 `Read`·`Grep`·`Glob`. `Write`·`Edit`는 실행별 출력 폴더 안에서만(출력 폴더 위치·강제 방법 T-01 확인). `--disallowedTools`로 `Bash`·`WebFetch`·`WebSearch` 금지. 승인 범위 밖 도구 요청은 권한 브리지로 질의 |
| MCP | 1차는 MCP 사용 안 함. 항상 `--strict-mcp-config` + 앱이 만든 설정(앱의 권한 브리지 1개만 등록)으로 사용자 MCP를 차단(동작 **T-03 검증**). 사용자 MCP 연결은 2차(ADR-0004) |
| 권한 질의 | `--permission-prompt-tool <권한 브리지 도구명>` → S-07에서 승인·거부(A-10). 동작 방식은 **T-01 기술 검증**(미확인) |
| 회차 제한 | `--max-turns`(기본값 팀장 결정 필요) |
| 입력 | 스킬명 + 사용자 입력을 프롬프트로 stdin 전달(ADR-0002) |
| 출력 | 줄 단위 JSON 파싱 → `run_events` 저장 → A-13 구독으로 Renderer 전달. 파싱 실패 줄은 `error` 이벤트로 기록 |
| 취소 | A-11 → 프로세스 트리 종료(Windows는 트리 단위 종료 필요) → 상태 `cancelled` |
| 재시작 정리 | 앱 시작 시 `starting`·`running`·`waiting_permission` 실행을 모두 `failed`(`error_code=interrupted`)로 바꾼다 |
| 인증 | Claude Code가 관리. 앱은 키·토큰을 읽거나 저장하지 않음 |
| 버전 | 지원 CLI 버전을 기록하고 A-01에서 범위 밖이면 경고(지원 범위 미확인) |

## 4. 주요 흐름
| 흐름 | 순서 | 화면 · IPC |
|---|---|---|
| 첫 실행 | 설치·로그인 점검 → 데이터 위치 선택(부트 설정) → DB 생성 → 첫 폴더 연결 또는 샘플 → 색인 대상 미리보기(대상·제외 수) | S-01 · A-01, A-17, A-02, A-03 |
| 색인 | 폴더 추가 → 순회(Markdown·PDF, 기본 제외 [2장](#2-경계-규칙-누가-누구를-부르나)) → `documents`·`doc_fts`·`links`·`tags` 갱신(해시 비교로 증분) → 상태 조회 | S-01·S-08 · A-02, A-03 |
| 탐색 | 검색어 → FTS5 → 결과 선택 → 미리보기 + 관련 노드, 그래프는 같은 데이터로 2D 렌더 | S-03 · A-04, A-05, A-06, A-16 |
| 스킬 실행 | 스킬 선택 → 범위 지정(이번만/기억) → 기억한 허용 대조(범위가 넓어지면 다시 질의) → 어댑터 실행 → 이벤트 스트림 → 권한 요청 응답 → 종료 | S-04→S-05→S-07 · A-07~A-11, A-13, A-14 |
| 기록·대시보드 | 실행 목록·상세, 색인·실행 요약 | S-06·S-02 · A-12, A-13, A-15 |

- 시퀀스 그림: [`diagrams/seq-skill-run.mmd`](diagrams/seq-skill-run.mmd)(스킬 실행) · [`diagrams/seq-indexing.mmd`](diagrams/seq-indexing.mmd)(색인)

## 5. 데이터 위치·보존
- 원본은 연결 폴더에 그대로 둔다. DB에는 메타데이터·추출 텍스트·관계·실행 기록만([`05_DATA_MODEL.md`](05_DATA_MODEL.md)).
- 데이터 위치 변경(A-17): 새 위치는 Main 대화상자 결과만 → 새 위치로 복사 → 검증 → 다음 재시작 때 부트 설정 전환. 원본은 앱이 지우지 않고 사용자가 삭제한다.
- 실행 기록 보존 기간 기본값: **팀장 결정 필요**(S-08에서 사용자가 변경).
- 비밀값 저장 대상 없음(ADR-0001). 2차 MCP/API 연결 시 OS 보호 저장소를 다시 검토한다.
