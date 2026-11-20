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

## 구조
| 경로 | 역할 |
|---|---|
| `src/main/index.ts` | 앱 수명주기, 단일 인스턴스 잠금, `app://` 프로토콜, 세션 잠금(권한 요청 거부·외부 네트워크 차단), 창 생성 |
| `src/main/security.ts` | webPreferences 고정값, 신뢰 출처 검사, CSP, `app://` 경로 해석, navigation·새 창·webview 차단 |
| `src/main/ipc/router.ts` | IPC 라우터: `senderFrame` 확인 → 허용 목록 → zod 입력 검증 → 처리 → 오류 코드 |
| `src/main/ipc/routes.ts` | 허용 경로 처리기(현재 비어 있음, A-01~A-17은 기능 작업에서 추가) |
| `src/preload/index.ts` | `window.ssr.invoke(path, input)` 하나만 노출. 허용 목록 밖은 Main으로 보내지 않음 |
| `src/shared/ipc.ts` | 채널 이름·허용 경로 목록·결과 타입·오류 코드(Preload와 Main 공용) |
| `src/renderer/` | 앱 셸·좌측 내비, `theme.ts`(tokens.css → Fluent 테마 오버라이드) |
| `tests/` | Main IPC 거부·senderFrame·하드닝·CSP·경로 해석·preload 테스트 |

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
