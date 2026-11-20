import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { IpcError, createBusyLock, createInvokeHandler, type InvokeEventLike, type Routes } from '../src/main/ipc/router';
import { type RouteDeps, createRoutes } from '../src/main/ipc/routes';
import { createTrustedUrlCheck } from '../src/main/security';
import { INVOKE_PATHS } from '../src/shared/ipc';

const isTrustedUrl = createTrustedUrlCheck();
const topFrame = (url: string): InvokeEventLike => ({ senderFrame: { url, parent: null } });
const trusted = topFrame('app://bundle/index.html');

// 거부 테스트용 더미 경로 1개(제품 허용 목록에는 없다).
function dummyRoutes(handle = vi.fn((input: unknown) => input)) {
  const routes: Routes = {
    'test.echo': { input: z.object({ text: z.string().max(10) }).strict(), handle },
  };
  return { routes, handle };
}

function fakeDeps() {
  return {
    envCheck: vi.fn(async () => ({}) as never),
    setDataDir: vi.fn(async () => ({ status: 'canceled' }) as const),
    sources: {
      list: vi.fn(() => []),
      add: vi.fn(async () => ({ source: null })),
      remove: vi.fn(() => ({ removed: true })),
    },
    index: {
      preview: vi.fn(async () => ({ targets: 0, excluded: 0, tooLarge: 0, reason: null })),
      start: vi.fn(() => ({ jobIds: [] })),
      status: vi.fn(() => ({ running: false, jobs: [], failures: [] })),
    },
  } satisfies RouteDeps;
}
const productionRoutes = createRoutes(fakeDeps());

