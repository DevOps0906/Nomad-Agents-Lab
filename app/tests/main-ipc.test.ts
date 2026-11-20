// 실제 Main 진입점(src/main/index.ts)을 electron 모킹 위에서 부팅하고,
// ipcMain.handle에 등록된 리스너를 그대로 호출해 거부 동작을 검증한다.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { INVOKE_CHANNEL } from '../src/shared/ipc';

type Listener = (event: unknown, path: unknown, input: unknown) => Promise<unknown>;

const h = vi.hoisted(() => ({
  handles: new Map<string, unknown>(),
  echo: vi.fn((input: unknown) => input),
}));

vi.mock('electron', () => {
  class BrowserWindow {
    static getAllWindows = () => [];
    once() {}
    on() {}
    loadURL() {
      return Promise.resolve();
    }
  }
  return {
    BrowserWindow,
    app: {
      isPackaged: true,
      requestSingleInstanceLock: () => true,
      on: () => {},
      whenReady: () => Promise.resolve(),
    },
    ipcMain: { handle: (channel: string, listener: unknown) => h.handles.set(channel, listener) },
    net: { fetch: vi.fn() },
    protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
    session: {
      defaultSession: {
        setPermissionRequestHandler: () => {},
        setPermissionCheckHandler: () => {},
        webRequest: { onBeforeRequest: () => {}, onHeadersReceived: () => {} },
      },
    },
  };
});

// 제품 허용 목록은 비어 있으므로 zod 검증 경로를 태울 더미 경로 1개만 주입한다(배선은 실제 코드).
vi.mock('../src/main/ipc/routes', () => ({
  routes: { 'test.echo': { input: z.object({ text: z.string() }).strict(), handle: h.echo } },
}));

const frame = (url: string, parent: unknown = null) => ({ senderFrame: { url, parent } });
const trusted = frame('app://bundle/index.html');
let listener: Listener;

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await import('../src/main/index');
  await new Promise((resolve) => setTimeout(resolve, 0)); // whenReady().then 실행
  expect([...h.handles.keys()]).toEqual([INVOKE_CHANNEL]);
  listener = h.handles.get(INVOKE_CHANNEL) as Listener;
});

describe('Main에 등록된 IPC 리스너', () => {
  it.each([
    ['외부 출처 senderFrame', frame('https://evil.example/')],
    ['file:// senderFrame', frame('file:///C:/x/index.html')],
    ['개발 서버 출처(패키지 실행)', frame('http://localhost:5173/')],
    ['하위 프레임', frame('app://bundle/index.html', {})],
    ['senderFrame 없음', { senderFrame: null }],
  ])('%s → E_OUT_OF_SCOPE', async (_name, event) => {
    await expect(listener(event, 'test.echo', { text: 'hi' })).resolves.toEqual({
      ok: false,
      error: { code: 'E_OUT_OF_SCOPE' },
    });
  });

  it.each(['env.check', '__proto__', 'constructor', 42])('허용 목록 밖 경로 %s → E_VALIDATION', async (path) => {
    await expect(listener(trusted, path, {})).resolves.toEqual({ ok: false, error: { code: 'E_VALIDATION' } });
  });

  it.each([undefined, {}, { text: 1 }, { text: 'a', extra: true }])('zod 실패 입력 %j → E_VALIDATION', async (input) => {
    await expect(listener(trusted, 'test.echo', input)).resolves.toEqual({
      ok: false,
      error: { code: 'E_VALIDATION' },
    });
  });

  it('거부된 호출은 처리기에 닿지 않고, 올바른 호출만 처리된다', async () => {
    expect(h.echo).not.toHaveBeenCalled();
    await expect(listener(trusted, 'test.echo', { text: 'hi' })).resolves.toEqual({ ok: true, data: { text: 'hi' } });
    expect(h.echo).toHaveBeenCalledOnce();
  });
});
