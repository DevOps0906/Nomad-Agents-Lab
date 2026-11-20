import type { IpcMain } from 'electron';
import type { z } from 'zod';
import { type ErrorCode, INVOKE_CHANNEL, failure, type InvokeResult } from '../../shared/ipc';

/** 처리기에 넘기는 호출 정보. sender는 대화상자를 발신 창의 모달로 붙일 때만 쓴다(Electron WebContents). */
export interface RouteContext {
  readonly sender: unknown;
}

/** 경로 1개 = 입력 스키마 + 서비스 호출. */
export interface Route {
  input: z.ZodType;
  handle: (input: unknown, context: RouteContext) => unknown;
}

/** 서비스가 정해진 오류 코드로 실패할 때 던진다. 그 외 예외는 E_INTERNAL. */
export class IpcError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'IpcError';
  }
}

/** 진행 중이면 E_BUSY로 거부하는 단일 잠금(대화상자 연타 방지). */
export function createBusyLock() {
  let busy = false;
  return async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (busy) throw new IpcError('E_BUSY');
    busy = true;
    try {
      return await fn();
    } finally {
      busy = false;
    }
  };
}

export type BusyLock = ReturnType<typeof createBusyLock>;

export type Routes = Readonly<Record<string, Route>>;

/** Electron IpcMainInvokeEvent 중 라우터가 쓰는 부분만. */
export interface InvokeEventLike {
  senderFrame: { url: string; parent: unknown } | null;
  sender?: unknown;
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
      return { ok: true, data: await route.handle(parsed.data, { sender: event.sender }) };
    } catch (error) {
      if (error instanceof IpcError) {
        log(`ipc failed: ${path} ${error.code}`);
        return failure(error.code);
      }
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
