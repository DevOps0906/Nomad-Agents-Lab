# task-008 SQLite 스키마·마이그레이션·boot_config

| 항목 | 내용 |
|---|---|
| 웨이브 | W1 |
| 선행 | task-007 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 |
| 담당 | builder |
| 근거 | `docs/05_DATA_MODEL.md` |
| 쓰기 허용 | `app/src/main/db/**` |

## 할 것
- 테이블 13개 마이그레이션, FTS5(토크나이저 Q11 결정 후)
- 재시작 정리(interrupted)
- `sql2erd`로 `docs/diagrams/erd.mmd` 생성

## 하지 않을 것
- 화면

## 완료 조건 (실행 가능한 확인)
- [ ] 마이그레이션 왕복 테스트 통과
- [ ] `mmd-check docs/diagrams/erd.mmd` 통과
