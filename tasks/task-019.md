# task-019 Markdown 색인 (A-03 일부, PDF 제외)

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 (슬라이스 1) |
| 선행 | task-018 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 |
| 담당 | builder |
| 근거 | `docs/04_API.md` A-03, `docs/02_ARCHITECTURE.md#2`, `docs/adr/0003`, `docs/diagrams/seq-indexing.mmd` |
| 쓰기 허용 | `app/src/main/index/**` |

## 할 것
- 기본 제외 규칙, `index.preview`·`index.start`·`index.status`(연결 폴더 안 읽기 전용)
- Markdown 링크·위키링크·태그 추출, 해시 증분 색인, `index_jobs` 기록
- 이월(task-008): 같은 대상을 가리키는 표기(`[[a]]`·`[[a.md]]`)를 links UNIQUE(src_doc_id, dst_doc_id, kind)에 맞게 하나로 합침
- (task-018 이월) 연결 폴더 안의 홈 비밀·설정 폴더(`.ssh`·`.gnupg`·`.claude`·`.aws`·`.azure`·`.kube`·`.docker`·`.config`)는 색인에서 제외한다(상위 폴더 연결은 task-018에서 허용).

## 하지 않을 것
- PDF 텍스트 추출(슬라이스 2, task-009), OCR
- 원본 파일 수정

## 완료 조건 (실행 가능한 확인)
- [ ] 샘플 폴더 색인 테스트(링크·태그·깨진 링크·표기 합치기) 통과
- [ ] 연결 폴더 밖 경로 `E_OUT_OF_SCOPE` 테스트
- [ ] 변경 없는 재색인 시 처리 0건(해시 증분) 테스트
