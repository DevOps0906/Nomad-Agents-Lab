# task-009 로컬 폴더 연결·색인 (A-02·A-03)

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 |
| 선행 | task-008 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 |
| 담당 | builder |
| 근거 | `docs/04_API.md` A-02·A-03, `docs/adr/0003`, `docs/diagrams/seq-indexing.mmd` |
| 쓰기 허용 | `app/src/main/index/**` |

## 할 것
- Main 대화상자로만 폴더 추가, 기본 제외 규칙, `index.preview`
- Markdown 링크·위키링크·태그 추출, PDF 텍스트 추출
- 해시 증분 색인, `index_jobs` 기록

## 하지 않을 것
- 원본 파일 수정
- OCR

## 완료 조건 (실행 가능한 확인)
- [ ] 샘플 폴더 색인 테스트(링크·태그·깨진 링크) 통과
- [ ] 연결 폴더 밖 경로 `E_OUT_OF_SCOPE` 테스트
