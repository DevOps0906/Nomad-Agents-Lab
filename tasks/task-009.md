# task-009 색인 보강: PDF 등 (A-03 잔여)

| 항목 | 내용 |
|---|---|
| 웨이브 | W2 (슬라이스 2) |
| 선행 | task-019 |
| 위험도 | 높음 |
| 보안 영향 | 민감 데이터 |
| 담당 | builder |
| 근거 | `docs/04_API.md` A-03, `docs/adr/0003`, `docs/diagrams/seq-indexing.mmd` |
| 쓰기 허용 | `app/src/main/index/**` |

## 할 것
- PDF 텍스트 추출과 그 밖의 형식 보강(task-019에서 제외한 부분)
- 추출 실패 파일을 `index.status` 실패 목록에 사유와 함께 기록

## 하지 않을 것
- 원본 파일 수정, OCR
- 폴더 연결(task-018)·Markdown 색인(task-019) 재작업

## 완료 조건 (실행 가능한 확인)
- [ ] PDF 샘플 색인·검색 테스트 통과(텍스트 PDF, 손상 PDF 실패 사유)
- [ ] 기존 task-019 색인 테스트 회귀 없음
- [ ] 연결 폴더 밖 경로 `E_OUT_OF_SCOPE` 테스트 유지
