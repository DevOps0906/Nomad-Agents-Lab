# 04 API — SSR+ (1차 MVP, Electron IPC)

> HTTP API 없음. 모든 호출은 Renderer → Main IPC다. 경계: [`02_ARCHITECTURE.md#2`](02_ARCHITECTURE.md) · 테이블: [`05_DATA_MODEL.md`](05_DATA_MODEL.md)

## 공통 규칙
- 메서드: `invoke`(요청·응답, Promise) / `subscribe`(Main → Renderer 이벤트). Preload가 아래 경로 이름만 허용한다.
- 모든 입력은 Main에서 스키마 검증한다. 경로 입력은 정규화 후 연결 폴더(`sources`) 안인지 검사한다.
- Renderer는 파일 경로를 보내지 않는다. 새 경로(A-02 폴더 추가·A-17 데이터 위치)는 Main이 연 OS 대화상자 결과만 쓴다.
- 권한 열 = Main이 그 명령을 처리할 때 쓰는 능력. Renderer 자체는 어떤 능력도 갖지 않는다.
- 공통 오류: `E_VALIDATION`(입력 형식) · `E_NOT_FOUND` · `E_OUT_OF_SCOPE`(연결 폴더·승인 범위 밖) · `E_CONSENT_REQUIRED`(이번 실행의 외부 처리 동의 누락) · `E_BUSY`(이미 진행 중) · `E_INTERNAL`(원문·스택은 Renderer에 보내지 않음).

