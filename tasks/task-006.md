# task-006 디자인 토큰·DESIGN.md (데스크톱 우선)

| 항목 | 내용 |
|---|---|
| 웨이브 | W0 |
| 선행 | task-003 |
| 위험도 | 낮음 |
| 보안 영향 | 없음 |
| 담당 | designer (+codex-designer 교차 검토) |
| 근거 | `spec S-02`, `spec S-03`, `.azure/project-plan.md#6` |
| 쓰기 허용 | `docs/DESIGN.md`, `design/tokens/**` |

## 할 것
- Fluent UI v9 기반 토큰, 분야 색상 팔레트(색 외 단서 포함), 3D 그래프·2D/목록 전환·외부 처리 동의 UI 패턴
- 반응형은 데스크톱 우선. 좁은 창에서도 핵심 플로우가 동작하는 기준을 정의(모바일 전용 앱은 범위 밖)
- `design-preview` 미리보기

## 하지 않을 것
- 컴포넌트 구현

## 완료 조건 (실행 가능한 확인)
- [ ] 미리보기 HTML 사용자 확인
- [ ] 대비 WCAG AA
