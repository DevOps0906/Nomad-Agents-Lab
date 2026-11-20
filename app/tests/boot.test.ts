// 부트 설정(DB 밖 JSON)과 시작 흐름. 임시 폴더만 쓴다.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOOT_CONFIG_FILE_NAME, readBootConfig, writeBootConfig } from '../src/main/boot/config';
import {
  type BootResult,
  bootDataStore,
  createDataStore,
  dataDirWarnings,
  requestDataDirSwitch,
} from '../src/main/boot/start';
import { DB_FILE_NAME } from '../src/main/db/open';

let root: string;
let configFile: string;
let dataDir: string;
const toClose: Database.Database[] = [];

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ssr-boot-'));
  configFile = path.join(root, 'userData', BOOT_CONFIG_FILE_NAME);
  dataDir = path.join(root, 'data');
  mkdirSync(dataDir);
});

afterEach(() => {
  for (const db of toClose.splice(0)) if (db.open) db.close();
  rmSync(root, { recursive: true, force: true });
});

function ready(result: BootResult) {
  if (result.kind !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(result)}`);
  toClose.push(result.open.db);
  return result;
}

async function setUpStore(dir = dataDir) {
  const created = await createDataStore(configFile, dir);
  created.db.close();
}

describe('boot_config 읽기·쓰기', () => {
  it('누락이면 missing, 손상 JSON·잘못된 필드면 corrupt', () => {
    expect(readBootConfig(configFile)).toEqual({ kind: 'missing' });
    mkdirSync(path.dirname(configFile), { recursive: true });
    writeFileSync(configFile, '{"data_dir": "C:\\\\x"');
    expect(readBootConfig(configFile)).toMatchObject({ kind: 'corrupt' });
    writeFileSync(configFile, JSON.stringify({ data_dir: 'relative/dir' }));
    expect(readBootConfig(configFile)).toMatchObject({ kind: 'corrupt' });
    writeFileSync(configFile, JSON.stringify({ data_dir: dataDir, schema_version: 3 }));
    expect(readBootConfig(configFile)).toEqual({ kind: 'ok', config: { data_dir: dataDir } });
  });

  it('원자적 쓰기: 성공 시 임시 파일이 남지 않고, 실패 시 기존 파일이 그대로다', () => {
    writeBootConfig(configFile, { data_dir: dataDir });
    expect(readdirSync(path.dirname(configFile))).toEqual([BOOT_CONFIG_FILE_NAME]);
    const before = readFileSync(configFile, 'utf8');
    // 임시 파일 자리에 폴더를 두어 쓰기를 중간에 실패시킨다.
    mkdirSync(`${configFile}.${process.pid}.tmp`);
    expect(() => writeBootConfig(configFile, { data_dir: path.join(root, 'other') })).toThrow();
    expect(readFileSync(configFile, 'utf8')).toBe(before);
    expect(() => writeBootConfig(configFile, { data_dir: 'relative' })).toThrow();
    expect(readFileSync(configFile, 'utf8')).toBe(before);
  });
});

describe('시작 흐름', () => {
  it('설정 누락 = 첫 실행(onboarding), DB를 만들지 않는다', async () => {
    expect(await bootDataStore(configFile)).toEqual({ kind: 'onboarding' });
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it('첫 실행 생성 후 다시 시작하면 ready + 재시작 정리', async () => {
    await setUpStore();
    expect(readBootConfig(configFile)).toEqual({ kind: 'ok', config: { data_dir: dataDir } });
    const result = ready(await bootDataStore(configFile, { env: {} }));
    expect(result).toMatchObject({ dataDir, warnings: [], cleanup: { runs: 0, indexJobs: 0, sources: 0 } });
    expect(result.switched).toBeUndefined();
  });

  it('손상된 설정은 오류로 보내고 빈 DB를 만들지 않는다', async () => {
    mkdirSync(path.dirname(configFile), { recursive: true });
    writeFileSync(configFile, 'not json');
    expect(await bootDataStore(configFile)).toEqual({ kind: 'error', reason: 'config_corrupt' });
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it('데이터 위치 없음(드라이브 분리)·DB 파일 없음은 오류, 빈 DB를 만들지 않는다', async () => {
    const gone = path.join(root, 'unplugged');
    writeBootConfig(configFile, { data_dir: gone });
    expect(await bootDataStore(configFile)).toEqual({ kind: 'error', reason: 'data_dir_missing', dataDir: gone });
    expect(existsSync(gone)).toBe(false);

    writeBootConfig(configFile, { data_dir: dataDir });
    expect(await bootDataStore(configFile)).toEqual({ kind: 'error', reason: 'db_missing', dataDir });
    expect(readdirSync(dataDir)).toEqual([]);
  });

  it('DB 스키마가 앱보다 새로우면 오류', async () => {
    await setUpStore();
    const db = new Database(path.join(dataDir, DB_FILE_NAME));
    db.pragma('user_version = 999');
    db.close();
    expect(await bootDataStore(configFile)).toEqual({ kind: 'error', reason: 'schema_too_new', dataDir });
  });

  it('대기 중 전환: 다음 시작 때 backup API로 복사·검증 후 새 위치로 바꾸고 원본은 남긴다', async () => {
    await setUpStore();
    const src = new Database(path.join(dataDir, DB_FILE_NAME));
    src
      .prepare(`INSERT INTO sources (kind, path, label, created_at) VALUES ('sample', 'C:\\s', 's', 'now')`)
      .run();
    src.close();
    const target = path.join(root, 'moved');
    mkdirSync(target);
    requestDataDirSwitch(configFile, { data_dir: dataDir }, target);
    expect(readBootConfig(configFile)).toEqual({ kind: 'ok', config: { data_dir: dataDir, pending_data_dir: target } });

    const result = ready(await bootDataStore(configFile, { env: {} }));
    expect(result).toMatchObject({ dataDir: target, switched: { ok: true } });
    expect(result.open.db.prepare('SELECT path FROM sources').all()).toEqual([{ path: 'C:\\s' }]);
    expect(readBootConfig(configFile)).toEqual({ kind: 'ok', config: { data_dir: target } });
    expect(existsSync(path.join(dataDir, DB_FILE_NAME))).toBe(true);
  });

  it('전환 대상이 없거나 이미 DB가 있으면 기존 위치를 유지하고 대기 중 전환을 지운다', async () => {
    await setUpStore();
    requestDataDirSwitch(configFile, { data_dir: dataDir }, path.join(root, 'nowhere'));
    const missing = ready(await bootDataStore(configFile, { env: {} }));
    expect(missing).toMatchObject({ dataDir, switched: { ok: false, reason: 'target_missing' } });
    missing.open.db.close();
    expect(readBootConfig(configFile)).toEqual({ kind: 'ok', config: { data_dir: dataDir } });

    const occupied = path.join(root, 'occupied');
    mkdirSync(occupied);
    writeFileSync(path.join(occupied, DB_FILE_NAME), 'keep');
    requestDataDirSwitch(configFile, { data_dir: dataDir }, occupied);
    const exists = ready(await bootDataStore(configFile, { env: {} }));
    expect(exists).toMatchObject({ dataDir, switched: { ok: false, reason: 'target_exists' } });
    expect(readFileSync(path.join(occupied, DB_FILE_NAME), 'utf8')).toBe('keep');
  });
});

describe('대기 중 전환 실패 복구', () => {
  const blockConfigWrite = () => mkdirSync(`${configFile}.${process.pid}.tmp`);

  it('복사 후 설정 쓰기가 실패하면 이번에 만든 복사본을 지우고 기존 위치로 계속한다', async () => {
    await setUpStore();
    const target = path.join(root, 'moved');
    mkdirSync(target);
    requestDataDirSwitch(configFile, { data_dir: dataDir }, target);
    blockConfigWrite();
    const result = ready(await bootDataStore(configFile, { env: {} }));
    expect(result).toMatchObject({ dataDir, switched: { ok: false, reason: 'config_write_failed' } });
    expect(result.open.db.open).toBe(true);
    expect(readdirSync(target)).toEqual([]);
    expect(readBootConfig(configFile)).toEqual({ kind: 'ok', config: { data_dir: dataDir, pending_data_dir: target } });
  });

  it('전환 실패 뒤 대기 중 전환을 지우는 쓰기마저 실패해도 부팅은 계속된다', async () => {
    await setUpStore();
    requestDataDirSwitch(configFile, { data_dir: dataDir }, path.join(root, 'nowhere'));
    blockConfigWrite();
    const result = ready(await bootDataStore(configFile, { env: {} }));
    expect(result).toMatchObject({ dataDir, switched: { ok: false, reason: 'target_missing' } });
  });
});

describe('데이터 위치 경고', () => {
  const sys = { SystemDrive: 'C:' };

  it('네트워크(UNC)·동기화 폴더는 경고한다', () => {
    expect(dataDirWarnings('\\\\server\\share\\ssr', sys)).toContain('network');
    expect(dataDirWarnings('C:\\Users\\me\\OneDrive\\ssr', sys)).toEqual(['sync']);
    expect(dataDirWarnings('C:\\Sync\\ssr', { ...sys, OneDrive: 'C:\\Sync' })).toEqual(['sync']);
    expect(dataDirWarnings('C:\\SyncOther\\ssr', { ...sys, OneDrive: 'C:\\Sync' })).toEqual([]);
    expect(dataDirWarnings('C:\\Users\\me\\Dropbox\\ssr', sys)).toEqual(['sync']);
    expect(dataDirWarnings('C:\\ssr-data', sys)).toEqual([]);
  });

  it('시스템 드라이브 밖(매핑 드라이브일 수 있음)은 확인 불가 경고', () => {
    expect(dataDirWarnings('D:\\ssr-data', sys)).toEqual(['unverified']);
    expect(dataDirWarnings('Z:\\share\\ssr', sys)).toEqual(['unverified']);
    expect(dataDirWarnings('D:\\Sync\\ssr', { ...sys, OneDrive: 'D:\\Sync' })).toEqual(['unverified', 'sync']);
    expect(dataDirWarnings('D:\\ssr-data', { SystemDrive: 'D:' })).toEqual([]);
    expect(dataDirWarnings('d:\\ssr-data', { SystemDrive: 'D:' })).toEqual([]);
    expect(dataDirWarnings('C:\\ssr-data', {})).toEqual([]);
  });
});
