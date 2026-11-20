# task-018 첫 실행 최소 (S-01: A-01, 데이터 위치, A-02 폴더 1개)

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 (슬라이스 1) |
| 선행 | task-008 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 |
| 담당 | builder (착수 전 challenger) |
| 근거 | `docs/03_SCREENS_UX.md` S-01, `docs/04_API.md` A-01·A-02, `docs/02_ARCHITECTURE.md#5` |
| 쓰기 허용 | `app/src/renderer/**`(onboarding·앱 상태 라우팅), `app/src/main/onboarding/**`, `app/src/main/sources/**`, `app/src/main/boot/**`, `app/src/main/claude/detect/**`, `app/src/main/index.ts`, `app/src/main/ipc/**`, `app/src/shared/ipc.ts`, `app/src/preload/**`(필요 시), `app/migrations/0001_init.sql`(배포 전), `app/tests/**`, `docs/04_API.md`(A-01·A-02·데이터 위치 경로·오류 코드) |

## 할 것
- `env.check`(A-01): Claude Code 설치·로그인·지원 범위 점검(T-02 결과 반영), 데이터 위치 설정 여부 반환
- 첫 실행 데이터 위치를 사용자가 Main 대화상자로 지정 → `createDataStore` 연결(현재 기본 동작 유지)
- `sources.add`(`dialog`)로 폴더 1개 연결·`sources.list`·`sources.remove`, 드라이브 루트 등 광범위 경로 `E_VALIDATION`
- S-01 상태(점검 중·실패·성공·빈 상태) 표시

## 하지 않을 것
- 데이터 위치 전환(복사→검증→재시작)과 스킬 폴더·로그 보존 설정(task-015)
- 색인 실행(task-019), 샘플 소스 외 계정·클라우드 설정

## 완료 조건 (실행 가능한 확인)
- [x] `cd app && npm run typecheck && npm run lint && npx vitest run` 통과
- [x] env.check 테스트: 미설치·미로그인·정상 3경로(가짜 CLI)
- [x] 드라이브 루트·광범위 경로 거부, Renderer 경로 직접 전달 거부 테스트
- [x] S-01 상태 화면 확인(`shot`)

## 계획 보완 (2026-11-20, challenger REVISE 반영 — 팀장 확정)
**공개 계약 (04_API에 함께 반영)**
- 경로: `env.check`(A-01), `onboarding.setDataDir`(데이터 위치 지정 — 입력 없음, Main 대화상자), `sources.add`·`sources.list`·`sources.remove`(A-02). 모든 입력 스키마 `.strict()`.
- 미설치·미로그인·지원 범위 밖은 **오류가 아니라 성공 응답의 상태 값**(`claude: 'missing'|'logged_out'|'unsupported'|'ok'`). 오류 코드는 시스템 실패에만. 새 오류 코드가 필요하면 `ErrorCode`와 04_API를 함께 고친다.
- `onboarding.setDataDir`는 Main의 `bootState.kind === 'onboarding'`일 때만 받는다(그 외 `E_OUT_OF_SCOPE`). 성공 시 bootState를 ready로 바꾸고 이후 sources.*가 쓸 DB 핸들을 갱신한다.
- 대화상자·setDataDir·sources.add는 진행 중이면 `E_BUSY`(연타 방지). 라우터가 대화상자를 보낸 창의 모달로 붙일 수 있게 핸들러에 발신 창을 넘긴다.

**CLI 탐지**
- `shell: false`, 고정 인자만. 후보는 절대경로 목록으로 확정(PATH 각 항목의 `claude.exe`, `claude.cmd`는 PATH의 Node로 직접 실행하거나 cmd.exe `/d /s /c` + 인자 고정 중 안전한 쪽을 테스트로 결정). cwd 탐색 금지(실행 cwd를 앱 소유 폴더로 고정).
- 시간 초과 10초 → 프로세스 트리 종료. 진행 중 재요청은 같은 결과를 공유.
- 버전은 숫자 비교, 하한 2.1.323. 해석 실패는 `unsupported`.
- `claude auth status --json`: `loggedIn === true` 이고 종료 코드 0이고 파싱 성공일 때만 로그인. 나머지는 모두 `logged_out`. Renderer로는 허용 필드(로그인 여부, 인증 방식 종류)만. email·orgId·stdout·stderr를 오류 객체·로그·DB에 넣지 않는다(로그 테스트로 확인).
- 테스트용 가짜 CLI 경로·대화상자 대체는 `!app.isPackaged`에서만 켜진다(패키지에서 무시됨을 테스트).

**경로 검사 (데이터 위치·연결 폴더 공통)**
- `fs.realpath.native`로 실제 경로를 확정한 뒤 판정. 거부: 드라이브 루트, UNC·`\?\`·네트워크(매핑 드라이브는 `GetDriveType` 대신 `net use` 없이 판정 가능한 범위만, 판정 불가면 경고), `%WINDIR%`, Program Files 두 곳, `%PROGRAMDATA%`, 홈 폴더 자체, AppData 전체, 앱 userData.
- 데이터 위치와 연결 폴더는 어느 방향으로든 겹치면 거부. 연결 폴더끼리도 같은 폴더(대소문자 무시)·부모/자식 관계면 거부.
- OneDrive 등 동기화 폴더는 데이터 위치에 경고만(연결 폴더는 허용).
- sources.path는 정규화 경로로 저장하고 `COLLATE NOCASE` UNIQUE(배포 전이라 0001 수정).

**createDataStore**
- 실패 시 열린 DB를 반드시 닫는다. 고른 폴더에 기존 `ssr.db`가 있으면 사용하지 않고 거부(다른 폴더 선택 안내) — 마이그레이션을 남의 DB에 적용하지 않는다.

**팀장이 정한 범위 해석 (사용자 변경 가능)**
- 샘플 소스는 슬라이스 1에서 제외(실제 폴더만).
- 연결 폴더는 여러 개 허용(겹침 검사만).
- 오류 상태(data_dir_missing·config_corrupt 등)에서는 S-01 대신 원인 문구와 "다시 시도"만 보여준다. 위치 재지정은 task-015.
- env.check(`--version`·`auth status`)는 부모 환경을 그대로 넘긴다(앱 신뢰 경계 안의 점검 명령). 스킬 실행(task-012)은 환경 변수 허용 목록이 필수다.
