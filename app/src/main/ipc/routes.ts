import { z } from 'zod';
import type {
  EnvCheckResult,
  IndexPreview,
  IndexStartResult,
  IndexStatus,
  InvokePath,
  SetDataDirResult,
  SourceAddResult,
  SourceItem,
} from '../../shared/ipc';
import type { Route, RouteContext } from './router';

/** 서비스 묶음. index.ts가 실제 구현을, 테스트가 가짜를 넣는다. */
export interface RouteDeps {
  envCheck(): Promise<EnvCheckResult>;
  setDataDir(sender: unknown): Promise<SetDataDirResult>;
  sources: {
    list(): SourceItem[];
    add(sender: unknown): Promise<SourceAddResult>;
    remove(sourceId: number): unknown;
  };
  index: {
    preview(sourceId: number): Promise<IndexPreview>;
    start(sourceId?: number): IndexStartResult;
    status(): IndexStatus;
  };
}

function route<S extends z.ZodType>(input: S, handle: (input: z.infer<S>, context: RouteContext) => unknown): Route {
  return { input, handle: (value, context) => handle(value as z.infer<S>, context) };
}

/** 입력 없음: undefined 또는 빈 객체만(키가 하나라도 있으면 거부). */
const NoInput = z.object({}).strict().optional();

const SourceId = z.number().int().positive();

/** 허용 경로 → 처리기. 키는 shared/ipc.ts의 INVOKE_PATHS와 같아야 한다(타입으로 강제). 모든 입력은 .strict(). */
export function createRoutes(deps: RouteDeps): { readonly [K in InvokePath]: Route } {
  return {
    'env.check': route(NoInput, () => deps.envCheck()),
    'onboarding.setDataDir': route(NoInput, (_input, { sender }) => deps.setDataDir(sender)),
    'sources.list': route(NoInput, () => deps.sources.list()),
    'sources.add': route(z.object({ kind: z.literal('dialog') }).strict(), (_input, { sender }) =>
      deps.sources.add(sender),
    ),
    'sources.remove': route(z.object({ sourceId: SourceId }).strict(), (input) => deps.sources.remove(input.sourceId)),
    'index.preview': route(z.object({ sourceId: SourceId }).strict(), (input) => deps.index.preview(input.sourceId)),
    // sourceId가 없으면 전체 소스
    'index.start': route(z.object({ sourceId: SourceId.optional() }).strict().optional(), (input) =>
      deps.index.start(input?.sourceId),
    ),
    'index.status': route(NoInput, () => deps.index.status()),
  };
}
