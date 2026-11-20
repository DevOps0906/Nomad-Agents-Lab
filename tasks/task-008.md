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
- [x] 마이그레이션 왕복 테스트 통과
- [x] `mmd-check docs/diagrams/erd.mmd` 통과

## 계획 보완 (2026-11-20, challenger REVISE 반영 — 팀장 확정)
- 마이그레이션은 **전진 전용** + 적용 전 DB 백업(SQLite backup API, WAL 포함) + `user_version`이 앱보다 높으면 열기 거부. down 마이그레이션 만들지 않음. "왕복 테스트" = 빈 DB→최신 적용→재실행 무변경(멱등) 확인.
- 스키마 버전 정본은 `PRAGMA user_version` 하나. boot_config에는 저장하지 않는다.
- 마이그레이션은 `.sql` 파일(sql2erd로 ERD 생성 가능하게).
- FTS5 토크나이저 **trigram**(사용자 결정, PRD Q11) — 2글자 이하 검색어는 LIKE 대체 경로. doc_fts는 FK CASCADE가 안 되므로 문서 삭제·갱신 트리거로 동기화하고 테스트한다.
- 재시작 정리: 실행 중 run → interrupted, sources.status=`indexing`·미완료 index_jobs도 정리(단일 인스턴스 잠금은 task-007).
- boot_config: 임시 파일 후 rename 원자적 쓰기. data_dir 없음·드라이브 분리·JSON 손상 시 **빈 DB를 조용히 만들지 않고** 오류 화면(S-01 경로)으로 보낸다. 위치 전환은 "대기 중 전환" 필드 + 다음 시작 때 backup API로 복사. 네트워크 드라이브·동기화 폴더는 경고.
- 테이블 수는 실제 스키마 기준으로 다시 센다(boot_config는 DB 밖 JSON, doc_fts는 가상 테이블).
- 쓰기 허용에 boot 모듈 위치(`app/src/main/boot/**`)를 포함한다.
- better-sqlite3 테스트 런타임: 단위 테스트는 시스템 Node ABI로 별도 빌드하거나 Electron 런타임(`ELECTRON_RUN_AS_NODE`는 개발 테스트에서만)으로 실행 — 방식은 구현 시 정하고 README에 기록. 패키지 스모크에서 DB 열기 확인.
