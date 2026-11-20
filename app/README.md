# SSR+ 데스크톱 앱 (`app/`)

Electron 45.4.1 · React 19.3.1 · TypeScript 7.0.2 · Vite 8.3.8(electron-vite 6.0.0) · Fluent UI v9 9.75.2. 버전 근거: [ADR-0005](../docs/adr/0005-desktop-stack.md).
패키지 관리자는 npm(`package-lock.json` 커밋). 모든 버전은 정확히 고정한다(`--save-exact`).

## 명령
| 목적 | 명령 |
|---|---|
| 설치 | `npm ci` (@types/react·react-dom 19.3.0 포함) |
| 개발 실행(HMR) | `npm run dev` |
| 린트 (oxlint 1.94.0, 경고도 실패) | `npm run lint` |
| 타입 검사 (`tsc --noEmit`) | `npm run typecheck` |
| 테스트 (vitest 5.1.1) | `npm test` |
| 빌드 (`out/main` · `out/preload` · `out/renderer`) | `npm run build` |
| 개발용 스모크(CSP 위반·Fluent 스타일 측정, 화면 저장) | `npm run build && npm run smoke -- <출력폴더>` |
| 패키지(Windows, 설치 파일 없이 폴더) | `npm run package` → `dist/win-unpacked/SSR.exe` |
| 퓨즈 확인 | `npm run fuses:read` |
| ERD 재생성(스키마 바뀌면, 저장소 루트에서) | `sql2erd app/migrations -o docs/diagrams/erd.mmd` |
| DB 패키지 스모크 | 아래 "DB" 절 |

