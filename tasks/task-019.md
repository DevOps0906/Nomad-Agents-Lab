# task-019 Markdown 색인 (A-03 일부, PDF 제외)

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 (슬라이스 1) |
| 선행 | task-018 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 |
| 담당 | builder |
| 근거 | `docs/04_API.md` A-03, `docs/02_ARCHITECTURE.md#2`, `docs/adr/0003`, `docs/diagrams/seq-indexing.mmd` |
| 쓰기 허용 | `app/src/main/indexer/**`, `app/src/main/index.ts`, `app/src/main/ipc/**`, `app/src/shared/ipc.ts`, `app/src/main/db/**`, `app/migrations/0001_init.sql`(배포 전), `app/src/renderer/**`(색인 상태 표시만), `app/tests/**`, `docs/04_API.md`(A-03), `docs/05_DATA_MODEL.md`, `docs/diagrams/erd.mmd`, `docs/01_PRD.md`(Q14 행) |

## 할 것
- 기본 제외 규칙, `index.preview`·`index.start`·`index.status`(연결 폴더 안 읽기 전용)
- Markdown 링크·위키링크·태그 추출, 해시 증분 색인, `index_jobs` 기록
- 이월(task-008): 같은 대상을 가리키는 표기(`[[a]]`·`[[a.md]]`)를 links UNIQUE(src_doc_id, dst_doc_id, kind)에 맞게 하나로 합침
- (task-018 이월) 연결 폴더 안의 홈 비밀·설정 폴더(`.ssh`·`.gnupg`·`.claude`·`.aws`·`.azure`·`.kube`·`.docker`·`.config`)는 색인에서 제외한다(상위 폴더 연결은 task-018에서 허용).

## 하지 않을 것
- PDF 텍스트 추출(슬라이스 2, task-009), OCR
- 원본 파일 수정

## 완료 조건 (실행 가능한 확인)
- [x] 샘플 폴더 색인 테스트(링크·태그·깨진 링크·표기 합치기) 통과
- [x] 연결 폴더 밖 경로 `E_OUT_OF_SCOPE` 테스트(계획 보완대로 "소스 안 junction·심볼릭 링크가 밖을 가리키면 제외" 테스트로 대체)
- [x] 변경 없는 재색인 시 처리 0건(해시 증분) 테스트

## 계획 보완 (2026-11-20, challenger REVISE 반영 — 팀장 확정)
**배치·실행**
- 위치 `app/src/main/indexer/`(02_ARCHITECTURE 기준). 별도 worker 없이 Main에서 비동기 fs + 50개 단위 트랜잭션 + 배치 사이 `setImmediate` 양보. 한 배치는 50ms 안팎이 되게 조정하고, 색인 중에도 다른 IPC가 응답하는지 테스트.
- 진행 상황은 `index.status` 폴링(Renderer 500ms). 색인 작업은 전체에서 동시 1개(`index.start` 중복은 E_BUSY), 미리보기·검색은 동시 허용. 데이터 위치 전환(task-015)은 색인 중 E_BUSY.

**순회 안전**
- 시작 시 소스 루트를 다시 realpath해 저장값과 다르면 실패(사유 코드). `lstat`으로 심볼릭 링크·junction은 따라가지 않고 제외(순환 방지 겸). 하드링크는 잔여 위험으로 기록.
- 제외: 점으로 시작하는 이름(민감 폴더 8개 포함 — 위치 무관), `$`로 시작하는 이름, `System Volume Information`, `node_modules`, 데이터 폴더. Windows 숨김·시스템 속성은 1차에서 판정하지 않는다.
- 파일 크기 상한 **5MB**(PRD Q14, 팀장 기본값 — 사용자 변경 가능). 초과는 `too_large`로 건너뜀.
- 인코딩: UTF-8(BOM 제거), UTF-16 LE/BE(BOM 있을 때), 앞 8KB에 NUL이 있으면 바이너리로 건너뜀, 잘못된 UTF-8 바이트는 대체 문자로 두고 색인.

**증분·삭제**
- size+mtime이 같으면 건너뜀, 다르면 해시 비교. `documents.parser_version`이 현재 파서 버전과 다르면 재처리.
- **완전히 끝난 순회에서만** 보지 못한 파일을 `deleted`로 바꾸고 그 문서의 tags를 지운다. 중단·실패 순회는 삭제 처리 없음.
- 실패 사유는 정해진 코드만(`too_large`·`binary`·`read_failed`·`root_changed` 등). 원문 오류·경로 일부를 Renderer로 보내지 않음.

**링크·태그**
- 스키마(배포 전 0001 수정): `links.dst_key`(정규화 대상 키) 추가, UNIQUE를 `(src_doc_id, dst_key, kind)`로. `documents.rel_path`에 COLLATE NOCASE.
- 재색인 시 해당 문서의 `kind='link'` 행만 지우고 다시 넣는다(`manual` 보존). 자기 자신 링크는 저장하지 않음.
- 해석: 매 색인 끝에 `dst_doc_id`가 NULL이거나 deleted를 가리키는 링크를 `dst_key`로 다시 해석.
- 파싱: `[[a]]`·`[[a|별칭]]`·`[[a#제목]]`·`![[a]]` → a. `[t](rel.md)`는 `%` 디코드, `#앵커` 제거, `/`·`\` 모두 허용. 코드 블록·인라인 코드 안은 무시. 확장자 생략 시 `.md`로 합침(`[[a]]`=`[[a.md]]`). 같은 소스 안에서만 해석: 같은 폴더 우선 → 경로가 짧은 것 → id 오름차순. 소스 밖(`../` 탈출)·다른 소스는 미해석으로 남김. `.pdf` 대상은 키만 저장(PDF 색인 후 해석).
- 태그: `#` 뒤 글자(영문·한글)로 시작하는 토큰만(`#123` 제외), 코드 안 제외. frontmatter `tags:`는 `[a, b]`와 `- a` 목록만 손 파서로(YAML 라이브러리 금지).

**완료 조건 보정**
- "E_OUT_OF_SCOPE 경로" 대신: 소스 안 junction·심볼릭 링크가 밖을 가리키면 제외되는 테스트.
