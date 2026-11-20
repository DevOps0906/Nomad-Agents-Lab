# task-015 설정 (S-08 전체, A-14·A-17) · 첫 실행 잔여

| 항목 | 내용 |
|---|---|
| 웨이브 | W4 (슬라이스 2) |
| 선행 | task-013, task-021, PRD Q6 결정(기록 보존·마스킹) |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 |
| 담당 | builder |
| 근거 | `docs/03_SCREENS_UX.md` S-08, `docs/04_API.md` A-14·A-17, `docs/02_ARCHITECTURE.md#5` |
| 쓰기 허용 | `app/src/renderer/{onboarding,settings}/**`, `app/src/main/settings/**` |

## 할 것
- 데이터 위치 전환(복사→검증→재시작), 스킬 폴더 추가(`dialog`)
- 기억한 허용 목록·해제(`grants.list`·`grants.revoke`), 실행 로그 보존·마스킹(Q6 결정 반영)
- S-01 잔여(task-018에서 제외한 부분), `settings.get`·`settings.set` 허용 키 검증

## 하지 않을 것
- 계정·클라우드 설정
- 첫 실행 점검·폴더 연결 재작업(task-018)

## 완료 조건 (실행 가능한 확인)
- [ ] F-01 E2E 통과(P3 측정 가능)
- [ ] 알 수 없는 설정 키 `E_VALIDATION`, 데이터 위치 전환 실패 시 원본 보존 테스트
- [ ] 기억한 허용 해제 후 재질의 확인