| ID | 메서드 | 경로 | 입력 | 출력 | 권한 | 오류 |
|---|---|---|---|---|---|---|
| A-01 | invoke | env.check | 없음 | 설치 여부·버전·지원 범위 여부·로그인 상태·데이터 위치 설정 여부 | 프로세스 실행(`claude --version` 등 점검 명령만) | `E_CLAUDE_MISSING`, `E_CLAUDE_AUTH`(로그인 확인 방법 T-02 미확인) |
| A-02 | invoke | sources.list · sources.add · sources.remove | add: `dialog`(Main이 폴더 선택 대화상자를 열어 그 결과만 사용) 또는 `sample` / remove: `sourceId` | 소스 목록(경로·종류·문서 수·마지막 색인) | DB 읽기·쓰기, OS 폴더 선택 대화상자 | `E_VALIDATION`(드라이브 루트 등 광범위 경로 거부), `E_NOT_FOUND`, `E_BUSY`(색인 중 삭제) |
| A-03 | invoke | index.preview · index.start · index.status | preview: `sourceId` / start: `sourceId?`(없으면 전체) | preview: 대상 수·제외 수(기본 제외 규칙 [02#2](02_ARCHITECTURE.md)) / status: 진행률·처리/실패 수·실패 파일 목록(사유) | fs 읽기 전용(연결 폴더 안), DB 쓰기 | `E_BUSY`, `E_NOT_FOUND` |
| A-04 | invoke | search.query | 검색어, 필터(소스·태그·형식·관계 종류), 페이지 | 문서 목록(제목·경로·발췌·점수) | DB 읽기 | `E_VALIDATION`(FTS 구문 오류는 일반 텍스트로 재시도) |
| A-05 | invoke | graph.get | 필터(소스·태그·형식·관계 종류), 중심 문서 ID?, 깊이, 페이지/이웃 제한 | 3D·2D·목록이 공유하는 제한된 부분 그래프: 노드(문서·태그·폴더·없는 문서)·관계(종류 `link`·`tag`·`folder`·`manual`)·분야 색상 키 | DB 읽기 | `E_NOT_FOUND`, `E_VALIDATION` |
| A-06 | invoke | doc.preview · doc.openExternal | `docId` | preview: 제목·추출 텍스트 일부·메타·관련 노드 / openExternal: 성공 여부 | DB 읽기, `shell.openPath`(색인된 문서 경로만) | `E_NOT_FOUND`, `E_OUT_OF_SCOPE`(파일이 연결 폴더 밖·삭제됨) |
| A-07 | invoke | skills.list | 검색어? | 스킬 목록(이름·설명·위치(사용자/앱)·유효 여부·`last_run`) | fs 읽기(스킬 폴더), DB 쓰기(색인) | `E_INTERNAL`(폴더 접근 실패는 항목별 오류로 반환) |
| A-08 | invoke | skills.get · skills.openFolder | 스킬 `name` | get: 설명·본문 요약·`ssr.inputs`·`ssr.reads`·`ssr.tools`·이 스킬의 기억한 허용 / openFolder: 성공 여부 | fs 읽기, DB 읽기, `shell.openPath`(등록된 스킬 폴더만) | `E_NOT_FOUND`, `E_VALIDATION`(frontmatter 파싱 실패), `E_OUT_OF_SCOPE`(등록되지 않은 폴더) |
| A-09 | invoke | runs.start | 스킬 `name`, 입력 값, 범위(폴더 ID 목록·도구 목록 — 1차 허용 도구만, [02#3](02_ARCHITECTURE.md)), `externalProcessingConsent: true`(이번 실행에만 유효), `remember`(접근 범위 이번만/기억), `retryOf?` | `runId`; Main은 동의 시각·서비스 표시·실행 범위를 기록 | 동의 확인 후 프로세스 실행(Claude Code 어댑터), DB 쓰기 | `E_CONSENT_REQUIRED`, `E_CLAUDE_MISSING`, `E_CLAUDE_AUTH`, `E_OUT_OF_SCOPE`(폴더가 연결 소스 아님), `E_VALIDATION`(필수 입력 누락·1차 금지 도구) |
| A-10 | invoke | runs.respondPermission | `runId`, `requestId`, `allow`/`deny` | 반영 여부 | 권한 브리지 응답 전달, DB 쓰기 | `E_NOT_FOUND`(이미 응답·만료된 요청) |
| A-11 | invoke | runs.cancel | `runId` | 최종 상태 | 프로세스 종료(해당 실행의 트리만) | `E_NOT_FOUND`, `E_VALIDATION`(이미 종료) |
| A-12 | invoke | runs.list | 검색어(스킬명·결과 요약)?, 상태·스킬 필터, 기간 `from`/`to`, 페이지 | 실행 목록(스킬·상태·시작·소요·결과 요약) | DB 읽기 | `E_VALIDATION` |
| A-13 | invoke + subscribe | runs.get · 이벤트 runs.events | `runId` / 구독: `runId` | 실행 상세 + 이벤트 목록 / 구독: 이벤트 1건씩(`seq` 순) | DB 읽기 | `E_NOT_FOUND` |
| A-14 | invoke | grants.list · grants.revoke | revoke: `grantId` | 기억한 허용 목록(스킬·폴더·도구·마지막 사용. MCP는 2차) | DB 읽기·쓰기 | `E_NOT_FOUND` |
| A-15 | invoke | dashboard.summary | 기간(`7d`·`30d`, 기본 `7d`) | 선택 기간 기준: 소스·문서 수, 색인 실패 수, 최근 수정 문서, 최근 실행, 실행 상태별 수 | DB 읽기 | `E_INTERNAL` |
| A-16 | invoke | links.addManual · links.removeManual | add: `srcDocId`, `dstDocId` / remove: `linkId` | 관계 1건 | DB 쓰기(`manual`만, 자동 추출 관계는 삭제 불가) | `E_NOT_FOUND`, `E_VALIDATION`(자기 자신·중복·자동 관계 삭제 시도) |
| A-17 | invoke | settings.get · settings.set | set: 허용된 키 + 값(데이터 위치·`skill_dirs` 추가는 값 대신 `dialog` — Main 대화상자 결과만, 전환 절차 [02#5](02_ARCHITECTURE.md)) | 설정 값 | DB 읽기·쓰기, 부트 설정 쓰기(데이터 위치) | `E_VALIDATION`(알 수 없는 키·범위 밖 값) |

## 위협 메모 (노출 면)
| 항목 | ① IPC 계약(A-01~A-17) | ② Claude Code 실행(A-09~A-13) | ③ 로컬 파일 읽기·열기(A-02~A-08) | ④ 문서 렌더링(A-06 미리보기) | ⑤ 권한 응답 채널(A-10) |
|---|---|---|---|---|---|
| 노출 면 | 앱 창 Renderer만(직접 네트워크 연결 없음) | 자식 프로세스 + 권한 브리지(로컬 stdio) + 동의한 경우 Claude Code 설정의 원격 AI 서비스 | 사용자가 연결한 폴더·등록된 스킬 폴더 | Renderer에 그리는 문서 내용(Markdown·PDF 추출 텍스트) | 권한 브리지 ↔ 실행 관리자 ↔ Renderer |
| 인증·인가 | 단일 로컬 사용자. 발신 창(`senderFrame`) 확인 | 실행마다 외부 처리 동의와 접근 범위 승인, 기억한 접근 허용은 범위 ⊆ 조건이며 외부 동의는 저장·대체하지 않음 | 연결 폴더·등록된 스킬 폴더 안만 | 해당 없음(읽기 표시만) | 브리지는 앱이 띄운 자식 프로세스 stdio만 받음. `requestId`는 1회용 난수 |
| 다루는 데이터 | 경로·검색어·설정 | 스킬·입력·승인 폴더에서 Claude Code가 실제 읽는 내용이 원격 처리될 수 있음. 정확한 파일 목록은 사전 확정되지 않을 수 있음 | 원본 Markdown·PDF | 문서 본문·링크·이미지 참조 | 요청 도구·범위, 허용/거부 응답 |
| 키·권한 | 없음 | Claude Code 자체 인증(앱 비보관), 외부 동의가 없으면 실행 불가 | 없음(읽기 전용) | 없음 | 없음(응답이 곧 도구 허용) |
| 입력 | 스키마 검증, 허용 키 목록, 경로는 Main 대화상자 결과만 | A-09의 명시적 동의 확인 후 인자 배열(셸 없음), 프롬프트는 stdin, 1차 허용 도구 고정([02#3](02_ARCHITECTURE.md)) | 경로 정규화·접두 검사, 심볼릭 링크 밖 이탈 차단, 파일 크기 상한(값 팀장 결정 필요) | 신뢰하지 않는 문서 내용 | `runId`+`requestId` 일치, 대기 중 요청만 |
| 체인 | Renderer XSS(문서 미리보기) → IPC 남용 | 문서 속 프롬프트 주입 → 승인된 도구 남용 | 링크 경로 조작 → 폴더 밖 읽기 | 악성 Markdown(HTML·스크립트·외부 이미지) → XSS·외부 요청 | 위조·재사용 응답 → 미승인 도구 허용 |
| 피해 범위 | A-01~A-17 능력까지 | 승인된 폴더·1차 허용 도구까지(MCP 없음) | 연결 폴더·스킬 폴더까지 | ①의 IPC 능력까지 | 해당 실행의 요청 1건 |
| 남용 | 색인 반복 → `E_BUSY` | 동시 실행 수 상한(값 팀장 결정 필요), `--max-turns` | 대용량 폴더 → 증분 색인 | 거대 문서 → 추출 텍스트 일부만 표시(A-06) | 응답 지연 → 시간 초과 시 거부(시간 값 팀장 결정 필요) |
| 로그 | 오류 코드만, 원문·스택 X | 이벤트 저장(동의 시각·표시한 서비스·승인 범위 기록, 문서 본문은 동의 로그에 복제하지 않음; 입력 원문 저장·마스킹은 Q6) | 실패 파일 경로·사유만, 본문 X | 렌더 실패 코드만 | 요청·응답·시간 초과 이벤트(`run_events`) |
| 결정 | CSP + 하드닝([02#2](02_ARCHITECTURE.md)) | 미승인 도구는 항상 권한 질의, 자동 허용 없음 | 원본 쓰기 없음 | Markdown 살균, 스크립트 금지, 외부 리소스 차단 | 1회용 `requestId`, 시간 초과 = 거부, 자동 허용 없음 |
