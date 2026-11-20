import type { InvokePath } from '../../shared/ipc';
import type { Route } from './router';

/** 허용 경로 → 처리기. 키는 shared/ipc.ts의 INVOKE_PATHS와 같아야 한다(타입으로 강제). */
export const routes: { readonly [K in InvokePath]: Route } = {};
