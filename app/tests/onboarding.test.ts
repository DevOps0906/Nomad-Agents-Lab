// 데이터 위치 지정(onboarding.setDataDir)·연결 폴더(A-02)·경로 검사. 임시 폴더만 쓰고 사용자 문서는 읽지 않는다.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOOT_CONFIG_FILE_NAME, readBootConfig } from '../src/main/boot/config';
import { createDataStore } from '../src/main/boot/start';
import { DB_FILE_NAME } from '../src/main/db/open';
import { createBusyLock } from '../src/main/ipc/router';
import {
  type FolderPolicyContext,
  SENSITIVE_HOME_DIRS,
  checkFolder,
  isDeviceOrUncPath,
  overlaps,
  rejectBroadPath,
  resolveFolder,
} from '../src/main/onboarding/folders';
import { type MainBootState, createOnboarding } from '../src/main/onboarding/service';
import { createSources } from '../src/main/sources/service';

let root: string;
let home: string;
let ctx: FolderPolicyContext;
let configFile: string;
let state: MainBootState;
let pick: ReturnType<typeof vi.fn<(sender: unknown) => Promise<string | null>>>;

const dir = (...parts: string[]) => {
  const p = path.join(root, ...parts);
  mkdirSync(p, { recursive: true });
  return p;
};

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ssr-onb-'));
  home = dir('home');
  const userData = dir('home', 'AppData', 'Roaming', 'SSR');
  ctx = {
    home,
    userData,
    env: {
      WINDIR: dir('win'),
      ProgramFiles: dir('pf'),
      'ProgramFiles(x86)': dir('pf86'),
      ProgramData: dir('pd'),
    },
  };
  configFile = path.join(userData, BOOT_CONFIG_FILE_NAME);
  state = { kind: 'onboarding' };
  pick = vi.fn<(sender: unknown) => Promise<string | null>>();
});

afterEach(() => {
  if (state?.kind === 'ready' && state.open.db.open) state.open.db.close();
  rmSync(root, { recursive: true, force: true });
});

function services() {
  const exclusive = createBusyLock();
  const holder = { get: () => state, set: (next: MainBootState) => (state = next) };
  const onboarding = createOnboarding({ state: holder, configFile, policy: ctx, pickFolder: pick, exclusive });
  const sources = createSources({
    store: () => (state?.kind === 'ready' ? { db: state.open.db, dataDir: state.dataDir } : null),
    policy: ctx,
    pickFolder: pick,
    exclusive,
  });
  return { onboarding, sources };
}

const code = (c: string) => expect.objectContaining({ code: c });

