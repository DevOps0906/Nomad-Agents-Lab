# task-011 스킬 색인·목록 (S-04, A-07·A-08)

| 항목 | 내용 |
|---|---|
| 웨이브 | W3 |
| 선행 | task-008 |
| 위험도 | 보통 |
| 보안 영향 | 없음 |
| 담당 | builder |
| 근거 | `spec S-04`, `docs/adr/0002` |
| 쓰기 허용 | `app/src/main/skills/**`, `app/src/renderer/skills/**` |

## 할 것
- `~/.claude/skills`·앱 스킬 폴더 읽기, frontmatter `ssr:` 파싱, 이름 충돌 규칙(Q12)
- 목록·상세 패널·폴더 열기

## 하지 않을 것
- 스킬 편집(3차)

## 완료 조건 (실행 가능한 확인)
- [ ] 잘못된 SKILL.md가 `valid=false`로 표시되는 테스트
