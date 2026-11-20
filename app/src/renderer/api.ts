import type { ErrorCode, InvokePath, InvokeResult } from '../shared/ipc';

/** window.ssr.invoke 래퍼. 실패는 오류 코드로 던진다(원문 없음). */
export class InvokeError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = 'InvokeError';
  }
}

export async function invoke<T>(path: InvokePath, input?: unknown): Promise<T> {
  const result = (await window.ssr.invoke(path, input)) as InvokeResult<T>;
  if (!result.ok) throw new InvokeError(result.error.code);
  return result.data;
}

export function errorCode(error: unknown): ErrorCode {
  return error instanceof InvokeError ? error.code : 'E_INTERNAL';
}
