// A-01 env.check 조립: 시작 상태(데이터 위치) + Claude Code 점검. 경로·원문은 넣지 않는다.
import type { ClaudeStatus, EnvCheckResult } from '../../shared/ipc';
import { MIN_CLAUDE_VERSION } from '../claude/detect';
import type { MainBootState } from './service';

export interface EnvCheckDeps {
  readonly state: () => MainBootState;
  /** 시작 흐름을 다시 돌린다(오류 상태의 "다시 시도"). */
  readonly reboot: () => Promise<void>;
  readonly checkClaude: () => Promise<ClaudeStatus>;
  readonly log?: (message: string) => void;
}

export function createEnvCheck(deps: EnvCheckDeps): () => Promise<EnvCheckResult> {
  let rebooting: Promise<void> | null = null;
  return async () => {
    // 오류 상태에서 부르면 시작 흐름을 한 번 더 돌린다(드라이브 재연결 등). 동시 요청은 같은 재시작을 기다린다.
    if (deps.state()?.kind === 'error') {
      rebooting ??= deps.reboot().finally(() => {
        rebooting = null;
      });
      await rebooting;
    }
    const claude = await deps.checkClaude();
    deps.log?.(`env.check claude=${claude.claude} version=${claude.version ?? 'none'}`);
    const state = deps.state();
    return {
      ...claude,
      minVersion: MIN_CLAUDE_VERSION,
      dataDir: state?.kind === 'ready' ? 'set' : state?.kind === 'onboarding' ? 'unset' : 'error',
      bootError: state?.kind === 'error' ? state.reason : state === null ? 'boot_failed' : null,
    };
  };
}
