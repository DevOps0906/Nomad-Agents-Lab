// env.check 조립: 시작 상태 → dataDir, 오류 상태의 "다시 시도"는 시작 흐름 재실행(동시 요청은 1회만).
import { describe, expect, it, vi } from 'vitest';
import { createEnvCheck } from '../src/main/onboarding/envCheck';
import type { MainBootState } from '../src/main/onboarding/service';

const okClaude = async () => ({ claude: 'ok', version: '2.1.323', authMethod: 'claude.ai' }) as const;

describe('env.check 시작 상태', () => {
  it.each<[MainBootState, string, string | null]>([
    [{ kind: 'onboarding' }, 'unset', null],
    [null, 'error', 'boot_failed'],
  ])('%j → dataDir=%s', async (state, dataDir, bootError) => {
    const reboot = vi.fn(async () => {});
    const check = createEnvCheck({ state: () => state, reboot, checkClaude: okClaude });
    await expect(check()).resolves.toMatchObject({ claude: 'ok', minVersion: '2.1.323', dataDir, bootError });
    expect(reboot).not.toHaveBeenCalled();
  });

  it('오류 상태면 시작 흐름을 다시 돌리고, 복구되면 set을 돌려준다', async () => {
    let state: MainBootState = { kind: 'error', reason: 'data_dir_missing' };
    const reboot = vi.fn(async () => {
      state = { kind: 'onboarding' };
    });
    const check = createEnvCheck({ state: () => state, reboot, checkClaude: okClaude });
    await expect(check()).resolves.toMatchObject({ dataDir: 'unset', bootError: null });
    expect(reboot).toHaveBeenCalledOnce();
  });

  it('여전히 실패하면 원인 이름만(경로 없음), 동시 요청은 재시작 1회를 공유', async () => {
    const state: MainBootState = { kind: 'error', reason: 'data_dir_missing', dataDir: 'D:\\secret\\path' };
    let release: () => void = () => {};
    const reboot = vi.fn(async () => {});
    reboot.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
    const check = createEnvCheck({ state: () => state, reboot, checkClaude: okClaude });
    const a = check();
    const b = check();
    release();
    const results = await Promise.all([a, b]);
    expect(reboot).toHaveBeenCalledOnce();
    for (const r of results) expect(r).toMatchObject({ dataDir: 'error', bootError: 'data_dir_missing' });
    expect(JSON.stringify(results)).not.toContain('secret');
    await check();
    expect(reboot).toHaveBeenCalledTimes(2);
  });
});
