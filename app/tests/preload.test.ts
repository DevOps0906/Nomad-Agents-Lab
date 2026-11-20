import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SsrApi } from '../src/shared/ipc';

const { exposed, invoke } = vi.hoisted(() => ({ exposed: {} as Record<string, unknown>, invoke: vi.fn() }));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => (exposed[key] = api) },
  ipcRenderer: { invoke },
}));

describe('preload', () => {
  beforeEach(async () => {
    vi.resetModules();
    invoke.mockReset();
    await import('../src/preload/index');
  });

  it('ssr.invoke 하나만 노출하고 ipcRenderer는 노출하지 않는다', () => {
    expect(Object.keys(exposed)).toEqual(['ssr']);
    expect(Object.keys(exposed['ssr'] as object)).toEqual(['invoke']);
  });

  it('허용 목록 밖 경로는 Main으로 보내지 않고 거부한다', async () => {
    const api = exposed['ssr'] as SsrApi;
    await expect(api.invoke('settings.set')).resolves.toEqual({ ok: false, error: { code: 'E_VALIDATION' } });
    expect(invoke).not.toHaveBeenCalled();
  });
});
