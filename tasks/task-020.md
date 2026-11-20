# task-020 목록 검색 화면 (S-03 목록 경로, A-04·A-06)

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 (슬라이스 1) |
| 선행 | task-019 |
| 위험도 | 보통 |
| 보안 영향 | 노출 면 |
| 담당 | builder |
| 근거 | `docs/03_SCREENS_UX.md` S-03, `docs/04_API.md` A-04·A-06 |
| 쓰기 허용 | `app/src/renderer/brain/**`, `app/src/main/brain/**` |

## 할 것
- `search.query`(FTS 검색·필터, 구문 오류는 일반 텍스트 재시도), 결과 목록
- `doc.preview` 미리보기 Markdown 살균(추출 텍스트 일부만), `doc.openExternal`
- 키보드로 결과 목록→미리보기 이동, S-03 상태 4종

## 하지 않을 것
- 3D·2D 그래프, 수동 링크 추가·삭제(슬라이스 2, task-010)

## 완료 조건 (실행 가능한 확인)
- [ ] `cd app && npm run typecheck && npm run lint && npx vitest run` 통과
- [ ] 미리보기 스크립트 실행 차단 테스트
- [ ] 연결 폴더 밖·삭제된 문서 `E_OUT_OF_SCOPE`/`E_NOT_FOUND` 테스트
- [ ] 목록 경로 S-03 상태 4종 화면 확인(`shot`), 키보드만으로 검색→미리보기
