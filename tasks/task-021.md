# task-021 실행 기록 목록·상세 (S-06·S-07 기록 부분, A-12·A-13)

| 항목 | 내용 |
|---|---|
| 웨이브 | W3 (슬라이스 1) |
| 선행 | task-013 |
| 위험도 | 보통 |
| 보안 영향 | 민감 데이터 |
| 담당 | builder |
| 근거 | `docs/03_SCREENS_UX.md` S-06·S-07, `docs/04_API.md` A-12·A-13 |
| 쓰기 허용 | `app/src/renderer/runs/**`, `app/src/main/history/**` |

## 할 것
- `runs.list`(검색·상태·스킬 필터·기간·페이지)와 목록 화면
- `runs.get`·`runs.events`(seq 순) 기반 종료된 실행 상세·이벤트 타임라인 열람
- 실행 기록 화면 상태 4종

## 하지 않을 것
- 실행 중 타임라인·권한 응답·취소(task-013), 대시보드·`usage_events`(task-014)
- 기록 보존·마스킹 정책 변경(PRD Q6, task-015 전 결정)

## 완료 조건 (실행 가능한 확인)
- [ ] `cd app && npm run typecheck && npm run lint && npx vitest run` 통과
- [ ] task-013 실행 1건이 목록·상세에 표시되는 통합 테스트
- [ ] 없는 runId `E_NOT_FOUND`, 잘못된 기간 `E_VALIDATION` 테스트
- [ ] S-06·S-07 기록 부분 상태 확인(`shot`)
