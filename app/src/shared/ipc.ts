// Renderer ↔ Main IPC 공통 정의 (docs/04_API.md#공통 규칙).
// Preload와 Main이 같은 허용 목록을 쓴다. A-01~A-17 경로는 해당 기능 작업에서 추가한다.

/** Preload가 Main으로 보내는 유일한 invoke 채널. 경로 이름은 인자로 전달한다. */
export const INVOKE_CHANNEL = 'ssr:invoke';

/** 허용된 invoke 경로 이름 목록. 이 단계에서는 비어 있다. */
export const INVOKE_PATHS = [] as const;

export type InvokePath = (typeof INVOKE_PATHS)[number];

export type ErrorCode =
  | 'E_VALIDATION'
  | 'E_NOT_FOUND'
  | 'E_OUT_OF_SCOPE'
  | 'E_CONSENT_REQUIRED'
  | 'E_BUSY'
  | 'E_INTERNAL';

export type InvokeResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode } };

export function isInvokePath(path: unknown): path is InvokePath {
  return typeof path === 'string' && (INVOKE_PATHS as readonly string[]).includes(path);
}

export function failure(code: ErrorCode): InvokeResult<never> {
  return { ok: false, error: { code } };
}

/** contextBridge로 Renderer에 노출하는 API 모양. */
export interface SsrApi {
  invoke(path: string, input?: unknown): Promise<InvokeResult>;
}
