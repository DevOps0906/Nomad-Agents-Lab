# task-011 스킬 색인·목록 (S-04, A-07·A-08)

| 항목 | 내용 |
|---|---|
| 웨이브 | W3 |
| 선행 | task-008, task-020 |
| 위험도 | 보통 |
| 보안 영향 | 없음 |
| 담당 | builder |
| 근거 | `spec S-04`, `docs/adr/0002` |
| 쓰기 허용 | `app/src/main/skills/**`, `app/src/renderer/**`(스킬 화면·내비), `app/src/main/ipc/**`, `app/src/shared/ipc.ts`, `app/src/main/index.ts`, `app/package.json`·`package-lock.json`(yaml 2.9.1만 --save-exact), `app/tests/**`, `docs/04_API.md`(A-07·A-08), `app/README.md` |

## 할 것
- `~/.claude/skills`·앱 스킬 폴더 읽기, frontmatter `ssr:` 파싱, 이름 충돌 규칙(Q12)
- 목록·상세 패널·폴더 열기

## 하지 않을 것
- 스킬 편집(3차)

## 완료 조건 (실행 가능한 확인)
- [x] 잘못된 SKILL.md가 `valid=false`로 표시되는 테스트 (`app/tests/skills.test.ts` 33건, 2026-11-20)

## 팀장 결정 (2026-11-20)
- YAML 파서 `yaml` 2.9.1(사용자 승인). `parse`는 별칭 수 제한(`maxAliasCount`)·커스텀 태그 없음·frontmatter 64KB 상한. SKILL.md 파일은 1MB 상한.
- 슬라이스 1은 사용자 `~/.claude/skills/`만 읽는다(앱 스킬 폴더는 task-015). 이름 충돌 규칙(Q12): 앱 폴더 > 사용자 폴더 — 같은 폴더 안 중복 name은 폴더 이름순 첫 번째만 유효, 나머지 `valid=false`.
- 스킬 폴더 순회는 색인기와 같은 원칙: 링크·junction 따라가지 않음, 1단계 하위 폴더의 `SKILL.md`만.
- `ssr.inputs`·`ssr.reads`·`ssr.tools`는 zod 스키마로 검증. 실패 시 `valid=false` + 사유 코드(원문 미전송). `ssr:`가 없으면 유효(자유 텍스트 입력 1칸).
- `skills.openFolder`는 name만 받고 등록된 스킬 폴더(realpath 재확인)만 `shell.openPath`.
- `last_run`은 runs 테이블에서 읽되 실행 기능 전이므로 null 허용.