describe('경로 검사', () => {
  it('드라이브 루트·UNC·장치 경로는 거부한다', async () => {
    const drive = (await resolveFolder(path.parse(root).root)) as string;
    expect(rejectBroadPath(drive, ctx)).toBe('drive_root');
    expect(rejectBroadPath('\\\\server\\share\\notes', ctx)).toBe('network');
    expect(rejectBroadPath('\\\\?\\C:\\notes', ctx)).toBe('network');
  });

  it('시스템 폴더(안쪽 포함)·AppData 전체·userData는 거부한다', async () => {
    for (const p of [
      dir('win'),
      dir('win', 'System32'),
      dir('pf', 'App'),
      dir('pf86'),
      dir('pd', 'x'),
      dir('home', 'AppData'),
      dir('home', 'AppData', 'Local', 'Temp'),
      ctx.userData,
    ]) {
      expect(rejectBroadPath((await resolveFolder(p)) as string, ctx)).toBe('system');
    }
  });

  it('홈 폴더 자체와 그 상위는 거부하고, 홈 안 폴더는 허용한다', async () => {
    expect(rejectBroadPath((await resolveFolder(home)) as string, ctx)).toBe('too_broad');
    expect(rejectBroadPath((await resolveFolder(root)) as string, ctx)).toBe('too_broad');
    expect(rejectBroadPath((await resolveFolder(dir('home', 'Documents', 'notes'))) as string, ctx)).toBeNull();
  });

  it('실제 시스템 폴더도 거부한다(실제 환경 변수)', async () => {
    const real = { env: process.env, home: os.homedir(), userData: ctx.userData };
    const windir = (await resolveFolder(process.env['WINDIR'] ?? 'C:\\Windows')) as string;
    expect(rejectBroadPath(windir, real)).toBe('system');
    expect(rejectBroadPath((await resolveFolder(os.homedir())) as string, real)).toBe('too_broad');
  });

  it('junction으로 우회해도 실제 경로로 판정한다', async () => {
    const link = path.join(dir('home', 'Documents'), 'innocent');
    symlinkSync(dir('win', 'System32'), link, 'junction');
    const real = (await resolveFolder(link)) as string;
    expect(real.toLowerCase()).toBe(path.join(root, 'win', 'System32').toLowerCase());
    expect(rejectBroadPath(real, ctx)).toBe('system');

    const realWin = path.join(dir('home', 'Documents'), 'win-link');
    symlinkSync(process.env['WINDIR'] ?? 'C:\\Windows', realWin, 'junction');
    const realCtx = { env: process.env, home: os.homedir(), userData: ctx.userData };
    expect(rejectBroadPath((await resolveFolder(realWin)) as string, realCtx)).toBe('system');
  });

  it('겹침은 대소문자 무시·어느 방향이든', () => {
    expect(overlaps('D:\\Notes', 'd:\\notes')).toBe(true);
    expect(overlaps('D:\\Notes\\a', 'D:\\NOTES')).toBe(true);
    expect(overlaps('D:\\Notes', 'D:\\notes\\a\\b')).toBe(true);
    expect(overlaps('D:\\Notes2', 'D:\\Notes')).toBe(false);
  });

  it('장치·UNC 원본 입력은 realpath가 일반 경로로 바꿔도 거부한다(checkFolder 통합)', async () => {
    const ok = dir('home', 'Documents', 'notes');
    await expect(checkFolder(ok, ctx)).resolves.toEqual({ real: (await resolveFolder(ok)) as string });
    for (const p of [`\\\\?\\${ok}`, `\\\\.\\${ok}`, `//?/${ok}`, `\\??\\${ok}`, `/??/${ok}`, '\\\\server\\share\\notes']) {
      await expect(checkFolder(p, ctx)).resolves.toEqual({ rejected: 'network' });
    }
    // realpath는 실제로 \\?\ 접두를 벗겨낸다(그래서 원본 검사가 필요)
    const viaDevice = await resolveFolder(`\\\\?\\${ok}`);
    if (viaDevice) expect(isDeviceOrUncPath(viaDevice)).toBe(false);
  });

  it('환경 변수가 없어도 고정 시스템 폴더 기본값으로 거부한다', async () => {
    const bare = { env: {}, home: ctx.home, userData: ctx.userData };
    for (const p of ['C:\\Windows', 'C:\\Program Files', 'C:\\ProgramData']) {
      const real = await resolveFolder(p);
      if (real) expect(rejectBroadPath(real, bare)).toBe('system');
    }
    expect(rejectBroadPath('C:\\Windows\\System32', bare)).toBe('system');
    expect(rejectBroadPath('c:\\program files (x86)\\x', bare)).toBe('system');
  });

  it('연결 폴더 기준: 홈 아래 비밀·설정 폴더(자체·하위)는 거부, 품는 상위는 허용', async () => {
    for (const d of SENSITIVE_HOME_DIRS) {
      const real = (await resolveFolder(dir('home', d, 'sub'))) as string;
      expect(rejectBroadPath(real, ctx, { sensitive: true })).toBe('sensitive');
      expect(rejectBroadPath((await resolveFolder(dir('home', d))) as string, ctx, { sensitive: true })).toBe('sensitive');
      // 데이터 위치 검사(기본)에는 적용하지 않는다
      expect(rejectBroadPath(real, ctx)).toBeNull();
    }
    expect(rejectBroadPath((await resolveFolder(dir('home', 'projects'))) as string, ctx, { sensitive: true })).toBeNull();
    expect(rejectBroadPath((await resolveFolder(dir('home', '.sshx'))) as string, ctx, { sensitive: true })).toBeNull();
  });

  it('8.3 별칭으로 우회해도 실제 경로로 판정한다', async (t) => {
    const long = dir('ProgramFilesLongName');
    const aliasCtx = { ...ctx, env: { ...ctx.env, ProgramFiles: long } };
    const out = spawnSync('C:\\Windows\\System32\\cmd.exe', ['/d', '/s', '/c', `"for %I in ("${long}") do @echo %~sI"`], {
      encoding: 'utf8',
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    const short = out.stdout.trim();
    if (!short || short.toLowerCase() === long.toLowerCase()) {
      t.skip('이 볼륨은 8.3 이름을 만들지 않음(fsutil 8dot3name 비활성)');
      return;
    }
    const sub = path.join(short, 'App');
    mkdirSync(sub);
    const real = (await resolveFolder(sub)) as string;
    expect(real.toLowerCase()).toBe(path.join(long, 'App').toLowerCase());
    await expect(checkFolder(sub, aliasCtx)).resolves.toEqual({ rejected: 'system' });
  });

  it('없는 경로·파일은 해석하지 않는다', async () => {
    writeFileSync(path.join(root, 'file.txt'), '');
    expect(await resolveFolder(path.join(root, 'nowhere'))).toBeNull();
    expect(await resolveFolder(path.join(root, 'file.txt'))).toBeNull();
  });
});

describe('onboarding.setDataDir', () => {
  it('고른 폴더에 DB를 만들고 bootState를 ready로 바꾼다. 이후 다시 부르면 E_OUT_OF_SCOPE', async () => {
    const { onboarding, sources } = services();
    const data = dir('home', 'Documents', 'ssr-data');
    pick.mockResolvedValue(data);
    const sender = { id: 1 };
    const result = await onboarding.setDataDir(sender);
    expect(pick).toHaveBeenCalledWith(sender);
    expect(result).toMatchObject({ status: 'set', warnings: [] });
    expect(state?.kind).toBe('ready');
    expect(existsSync(path.join(data, DB_FILE_NAME))).toBe(true);
    expect(readBootConfig(configFile)).toMatchObject({ kind: 'ok' });
    expect(sources.list()).toEqual([]);
    await expect(onboarding.setDataDir(sender)).rejects.toEqual(code('E_OUT_OF_SCOPE'));
  });

  it.each<[string, MainBootState]>([
    ['error', { kind: 'error', reason: 'config_corrupt' }],
    ['boot_failed', { kind: 'error', reason: 'boot_failed' }],
    ['부팅 전', null],
  ])('onboarding 외 상태(%s)면 대화상자를 열지 않고 E_OUT_OF_SCOPE', async (_name, initial) => {
    state = initial;
    const { onboarding } = services();
    await expect(onboarding.setDataDir(null)).rejects.toEqual(code('E_OUT_OF_SCOPE'));
    expect(pick).not.toHaveBeenCalled();
  });

  it('취소하면 아무것도 바꾸지 않는다', async () => {
    const { onboarding } = services();
    pick.mockResolvedValue(null);
    await expect(onboarding.setDataDir(null)).resolves.toEqual({ status: 'canceled' });
    expect(state).toEqual({ kind: 'onboarding' });
    expect(existsSync(configFile)).toBe(false);
  });

  it('연타: 진행 중이면 E_BUSY(대화상자는 하나만)', async () => {
    const { onboarding, sources } = services();
    let resolvePick: (v: string | null) => void = () => {};
    pick.mockImplementationOnce(() => new Promise((r) => (resolvePick = r)));
    const first = onboarding.setDataDir(null);
    await expect(onboarding.setDataDir(null)).rejects.toEqual(code('E_BUSY'));
    expect(pick).toHaveBeenCalledOnce();
    resolvePick(null);
    await expect(first).resolves.toEqual({ status: 'canceled' });
    // sources.add도 같은 잠금을 쓴다(onboarding 전이라 여기선 E_OUT_OF_SCOPE가 먼저).
    await expect(sources.add(null)).rejects.toEqual(code('E_OUT_OF_SCOPE'));
  });

  it('드라이브 루트·시스템·홈·없는 폴더는 E_VALIDATION, 설정·DB를 만들지 않는다', async () => {
    const { onboarding } = services();
    for (const p of [path.parse(root).root, dir('win'), home, ctx.userData, path.join(root, 'nowhere')]) {
      pick.mockResolvedValueOnce(p);
      await expect(onboarding.setDataDir(null)).rejects.toEqual(code('E_VALIDATION'));
    }
    expect(state).toEqual({ kind: 'onboarding' });
    expect(existsSync(configFile)).toBe(false);
  });

  it('기존 ssr.db가 있는 폴더는 거부하고 그 파일을 건드리지 않는다', async () => {
    const { onboarding } = services();
    const other = dir('home', 'other');
    writeFileSync(path.join(other, DB_FILE_NAME), 'keep');
    pick.mockResolvedValue(other);
    await expect(onboarding.setDataDir(null)).rejects.toEqual(code('E_VALIDATION'));
    expect(readFileSync(path.join(other, DB_FILE_NAME), 'utf8')).toBe('keep');
    await expect(createDataStore(configFile, other)).rejects.toThrow(/already exists/);
    expect(readFileSync(path.join(other, DB_FILE_NAME), 'utf8')).toBe('keep');
  });

  it('createDataStore 실패(설정 쓰기 실패) 시 연 DB를 닫고 이번에 만든 DB만 지운다. 원인 해소 후 같은 폴더로 재시도된다', async () => {
    const data = dir('home', 'data');
    writeFileSync(path.join(data, 'note.md'), 'keep');
    const blocker = `${configFile}.${process.pid}.tmp`;
    mkdirSync(blocker, { recursive: true }); // 임시 파일 자리를 폴더로 막는다
    const { onboarding, sources } = services();
    pick.mockResolvedValue(data);
    await expect(onboarding.setDataDir(null)).rejects.toBeTruthy();
    expect(state).toEqual({ kind: 'onboarding' });
    const file = path.join(data, DB_FILE_NAME);
    // 닫히지 않았으면 Windows에서 지울 수 없어 남는다.
    for (const f of [file, `${file}-wal`, `${file}-shm`]) expect(existsSync(f)).toBe(false);
    expect(readFileSync(path.join(data, 'note.md'), 'utf8')).toBe('keep');

    rmSync(blocker, { recursive: true });
    await expect(onboarding.setDataDir(null)).resolves.toMatchObject({ status: 'set' });
    expect(state?.kind).toBe('ready');
    expect(sources.list()).toEqual([]);
  });

  it('createDataStore 직접: 설정 쓰기 실패 시 DB 파일이 남지 않는다', async () => {
    const data = dir('home', 'direct');
    mkdirSync(`${configFile}.${process.pid}.tmp`, { recursive: true });
    await expect(createDataStore(configFile, data)).rejects.toBeTruthy();
    expect(existsSync(path.join(data, DB_FILE_NAME))).toBe(false);
  });

  it('처리 중 예외가 나도 잠금이 풀린다', async () => {
    const { onboarding } = services();
    pick.mockRejectedValueOnce(new Error('dialog failed'));
    await expect(onboarding.setDataDir(null)).rejects.toThrow('dialog failed');
    pick.mockResolvedValueOnce(null);
    await expect(onboarding.setDataDir(null)).resolves.toEqual({ status: 'canceled' });
  });

  it('데이터 위치 지정 중 sources.add는 같은 잠금으로 E_BUSY, 지정 뒤에는 새 DB 핸들을 쓴다', async () => {
    const { onboarding, sources } = services();
    let resolvePick: (v: string | null) => void = () => {};
    pick.mockImplementationOnce(() => new Promise((r) => (resolvePick = r)));
    const pending = onboarding.setDataDir(null);
    // 지정 전이라 sources.*는 먼저 E_OUT_OF_SCOPE
    await expect(sources.add(null)).rejects.toEqual(code('E_OUT_OF_SCOPE'));
    resolvePick(dir('home', 'ssr-data'));
    await pending;
    if (state?.kind !== 'ready') throw new Error('not ready');
    pick.mockImplementationOnce(() => new Promise((r) => (resolvePick = r)));
    const adding = sources.add(null);
    await expect(sources.add(null)).rejects.toEqual(code('E_BUSY'));
    await expect(onboarding.setDataDir(null)).rejects.toEqual(code('E_OUT_OF_SCOPE'));
    resolvePick(dir('home', 'notes'));
    await adding;
    expect(state.open.db.prepare('SELECT count(*) AS n FROM sources').get()).toEqual({ n: 1 });
  });

  it('동기화 폴더는 경고만 한다', async () => {
    const { onboarding } = services();
    pick.mockResolvedValue(dir('home', 'OneDrive', 'ssr'));
    await expect(onboarding.setDataDir(null)).resolves.toMatchObject({ status: 'set', warnings: ['sync'] });
  });
});

describe('sources.list·add·remove', () => {
  async function ready() {
    const s = services();
    pick.mockResolvedValueOnce(dir('home', 'ssr-data'));
    await s.onboarding.setDataDir(null);
    return s;
  }

  it('데이터 위치 지정 전에는 E_OUT_OF_SCOPE', async () => {
    const { sources } = services();
    expect(() => sources.list()).toThrow(expect.objectContaining({ code: 'E_OUT_OF_SCOPE' }));
    await expect(sources.add(null)).rejects.toEqual(code('E_OUT_OF_SCOPE'));
    expect(() => sources.remove(1)).toThrow(expect.objectContaining({ code: 'E_OUT_OF_SCOPE' }));
    expect(pick).not.toHaveBeenCalled();
  });

  it('폴더를 실제 경로로 저장하고 목록·삭제한다', async () => {
    const { sources } = await ready();
    const notes = dir('home', 'notes');
    pick.mockResolvedValueOnce(notes);
    const { source } = await sources.add({ id: 1 });
    expect(source).toMatchObject({ kind: 'folder', label: 'notes', status: 'ok', documentCount: 0, lastIndexedAt: null });
    expect(source?.path.toLowerCase()).toBe(notes.toLowerCase());
    expect(sources.list()).toHaveLength(1);
    expect(sources.remove(source?.id as number)).toEqual({ removed: true });
    expect(sources.list()).toEqual([]);
  });

  it('여러 폴더 허용, 같은 폴더(대소문자)·부모·자식·데이터 위치와 겹치면 E_VALIDATION', async () => {
    const { sources } = await ready();
    pick.mockResolvedValueOnce(dir('home', 'notes'));
    await sources.add(null);
    pick.mockResolvedValueOnce(dir('home', 'papers'));
    await sources.add(null);
    for (const p of [
      path.join(root, 'HOME', 'NOTES'),
      dir('home', 'notes', 'sub'),
      dir('home', 'ssr-data'),
      dir('home', 'ssr-data', 'inner'),
      path.join(root, 'home', 'notes') + path.sep,
    ]) {
      pick.mockResolvedValueOnce(p);
      await expect(sources.add(null)).rejects.toEqual(code('E_VALIDATION'));
    }
    // 데이터 위치를 품는 부모(홈 안)
    pick.mockResolvedValueOnce(dir('home'));
    await expect(sources.add(null)).rejects.toEqual(code('E_VALIDATION'));
    expect(sources.list().map((s) => s.label)).toEqual(['notes', 'papers']);
  });

  it('부모 폴더를 먼저 연결했으면 자식도 거부', async () => {
    const { sources } = await ready();
    pick.mockResolvedValueOnce(dir('home', 'lib'));
    await sources.add(null);
    pick.mockResolvedValueOnce(dir('home', 'lib', 'a', 'b'));
    await expect(sources.add(null)).rejects.toEqual(code('E_VALIDATION'));
  });

  it('드라이브 루트·시스템 폴더·junction 우회는 E_VALIDATION', async () => {
    const { sources } = await ready();
    pick.mockResolvedValueOnce(dir('home', 'notes'));
    await sources.add(null);
    const toSystem = path.join(dir('home', 'links'), 'sys');
    symlinkSync(dir('pf', 'App'), toSystem, 'junction');
    const toExisting = path.join(root, 'home', 'links', 'dup');
    symlinkSync(path.join(root, 'home', 'notes'), toExisting, 'junction');
    for (const p of [path.parse(root).root, dir('win'), toSystem, toExisting]) {
      pick.mockResolvedValueOnce(p);
      await expect(sources.add(null)).rejects.toEqual(code('E_VALIDATION'));
    }
    const toOk = path.join(root, 'home', 'links', 'ok');
    symlinkSync(dir('home', 'elsewhere'), toOk, 'junction');
    pick.mockResolvedValueOnce(toOk);
    const { source } = await sources.add(null);
    expect(source?.path.toLowerCase()).toBe(path.join(root, 'home', 'elsewhere').toLowerCase());
  });

  it('홈 아래 비밀·설정 폴더는 연결 거부, 그 폴더를 품는 상위(홈 안)는 허용', async () => {
    const { sources } = await ready();
    for (const d of ['.ssh', '.claude', '.config']) {
      pick.mockResolvedValueOnce(dir('home', d, 'x'));
      await expect(sources.add(null)).rejects.toEqual(code('E_VALIDATION'));
    }
    pick.mockResolvedValueOnce(`\\\\?\\${dir('home', 'notes')}`);
    await expect(sources.add(null)).rejects.toEqual(code('E_VALIDATION'));
    pick.mockResolvedValueOnce(dir('home', 'notes'));
    await expect(sources.add(null)).resolves.toMatchObject({ source: { label: 'notes' } });
  });

  it('연타: 진행 중이면 E_BUSY, 취소는 null', async () => {
    const { sources } = await ready();
    let resolvePick: (v: string | null) => void = () => {};
    pick.mockImplementationOnce(() => new Promise((r) => (resolvePick = r)));
    const first = sources.add(null);
    await expect(sources.add(null)).rejects.toEqual(code('E_BUSY'));
    resolvePick(null);
    await expect(first).resolves.toEqual({ source: null });
  });

  it('remove: 없는 id는 E_NOT_FOUND, 색인 중이면 E_BUSY', async () => {
    const { sources } = await ready();
    expect(() => sources.remove(999)).toThrow(expect.objectContaining({ code: 'E_NOT_FOUND' }));
    pick.mockResolvedValueOnce(dir('home', 'notes'));
    const { source } = await sources.add(null);
    if (state?.kind !== 'ready') throw new Error('not ready');
    state.open.db.prepare(`UPDATE sources SET status = 'indexing' WHERE id = ?`).run(source?.id);
    expect(() => sources.remove(source?.id as number)).toThrow(expect.objectContaining({ code: 'E_BUSY' }));
  });

  it('DB도 path를 대소문자 무시 UNIQUE로 막는다', async () => {
    await ready();
    if (state?.kind !== 'ready') throw new Error('not ready');
    const db: Database.Database = state.open.db;
    const insert = db.prepare(`INSERT INTO sources (kind, path, label, created_at) VALUES ('folder', ?, 'x', 'now')`);
    insert.run('D:\\Notes');
    expect(() => insert.run('d:\\NOTES')).toThrow(/UNIQUE/);
  });
});
