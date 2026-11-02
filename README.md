# Nomad-Agents-Lab

NOMAD Agent OS를 적용해 Claude Code 멀티에이전트 개발 환경을 구성하고 검증하는 저장소입니다. 애플리케이션의 제품 요구사항과 기술 스택은 아직 정해지지 않았습니다.

## 시작하기

1. 이 저장소에서 Claude Code를 실행합니다: `claude`
2. `/agents`로 사용 가능한 에이전트를 확인합니다.
3. `/agent-check`로 전역 팀 설치와 프로젝트 설정을 점검합니다.
4. 제품 범위가 정해진 뒤 `/plan <제품명>`으로 기획을 시작합니다.

## 구성

- [`AGENTS.md`](AGENTS.md): 모든 코딩 에이전트가 따르는 프로젝트 지침
- [`CLAUDE.md`](CLAUDE.md): Claude Code용 프로젝트 지침
- [`.claude/`](.claude/): Claude Code 프로젝트 설정과 영역별 규칙
- [`.codex/`](.codex/) · [`.gemini/`](.gemini/): Codex 및 Gemini CLI 프로젝트 설정
- [`tasks/`](tasks/): 작업 목록과 재진입 상태

에이전트 팀 정의와 NOMAD 명령은 전역 Claude 설정에서 제공됩니다. 전역 팀 설치가 없다면 [NOMAD Agent OS 설치 가이드](../nomad-agent-os/docs/INSTALL.md)를 참고하세요.

## 초기 기획 이력

<!-- 보존 항목: 이 절은 README를 갱신해도 삭제·수정하지 않는다. -->
- 이 프로젝트의 **초기 MVP는 GitHub Copilot으로 기획**했습니다. 기획 산출물: [`.azure/project-plan.md`](.azure/project-plan.md), [`.azure/requirements.json`](.azure/requirements.json)
