// 원자적 쓰기: fsync·rename 단계 실패를 모킹해 기존 설정이 그대로 남고 임시 파일이 정리되는지 확인한다.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOT_CONFIG_FILE_NAME, writeBootConfig } from '../src/main/boot/config';

const fail = vi.hoisted(() => ({ step: null as null | 'fsync' | 'rename' }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    fsyncSync: (fd: number) => {
      if (fail.step === 'fsync') throw Object.assign(new Error('EIO'), { code: 'EIO' });
      real.fsyncSync(fd);
    },
    renameSync: (from: string, to: string) => {
      // Windows에서 대상 파일이 잠겨 있으면 rename이 EPERM으로 실패한다.
      if (fail.step === 'rename') throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      real.renameSync(from, to);
    },
  };
});

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ssr-atomic-'));
  file = path.join(dir, BOOT_CONFIG_FILE_NAME);
  fail.step = null;
  writeBootConfig(file, { data_dir: path.join(dir, 'a') });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeBootConfig 실패 단계', () => {
  it.each(['fsync', 'rename'] as const)('%s 실패 → 기존 파일 유지, 임시 파일 없음', (step) => {
    const before = readFileSync(file, 'utf8');
    fail.step = step;
    expect(() => writeBootConfig(file, { data_dir: path.join(dir, 'b') })).toThrow();
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(readdirSync(dir)).toEqual([BOOT_CONFIG_FILE_NAME]);
  });
});
