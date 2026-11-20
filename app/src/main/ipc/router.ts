import type { IpcMain } from 'electron';
import type { z } from 'zod';
import { INVOKE_CHANNEL, failure, type InvokeResult } from '../../shared/ipc';

/** 경로 1개 = 입력 스키마 + 서비스 호출. */
export interface Route {
  input: z.ZodType;
  handle: (input: unknown) => unknown;
}

export type Routes = Readonly<Record<string, Route>>;

/** Electron IpcMainInvokeEvent 중 라우터가 쓰는 부분만. */
export interface InvokeEventLike {
  senderFrame: { url: string; parent: unknown } | null;
}

export type InvokeHandler = (
  event: InvokeEventLike,
  path: unknown,
  input: unknown,
) => Promise<InvokeResult>;

interface RouterOptions {
  routes: Routes;
  isTrustedUrl: (url: string) => boolean;
  /** 오류 코드와 경로만 남긴다. 원문·스택은 Renderer로 보내지 않는다. */
  log?: (message: string) => void;
}

/**
 * IPC 라우터: 발신 프레임 확인 → 허용 목록 → 입력 스키마 검증 → 서비스 호출 → 오류 코드 변환.
 * Preload 필터와 별개로 Main에서 다시 막는다.
 */
export function createInvokeHandler({ routes, isTrustedUrl, log = () => {} }: RouterOptions): InvokeHandler {
  return async (event, path, input) => {
    const frame = event.senderFrame;
    if (!frame || frame.parent !== null || !isTrustedUrl(frame.url)) {
      log(`ipc rejected: untrusted sender`);
      return failure('E_OUT_OF_SCOPE');
    }
    if (typeof path !== 'string' || !Object.hasOwn(routes, path)) {
      log(`ipc rejected: unknown path`);
      return failure('E_VALIDATION');
    }
    const route = routes[path] as Route;
    const parsed = route.input.safeParse(input);
    if (!parsed.success) {
      log(`ipc rejected: invalid input for ${path}`);
      return failure('E_VALIDATION');
    }
    try {
      return { ok: true, data: await route.handle(parsed.data) };
    } catch {
      log(`ipc failed: ${path} E_INTERNAL`);
      return failure('E_INTERNAL');
    }
  };
}

export function registerIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  handler: InvokeHandler,
): void {
  ipcMain.handle(INVOKE_CHANNEL, (event, path: unknown, input: unknown) =>
    handler(event, path, input),
  );
}
