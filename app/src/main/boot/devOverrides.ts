import path from 'node:path';
import type { Launcher } from '../claude/detect';

/**
 * 개발·테스트용 대체(패키지 안 된 실행에서만). 패키지된 앱은 환경 변수가 있어도 무시한다.
 * - SSR_FAKE_CLAUDE: 가짜 CLI 절대경로(.js/.mjs/.cjs면 PATH의 node.exe로 실행)
 * - SSR_FAKE_PICK_DIR: 폴더 선택 대화상자 대신 돌려줄 절대경로(이 값도 일반 경로 검사를 그대로 거친다)
 */
export interface DevOverrides {
  readonly claude?: Launcher;
  readonly pickDir?: string;
}

export function devOverrides(isPackaged: boolean, env: NodeJS.ProcessEnv, nodeFile: string | null): DevOverrides {
  if (isPackaged) return {};
  const fake = env['SSR_FAKE_CLAUDE'];
  const pick = env['SSR_FAKE_PICK_DIR'];
  let claude: Launcher | undefined;
  if (fake && path.isAbsolute(fake)) {
    if (!/\.[cm]?js$/i.test(fake)) claude = { file: fake, prefixArgs: [] };
    else if (nodeFile) claude = { file: nodeFile, prefixArgs: [fake] };
  }
  return {
    ...(claude ? { claude } : {}),
    ...(pick && path.isAbsolute(pick) ? { pickDir: pick } : {}),
  };
}
