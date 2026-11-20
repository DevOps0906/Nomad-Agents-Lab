# task-007 Electron 앱 뼈대·보안 하드닝

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-003, task-004, task-005, task-006 |
| 위험도 | 높음 |
| 보안 영향 | 노출 면 |
| 담당 | builder |
| 근거 | `docs/02_ARCHITECTURE.md#1·2`, `docs/04_API.md#공통 규칙` |
| 쓰기 허용 | `app/**` (경로는 ADR-0005 채택 시 확정) |

## 할 것
- contextIsolation·sandbox·nodeIntegration 끔·CSP
- Preload IPC 허용 목록(A-01~A-17만), 입력 스키마 검증 골격
- 앱 셸·좌측 내비

## 하지 않을 것
- 기능 구현

## 완료 조건 (실행 가능한 확인)
- [ ] typecheck·lint 통과
- [ ] 허용 목록 밖 IPC 호출 거부 테스트 통과

## 계획 보완 (2026-11-20, challenger REVISE 반영 — 팀장 확정)
- 의존성: ADR-0005 버전 표 + 개발 도구 표만 설치(사용자 승인). lockfile 커밋. 앱 위치 `app/`.
- 하드닝 완료 조건 추가: contextIsolation·sandbox·nodeIntegration false·webSecurity 유지, `will-navigate`·`setWindowOpenHandler` 차단 테스트, **Main ipcMain 쪽** 허용 목록·`senderFrame` URL 검증 거부 테스트(preload 필터만으로 판정 금지), 퓨즈는 `@electron/fuses read`로 확인(RunAsNode·NodeOptions·NodeCliInspect off, OnlyLoadAppFromAsar·EmbeddedAsarIntegrityValidation on).
- RunAsNode는 끈다. 권한 브리지 실행 방식은 task-012에서 "RunAsNode 없이"를 제약으로 정한다(별도 실행 파일·Main HTTP MCP 등 재검증).
- `app.requestSingleInstanceLock()` — 두 번째 인스턴스는 첫 창을 앞으로 가져오고 종료.
- 로드 방식: prod는 커스텀 프로토콜(`app://`), file:// 금지. CSP는 dev·prod 분리 — Fluent v9(Griffel) 스타일 주입이 동작하는 최소 `style-src`를 실측으로 정하고 `script-src 'self'` 유지.
- 디자인: `design/tokens/tokens.css`를 Fluent v9 테마(createLightTheme/createDarkTheme 덮어쓰기)로 매핑(task-006 결정). `design/tokens/**`는 읽기만.
- 패키징 스모크: electron-builder로 패키지 생성 → 실행 → 창 표시 확인(asarUnpack은 task-008에서 DB 열기로 확장).
- 린트 oxlint, 테스트 vitest. 타입 검사 `tsc --noEmit`(TS 7.0.2).
