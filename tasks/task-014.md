# task-014 대시보드 (S-02, A-15) · 실행 기록 잔여

| 항목 | 내용 |
|---|---|
| 웨이브 | W4 (슬라이스 2) |
| 선행 | task-021 |
| 위험도 | 보통 |
| 보안 영향 | 없음 |
| 담당 | builder |
| 근거 | `docs/03_SCREENS_UX.md` S-02, `docs/04_API.md` A-15 |
| 쓰기 허용 | `app/src/renderer/{runs,dashboard}/**`, `app/src/main/dashboard/**` |

## 할 것
- 대시보드 `dashboard.summary`(7d/30d: 소스·문서 수, 색인 실패, 최근 수정 문서, 최근 실행, 상태별 수)
- 실행 기록 화면에 정렬 등 task-021에서 제외한 잔여 보강
- `usage_events` 기록(로컬 전용)

## 하지 않을 것
- 외부 분석 도구
- 실행 목록·상세 재작업(task-021)

## 완료 조건 (실행 가능한 확인)
- [ ] S-02·S-06 상태 4종 확인(`shot`)
- [ ] 기간 7d/30d 집계 테스트, `usage_events`에 네트워크 전송 없음 확인
