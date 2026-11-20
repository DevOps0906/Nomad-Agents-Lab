// 첫 실행 데이터 위치 지정(onboarding.setDataDir). Renderer는 경로를 보내지 않고 Main 대화상자 결과만 쓴다.
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { SetDataDirResult } from '../../shared/ipc';
import { type BootOptions, type BootResult, DataStoreExistsError, createDataStore, dataDirWarnings } from '../boot/start';
import { DB_FILE_NAME } from '../db/open';
import { type BusyLock, IpcError } from '../ipc/router';
import { type FolderPolicyContext, checkFolder } from './folders';

/** Main이 보관하는 부트 상태(시작 실패는 boot_failed). */
export type MainBootState = BootResult | { readonly kind: 'error'; readonly reason: 'boot_failed' } | null;

export interface StateHolder {
  get(): MainBootState;
  set(next: MainBootState): void;
}

/** 폴더 선택 대화상자. 취소면 null. sender는 모달을 붙일 발신 창. */
export type PickFolder = (sender: unknown) => Promise<string | null>;

export interface OnboardingDeps {
  readonly state: StateHolder;
  readonly configFile: string;
  readonly policy: FolderPolicyContext;
  readonly pickFolder: PickFolder;
  readonly exclusive: BusyLock;
  readonly bootOptions?: BootOptions;
  readonly log?: (message: string) => void;
}

export function createOnboarding(deps: OnboardingDeps) {
  const log = deps.log ?? (() => {});
  const reject = (reason: string): never => {
    log(`onboarding.setDataDir rejected: ${reason}`);
    throw new IpcError('E_VALIDATION');
  };

  async function setDataDir(sender: unknown): Promise<SetDataDirResult> {
    if (deps.state.get()?.kind !== 'onboarding') throw new IpcError('E_OUT_OF_SCOPE');
    return deps.exclusive(async () => {
      const picked = await deps.pickFolder(sender);
      if (picked === null) return { status: 'canceled' };
      // 대화상자가 떠 있는 동안 상태가 바뀌었을 수 있다.
      if (deps.state.get()?.kind !== 'onboarding') throw new IpcError('E_OUT_OF_SCOPE');
      const checked = await checkFolder(picked, deps.policy);
      if ('rejected' in checked) return reject(checked.rejected);
      const { real } = checked;
      if (existsSync(path.join(real, DB_FILE_NAME))) return reject('db_exists');
      let open;
      try {
        open = await createDataStore(deps.configFile, real, deps.bootOptions);
      } catch (error) {
        if (error instanceof DataStoreExistsError) return reject('db_exists');
        throw error;
      }
      const warnings = dataDirWarnings(real, deps.policy.env);
      deps.state.set({
        kind: 'ready',
        dataDir: real,
        open,
        cleanup: { runs: 0, indexJobs: 0, sources: 0 },
        warnings,
      });
      log(`onboarding.setDataDir done warnings=${warnings.join(',') || 'none'}`);
      return { status: 'set', path: real, warnings };
    });
  }

  return { setDataDir };
}
