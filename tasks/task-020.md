# task-020 목록 검색 화면 (S-03 목록 경로, A-04·A-06)

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 (슬라이스 1) |
| 선행 | task-019 |
| 위험도 | 보통 |
| 보안 영향 | 노출 면 |
| 담당 | builder |
| 근거 | `docs/03_SCREENS_UX.md` S-03, `docs/04_API.md` A-04·A-06 |
| 쓰기 허용 | `app/src/renderer/**`(brain 화면·내비 연결), `app/src/main/brain/**`, `app/src/main/db/fts.ts`(searchDocuments 이동 가능), `app/src/main/ipc/**`, `app/src/shared/ipc.ts`, `app/src/main/index.ts`, `app/tests/**`, `docs/04_API.md`(A-04·A-06) |

## 할 것
- `search.query`(FTS 검색·필터, 구문 오류는 일반 텍스트 재시도), 결과 목록
- `doc.preview` 미리보기 Markdown 살균(추출 텍스트 일부만), `doc.openExternal`
- 키보드로 결과 목록→미리보기 이동, S-03 상태 4종

## 하지 않을 것
- 3D·2D 그래프, 수동 링크 추가·삭제(슬라이스 2, task-010)

## 완료 조건 (실행 가능한 확인)
- [x] `cd app && npm run typecheck && npm run lint && npx vitest run` 통과
- [x] 미리보기 스크립트 실행 차단 테스트
- [x] 연결 폴더 밖·삭제된 문서 `E_OUT_OF_SCOPE`/`E_NOT_FOUND` 테스트
- [x] 목록 경로 S-03 상태 4종 화면 확인(`shot`), 키보드만으로 검색→미리보기

## 팀장 결정 (2026-11-20)
- 미리보기는 **HTML로 렌더링하지 않는다**: 추출 텍스트 일부를 React 텍스트 노드로만 표시(새 의존성 0, 스크립트·링크·이미지 실행 경로 없음). Markdown 서식 렌더링은 필요해지면 의존성 승인 후 별도 작업.
- `doc.openExternal`은 docId만 받고, 연결 폴더 안(읽기 직전 realpath 재확인)·status='ok'·확장자 `.md`(이후 `.pdf`)만 `shell.openPath`. 그 외 E_OUT_OF_SCOPE/E_NOT_FOUND.
- 검색 결과 행에 절대 경로를 보내지 않는다(소스 이름 + 상대 경로).
- 잔여 위험: `doc.openExternal`은 열기 직전 realpath·lstat(일반 파일)·DB 재확인을 하지만, 그 확인과 `shell.openPath` 사이의 짧은 교체(TOCTOU)는 막지 못한다(로컬 단일 사용자 가정).
