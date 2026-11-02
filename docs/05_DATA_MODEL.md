# 05 데이터 모델 — SSR+ (1차 MVP, 로컬 SQLite)

> ERD: [`diagrams/erd.mmd`](diagrams/erd.mmd) — 스키마 SQL 경로가 정해지면 `sql2erd <스키마 경로> -o docs/diagrams/erd.mmd`로 생성(손으로 그리지 않음)
> DB 파일은 S-01에서 고른 데이터 위치 폴더에 1개. 그 경로는 DB 밖 부트 설정에 둔다([`02_ARCHITECTURE.md#1`](02_ARCHITECTURE.md)).
> 원본 파일은 복제하지 않는다. 비밀값 컬럼 없음([ADR-0001](adr/0001-ai-engine-claude-code-cli.md)).

| 테이블 | 목적 | 주요 컬럼 | RLS 기준 | 비고 |
|---|---|---|---|---|
| `sources` | 연결 폴더·샘플 세트 | `id`, `kind`(`folder`·`sample`), `path`(정규화 절대 경로), `label`, `status`(`ok`·`missing`·`indexing`), `created_at`, `last_indexed_at` | 로컬 단일 사용자—해당 없음 | `path` 유일. 샘플은 `kind`로 실제 자료와 구분(project-plan#5) |
| `documents` | 색인된 Markdown·PDF 1건 | `id`, `source_id`→sources, `rel_path`, `title`, `format`(`md`·`pdf`), `size`, `mtime`, `content_hash`, `status`(`ok`·`error`·`encrypted`·`deleted`), `error`, `indexed_at` | 로컬 단일 사용자—해당 없음 | (`source_id`,`rel_path`) 유일. 해시로 증분 색인. 소스 삭제 시 연쇄 삭제 |
| `doc_fts` | 전문 검색(FTS5 가상 테이블) | `rowid`=documents.id, `title`, `body`(추출 텍스트) | 로컬 단일 사용자—해당 없음 | 토크나이저(`unicode61` / `trigram`) 한국어 검색 품질 검증 — [PRD Q11](01_PRD.md). 추출 텍스트 사본이 DB에 남음을 S-08에 고지 |
| `links` | 문서 간 관계 | `id`, `src_doc_id`→documents, `dst_doc_id`→documents(NULL 허용), `dst_raw`(원래 링크 문자열), `kind`(`link`·`manual`), `created_at` | 로컬 단일 사용자—해당 없음 | `dst_doc_id` NULL = "없는 문서" 노드(ADR-0003). `manual`만 A-16으로 추가·삭제. `folder` 관계는 저장하지 않고 `rel_path`로 조회 시 계산 |
| `tags` | 문서-태그 연결 | `doc_id`→documents, `name`(정규화 소문자), `origin`(`frontmatter`·`inline`) | 로컬 단일 사용자—해당 없음 | PK(`doc_id`,`name`). 태그 노드 = `name` 고유값. 색상 = 최상위 태그, 없으면 루트 폴더(ADR-0003). 사용자 지정은 `settings.color_overrides` |
| `skills` | `SKILL.md` 색인 캐시 | `id`, `name`, `root`(`user`·`app`), `path`, `description`, `ssr_json`(frontmatter `ssr:`), `content_hash`, `mtime`, `valid`, `error`, `scanned_at` | 로컬 단일 사용자—해당 없음 | 원본은 파일(ADR-0002). 같은 `name`이 두 위치에 있을 때 우선순위 — [PRD Q12](01_PRD.md) |
| `runs` | 스킬 실행 1건 | `id`, `skill_name`, `skill_hash`, `input_json`, `scope_json`(폴더·도구·MCP), `provider_label`, `external_processing_consent_at`, `grant_id`→grants(NULL), `retry_of`→runs(NULL), `status`(`starting`·`running`·`waiting_permission`·`succeeded`·`partial`·`failed`·`cancelled`), `error_code`, `claude_version`, `session_id`, `exit_code`, `result_summary`, `started_at`, `ended_at` | 로컬 단일 사용자—해당 없음 | 매 실행의 외부 처리 동의가 없으면 실행 불가. `provider_label`은 Claude Code에 설정된 서비스에 관해 UI가 고지한 값. 동의 시각·실행 범위 외에 문서 본문은 동의 로그에 복제하지 않는다. `input_json` 원문 저장·마스킹 여부 — [PRD Q6](01_PRD.md). 앱 재시작 시 `starting`·`running`·`waiting_permission`은 모두 `failed`(`error_code`=`interrupted`)로 정리. 성공률 정의: [`00_LEAN.md#통과 기준`](00_LEAN.md) |
| `run_events` | 실행 이벤트 스트림 | `run_id`→runs, `seq`, `ts`, `type`(`external_processing_consent`·`system`·`assistant`·`tool_use`·`tool_result`·`permission_request`·`permission_response`·`result`·`stderr`·`error`), `request_id`(권한 요청 짝), `payload_json` | 로컬 단일 사용자—해당 없음 | PK(`run_id`,`seq`). 동의 이벤트는 표시한 서비스·승인 범위·동의 시각을 기록하고 본문을 넣지 않는다. stream-json 줄 → 1행. 보존 기간 경과 시 일괄 삭제(기본값 [PRD Q6](01_PRD.md)) |
| `grants` | 기억한 접근 허용(스킬별 범위) | `id`, `skill_name`, `folders_json`(source id 목록), `tools_json`, `mcp_json`, `created_at`, `last_used_at`, `revoked_at` | 로컬 단일 사용자—해당 없음 | 새 실행 범위 ⊆ 허용 범위일 때만 재사용, 넓어지면 다시 질의(ADR-0006). 매 실행 외부 처리 동의는 절대 grants에 저장하거나 대체하지 않는다. 해제는 `revoked_at` 기록. `mcp_json`은 후속용으로 1차는 항상 빈 값(1차는 MCP 사용 안 함, [`02_ARCHITECTURE.md`](02_ARCHITECTURE.md)) |
| `settings` | 앱 설정 키-값 | `key`, `value_json`, `updated_at` | 로컬 단일 사용자—해당 없음 | 허용 키: 스킬 폴더 목록, 폴더 관계 표시, 동작 감소, 로그 보존 일수, `max_turns`, `color_overrides`(태그·폴더→색상). 데이터 위치는 여기 아님(부트 설정) |
| `boot_config` | (DB 밖 JSON 파일) 데이터 위치 등 DB를 열기 전에 필요한 설정 | `data_dir`, `schema_version` | 로컬 단일 사용자—해당 없음 | 위치: `%APPDATA%` 앱 폴더. 데이터 위치 전환 절차는 [02#5](02_ARCHITECTURE.md) |
| `index_jobs` | 색인 작업 1건 | `id`, `source_id`→sources, `started_at`, `finished_at`, `status`, `counts`(처리 건수 JSON) | 로컬 단일 사용자—해당 없음 | 색인 처리 시간 지표의 측정원([`01_PRD.md#5`](01_PRD.md)). 소스 삭제 시 연쇄 삭제 |
| `usage_events` | 사용 이벤트(로컬 지표용) | `id`, `type`(`onboarding_start`·`onboarding_done`·`search`·`preview`), `ts` | 로컬 단일 사용자—해당 없음 | **로컬 전용, 외부 전송 없음**. 사용일·첫 검색 시간 측정원([`00_LEAN.md#통과 기준`](00_LEAN.md)) |

## 인덱스·제약 (구현 시)
- 외래 키 강제(`PRAGMA foreign_keys=ON`), WAL 모드.
- 인덱스: `documents(source_id)`, `links(src_doc_id)`, `links(dst_doc_id)`, `tags(name)`, `runs(started_at)`, `runs(skill_name)`, `grants(skill_name)`.
- 스키마 버전은 `PRAGMA user_version`으로 관리하고 마이그레이션은 순번 SQL 파일로 둔다.