describe('IPC 허용 목록(Main)', () => {
  it('제품 허용 목록은 Preload 목록과 같다', () => {
    expect(Object.keys(productionRoutes)).toEqual([...INVOKE_PATHS]);
    expect(INVOKE_PATHS).toEqual([
      'env.check',
      'onboarding.setDataDir',
      'sources.list',
      'sources.add',
      'sources.remove',
      'index.preview',
      'index.start',
      'index.status',
    ]);
  });

  it('허용 목록 밖 경로는 신뢰 프레임에서 와도 E_VALIDATION으로 거부한다', async () => {
    const handler = createInvokeHandler({ routes: productionRoutes, isTrustedUrl });
    for (const path of ['settings.set', 'search.query', 'shell.openExternal', '', 42, null, undefined]) {
      await expect(handler(trusted, path, {})).resolves.toEqual({ ok: false, error: { code: 'E_VALIDATION' } });
    }
  });

  it('프로토타입 속성 이름으로 우회할 수 없다', async () => {
    const { routes, handle } = dummyRoutes();
    const handler = createInvokeHandler({ routes, isTrustedUrl });
    for (const path of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      await expect(handler(trusted, path, {})).resolves.toEqual({ ok: false, error: { code: 'E_VALIDATION' } });
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('허용 경로라도 입력 스키마가 틀리면 처리기를 부르지 않는다', async () => {
    const { routes, handle } = dummyRoutes();
    const handler = createInvokeHandler({ routes, isTrustedUrl });
    for (const input of [undefined, {}, { text: 1 }, { text: 'x'.repeat(11) }, { text: 'a', extra: true }]) {
      await expect(handler(trusted, 'test.echo', input)).resolves.toEqual({ ok: false, error: { code: 'E_VALIDATION' } });
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('신뢰 프레임 + 허용 경로 + 올바른 입력이면 처리한다', async () => {
    const { routes, handle } = dummyRoutes();
    const handler = createInvokeHandler({ routes, isTrustedUrl });
    await expect(handler(trusted, 'test.echo', { text: 'hi' })).resolves.toEqual({ ok: true, data: { text: 'hi' } });
    expect(handle).toHaveBeenCalledOnce();
  });

  it('처리기 예외는 원문 없이 E_INTERNAL만 돌려준다', async () => {
    const { routes } = dummyRoutes(
      vi.fn(() => {
        throw new Error('secret path C:\\Users\\x');
      }),
    );
    const log = vi.fn();
    const handler = createInvokeHandler({ routes, isTrustedUrl, log });
    const result = await handler(trusted, 'test.echo', { text: 'hi' });
    expect(result).toEqual({ ok: false, error: { code: 'E_INTERNAL' } });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret');
  });
});

describe('senderFrame 검증(Main)', () => {
  const untrusted: Array<[string, InvokeEventLike]> = [
    ['senderFrame 없음(파괴·이동된 프레임)', { senderFrame: null }],
    ['외부 https 출처', topFrame('https://evil.example/index.html')],
    ['file:// 로드', topFrame('file:///C:/app/out/renderer/index.html')],
    ['다른 app 호스트', topFrame('app://other/index.html')],
    ['개발 서버 출처(prod 모드)', topFrame('http://localhost:5173/')],
    ['하위 프레임(iframe)', { senderFrame: { url: 'app://bundle/index.html', parent: {} } }],
    ['깨진 URL', topFrame('not a url')],
  ];

  it.each(untrusted)('%s → E_OUT_OF_SCOPE, 처리기 미호출', async (_name, event) => {
    const { routes, handle } = dummyRoutes();
    const handler = createInvokeHandler({ routes, isTrustedUrl });
    await expect(handler(event, 'test.echo', { text: 'hi' })).resolves.toEqual({
      ok: false,
      error: { code: 'E_OUT_OF_SCOPE' },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('dev 모드에서는 지정한 개발 서버 출처만 신뢰한다', () => {
    const devCheck = createTrustedUrlCheck('http://localhost:5173');
    expect(devCheck('http://localhost:5173/')).toBe(true);
    expect(devCheck('http://localhost:5174/')).toBe(false);
    expect(devCheck('app://bundle/index.html')).toBe(false);
  });
});

describe('A-01·데이터 위치·A-02 입력 스키마(.strict)', () => {
  const rejected: Array<[string, unknown]> = [
    ['env.check', { path: 'C:/x' }],
    ['onboarding.setDataDir', { path: 'C:/x' }],
    ['onboarding.setDataDir', 'C:/x'],
    ['sources.list', { path: 'C:/x' }],
    ['sources.add', { kind: 'dialog', path: 'C:/x' }],
    ['sources.add', { kind: 'path', value: 'C:/x' }],
    ['sources.add', { kind: 'sample' }],
    ['sources.add', undefined],
    ['sources.remove', { sourceId: 1, path: 'C:/x' }],
    ['sources.remove', { sourceId: '1' }],
    ['sources.remove', { sourceId: 0 }],
    ['sources.remove', { sourceId: 1.5 }],
  ];

  it.each(rejected)('%s %j → E_VALIDATION, 서비스 미호출', async (path, input) => {
    const deps = fakeDeps();
    const handler = createInvokeHandler({ routes: createRoutes(deps), isTrustedUrl });
    await expect(handler(trusted, path, input)).resolves.toEqual({ ok: false, error: { code: 'E_VALIDATION' } });
    expect(deps.envCheck).not.toHaveBeenCalled();
    expect(deps.setDataDir).not.toHaveBeenCalled();
    expect(deps.sources.add).not.toHaveBeenCalled();
    expect(deps.sources.remove).not.toHaveBeenCalled();
  });

  it('입력 없음 경로는 undefined·빈 객체를 받고, 대화상자 경로에는 발신 창(sender)을 넘긴다', async () => {
    const deps = fakeDeps();
    const handler = createInvokeHandler({ routes: createRoutes(deps), isTrustedUrl });
    const sender = { id: 7 };
    const event = { ...trusted, sender };
    await expect(handler(event, 'env.check', undefined)).resolves.toMatchObject({ ok: true });
    await expect(handler(event, 'sources.list', {})).resolves.toEqual({ ok: true, data: [] });
    await handler(event, 'onboarding.setDataDir', undefined);
    await handler(event, 'sources.add', { kind: 'dialog' });
    await handler(event, 'sources.remove', { sourceId: 3 });
    expect(deps.setDataDir).toHaveBeenCalledWith(sender);
    expect(deps.sources.add).toHaveBeenCalledWith(sender);
    expect(deps.sources.remove).toHaveBeenCalledWith(3);
  });

  it('서비스의 IpcError는 그 코드로 돌려준다', async () => {
    const deps = fakeDeps();
    deps.sources.remove.mockImplementation(() => {
      throw new IpcError('E_NOT_FOUND');
    });
    const handler = createInvokeHandler({ routes: createRoutes(deps), isTrustedUrl });
    await expect(handler(trusted, 'sources.remove', { sourceId: 9 })).resolves.toEqual({
      ok: false,
      error: { code: 'E_NOT_FOUND' },
    });
  });
});

describe('진행 중 잠금', () => {
  it('진행 중이면 E_BUSY, 끝나면(실패 포함) 다시 받는다', async () => {
    const exclusive = createBusyLock();
    let release: () => void = () => {};
    const first = exclusive(() => new Promise<string>((r) => (release = () => r('done'))));
    await expect(exclusive(async () => 'second')).rejects.toMatchObject({ code: 'E_BUSY' });
    release();
    await expect(first).resolves.toBe('done');
    await expect(exclusive(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    await expect(exclusive(async () => 'again')).resolves.toBe('again');
  });
});