## 구조
| 경로 | 역할 |
|---|---|
| `src/main/index.ts` | 앱 수명주기(종료 때 색인 중단 후 DB 닫기, 시작 때 `bootDataStore`로 DB 열기·재시작 정리, 종료 때 닫기 — 실패는 상태로 보관해 env.check가 알림), IPC 서비스 조립(env.check·setDataDir·sources, 폴더 대화상자는 발신 창의 모달), 단일 인스턴스 잠금, `app://` 프로토콜, 세션 잠금(권한 요청 거부·외부 네트워크 차단), 창 생성 |
| `src/main/security.ts` | webPreferences 고정값, 신뢰 출처 검사, CSP, `app://` 경로 해석, navigation·새 창·webview 차단 |
| `src/main/ipc/router.ts` | IPC 라우터: `senderFrame` 확인 → 허용 목록 → zod 입력 검증 → 처리(발신 창 전달) → 오류 코드(`IpcError`), 대화상자 연타 잠금(`createBusyLock`, `E_BUSY`) |
| `src/main/ipc/routes.ts` | `createRoutes(deps)`: 허용 경로 처리기(env.check·onboarding.setDataDir·sources.list/add/remove, 입력은 모두 `.strict()`) |
| `src/main/claude/detect/` | Claude Code 점검(A-01): PATH 절대경로 후보(npm 심은 cmd.exe 없이 패키지 실행 파일로), 셸 없음·고정 인자·cwd=userData·10초 초과 시 트리 종료, 버전 숫자 비교(하한 2.1.323), `auth status`는 로그인 여부·인증 방식만 |
| `src/main/onboarding/` | 경로 검사(`folders.ts`: 원본 입력+realpath 판정, 거부 목록·겹침), 데이터 위치 지정(`service.ts`), env.check 조립(`envCheck.ts`) |
| `src/main/sources/` | 연결 폴더 list·add·remove(A-02) |
| `src/main/indexer/` | Markdown 색인(A-03): `walk.ts` 읽기 전용 순회(링크·junction 제외, 기본 제외 규칙, 읽기 실패는 불완전 순회), `parse.ts` 인코딩 판정·선형 스캐너로 제목·링크·태그 추출, `resolve.ts` 같은 소스 안 링크 재해석, `service.ts` 작업 1개 잠금·50개 단위 트랜잭션·증분(size+mtime→해시→parser_version)·완전한 순회에서만 삭제 표시 |
| `src/main/brain/` | 목록 검색·미리보기(A-04·A-06): `service.ts` FTS 검색(구문 오류는 일반 텍스트 재시도, 3글자 미만 LIKE)·소스/태그/형식 필터·페이지, 미리보기 텍스트 4000자·관련 노드, 원본 열기는 ok·`.md`·realpath 재확인 뒤 `shell.openPath`(응답에 절대 경로 없음). 화면은 `renderer/SearchList.tsx`(상태 4종·키보드 ↓/↑/Enter/Esc) |
| `src/preload/index.ts` | `window.ssr.invoke(path, input)` 하나만 노출. 허용 목록 밖은 Main으로 보내지 않음 |
| `src/shared/ipc.ts` | 채널 이름·허용 경로 목록·결과 타입·오류 코드(Preload와 Main 공용) |
| `src/renderer/` | 앱 상태 라우팅(점검 중·S-01 마법사·연결 폴더 0개면 3단계 재개·시작 오류·셸), `Onboarding.tsx`(S-01), `theme.ts`(tokens.css → Fluent 테마 오버라이드) |
| `src/main/db/` | SQLite 열기(WAL·FK·버전 검사·백업·마이그레이션), FTS 검색·본문 쓰기, 재시작 정리 |
| `src/main/boot/` | 부트 설정(`userData/boot_config.json`) 읽기·원자적 쓰기, 시작 흐름·대기 중 전환·위치 경고, 첫 실행 `createDataStore`(기존 ssr.db 거부, 설정 쓰기 실패 시 만든 DB 삭제), `devOverrides.ts`(패키지 안 된 실행에서만 `SSR_FAKE_CLAUDE`·`SSR_FAKE_PICK_DIR`) |
| `migrations/` | 순번 SQL(`NNNN_name.sql`, 전진 전용). ERD는 `docs/diagrams/erd.mmd` |
| `tests/` | Main IPC 거부·senderFrame·하드닝·CSP·경로 해석·preload, DB·부트, Claude 점검(가짜 CLI)·env.check·경로 검사·데이터 위치·연결 폴더 테스트. `tests/smoke/`는 DB 패키지 스모크 진입점 |

## 보안 설정 요약
- webPreferences: `contextIsolation`·`sandbox` 켬, `nodeIntegration` 끔, `webSecurity` 유지, `webviewTag` 끔.
- 로드: prod는 `app://bundle/`(file:// 쓰지 않음), dev는 `ELECTRON_RENDERER_URL`(패키지 안 된 실행에서만).
- CSP(prod, 응답 헤더): `default-src 'none'; style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'self'; connect-src 'self'`
  - style-src 해시는 빈 문자열의 sha256이다. Griffel·FluentProvider는 빈 `<style>`을 만든 뒤 CSSOM `insertRule`로 규칙을 넣는다. `'self'`만 두면 빈 `<style>` 11개가 막혀 Fluent 스타일이 전부 빠지고, 이 해시만 더하면 위반 0건으로 동작한다(2026-11-20 실측). `'unsafe-inline'`은 쓰지 않는다.
  - `<style>`에 글자를 직접 넣거나 `style` 속성 문자열을 쓰는 라이브러리를 들이면 다시 측정한다.
- CSP(dev, 승인됨): `script-src 'self' 'unsafe-inline'`·`style-src 'self' 'unsafe-inline'`, `connect-src`에 dev 서버 ws만 추가. 근거: React Refresh preamble이 인라인 스크립트이고 Vite가 CSS를 글자가 든 `<style>`로 주입한다(해시와 같이 두면 unsafe-inline이 무시되므로 dev는 해시 없음). 패키지 안 된 실행에서만 쓰며 dev 실측 위반 0건(2026-11-20).
- 신뢰하지 않는 발신 프레임(senderFrame) 거부 코드는 `E_OUT_OF_SCOPE`(임시, 승인됨). 근거: 04_API 공통 오류에 발신자 거부 전용 코드가 없어 '허용 범위 밖'에 가장 가까운 코드를 쓴다.
- 퓨즈(electron-builder `electronFuses`): RunAsNode·NodeOptions·NodeCliInspect 끔, OnlyLoadAppFromAsar·EmbeddedAsarIntegrityValidation 켬, GrantFileProtocolExtraPrivileges 끔.
- 단일 인스턴스: 두 번째 실행은 첫 창을 앞으로 가져오고 종료한다.

## 디자인 토큰
`design/tokens/tokens.css`(정본, 읽기만)를 Renderer에서 import한다. Tailwind를 쓰지 않으므로 빌드 플러그인(`electron.vite.config.mts`의 `ssr-tokens-css`)이 `@theme {`를 `:root {`로만 바꾼다. Fluent 테마는 `webLightTheme`/`webDarkTheme`에 `var(--color-*)` 값을 덮어쓴다(`src/renderer/theme.ts`). 근거(승인됨): tokens.css 머리말이 webLightTheme/webDarkTheme 오버라이드를 원천으로 지정했고, createLightTheme용 브랜드 16단계 색은 토큰에 없다.

## DB (task-008)
better-sqlite3 13.2.0(SQLite 3.54.1, FTS5 trigram). 파일은 데이터 위치 폴더의 `ssr.db` 1개, 위치는 DB 밖 `boot_config.json`.
- **테스트 런타임**: better-sqlite3 13.2.0은 N-API 사전 빌드(`prebuilds/<platform>-<arch>.node`)를 함께 배포해 시스템 Node(26.13.1)와 Electron 45.4.1(Node 24.22.3) ABI 모두에서 같은 파일이 그대로 동작한다(2026-11-20 실측). 그래서 `npm test`는 시스템 Node에서 실행하고 `ELECTRON_RUN_AS_NODE`·재빌드를 쓰지 않는다. `@electron/rebuild`는 설치하지 않았고, electron-builder도 `npmRebuild: false`.
- **번들**: Main은 의존성을 번들하므로(`externalizeDeps: false`) better-sqlite3 기본 addon 탐색(`__dirname` 기준)이 깨진다. Main에서는 `openDatabase(file, { nativeBinding: bundledNativeBindingPath(__dirname) })`로 addon을 직접 불러 넘긴다. 패키지에는 `prebuilds/win32-*.node`만 싣고 `asarUnpack`으로 asar 밖에 둔다.
- **마이그레이션**: `migrations/*.sql`을 빌드 때 번들에 넣는다(`import.meta.glob ?raw`). 스키마 버전 정본은 `PRAGMA user_version` 하나. 적용할 파일이 있으면 backup API로 `ssr.db.v<이전>-<UTC시각>.bak`를 먼저 만들고, `user_version`이 앱보다 높으면 열지 않는다. 적용한 파일은 고치지 않고 다음 번호를 추가한다.
- **검색**: 3글자 이상 검색어는 `doc_fts MATCH`, 3글자 미만이 섞이면 LIKE 대체 경로(`src/main/db/fts.ts`). `doc_fts`는 documents 트리거로 동기화한다.
- **DB 패키지 스모크**(패키지된 Electron에서 addon 로드·마이그레이션·FTS·재시작 열기 확인, 임시 폴더만 사용):
  ```
  npm run build
  npx electron-vite build --config tests/smoke/electron.vite.smoke.mts
  npx electron-builder --win dir --config.directories.output=<임시폴더> --config.extraMetadata.main=out/smoke/db-smoke.js
  <임시폴더>/win-unpacked/SSR.exe   # 출력 "[db-smoke] {"ok":true,...}", 종료 코드 0
  ```
