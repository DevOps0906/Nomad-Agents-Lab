import { existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  DB_FILE_NAME,
  DbOpenError,
  type OpenOptions,
  type OpenResult,
  nativeOptions,
  openDatabase,
} from '../db/open';
import { type CleanupCounts, cleanupAfterRestart } from '../db/recovery';
import { type BootConfig, readBootConfig, writeBootConfig } from './config';

/** unverified: UNC는 아니지만 로컬 고정 디스크인지 확인하지 못함(시스템 드라이브 밖 — 매핑된 네트워크 드라이브일 수 있음). */
export type DataDirWarning = 'network' | 'sync' | 'unverified';

/** 오류 화면(S-01 경로)으로 보낼 이유. 어느 경우에도 빈 DB를 만들지 않는다. */
export type BootErrorReason =
  | 'config_corrupt'
  | 'data_dir_missing'
  | 'db_missing'
  | 'schema_too_new'
  | 'db_open_failed';

export type SwitchErrorReason = 'target_missing' | 'target_exists' | 'copy_failed' | 'config_write_failed';

export type BootResult =
  /** 부트 설정 없음 = 첫 실행. S-01에서 데이터 위치를 고른 뒤 createDataStore를 부른다. */
  | { readonly kind: 'onboarding' }
  | { readonly kind: 'error'; readonly reason: BootErrorReason; readonly dataDir?: string }
  | {
      readonly kind: 'ready';
      readonly dataDir: string;
      readonly open: OpenResult;
      readonly cleanup: CleanupCounts;
      readonly warnings: DataDirWarning[];
      /** 대기 중 전환을 처리했으면 결과(성공 시 dataDir가 새 위치) */
      readonly switched?: { readonly ok: true } | { readonly ok: false; readonly reason: SwitchErrorReason };
    };

export interface BootOptions extends Pick<OpenOptions, 'nativeBinding' | 'migrations' | 'now'> {
  /** 동기화 폴더 판단용 환경 변수(OneDrive 등). 기본 process.env */
  readonly env?: NodeJS.ProcessEnv;
}

const SYNC_SEGMENT = /^(onedrive( - .+)?|dropbox|google drive|googledrive|icloud ?drive|내 드라이브)$/i;
const SYNC_ENV_KEYS = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'];

/**
 * 네트워크(UNC) 경로·동기화 폴더는 경고만 한다(차단하지 않음).
 * 드라이브 종류(GetDriveType)는 네이티브 없이 확인할 수 없으므로, 시스템 드라이브(%SystemDrive%, 기본 C:)가 아닌
 * 드라이브 문자는 로컬 고정 디스크인지 확인하지 못한 상태(unverified)로 경고한다.
 */
export function dataDirWarnings(dir: string, env: NodeJS.ProcessEnv = process.env): DataDirWarning[] {
  const warnings: DataDirWarning[] = [];
  if (/^(\\\\|\/\/)/.test(dir)) warnings.push('network');
  else {
    const drive = /^([A-Za-z]):/.exec(dir)?.[1]?.toUpperCase();
    const systemDrive = /^([A-Za-z]):$/.exec(env['SystemDrive'] ?? '')?.[1]?.toUpperCase() ?? 'C';
    if (!drive || drive !== systemDrive) warnings.push('unverified');
  }
  const norm = path.resolve(dir).toLowerCase();
  const underSyncEnv = SYNC_ENV_KEYS.some((key) => {
    const root = env[key];
    if (!root) return false;
    const r = path.resolve(root).toLowerCase();
    return norm === r || norm.startsWith(r + path.sep);
  });
  if (underSyncEnv || path.resolve(dir).split(/[\\/]/).some((s) => SYNC_SEGMENT.test(s))) warnings.push('sync');
  return warnings;
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function openOptions(options: BootOptions, create: boolean): OpenOptions {
  return {
    create,
    ...(options.nativeBinding ? { nativeBinding: options.nativeBinding } : {}),
    ...(options.migrations ? { migrations: options.migrations } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
}

/** 이번 전환이 만든 복사본만 지운다(WAL·SHM 포함). */
function removeCopy(file: string): void {
  for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
    try {
      rmSync(f, { force: true });
    } catch {
      // 지우지 못한 잔여물은 다음 전환에서 target_exists로 막힌다(원본은 그대로).
    }
  }
}

function verifyCopy(file: string, version: number, nativeBinding: string | undefined): boolean {
  const check = new Database(file, { readonly: true, fileMustExist: true, ...nativeOptions(nativeBinding) });
  try {
    return (
      check.pragma('quick_check', { simple: true }) === 'ok' &&
      Number(check.pragma('user_version', { simple: true })) === version
    );
  } finally {
    check.close();
  }
}

/**
 * 열린 DB를 backup API로 새 위치에 복사하고 읽기 전용으로 열어 무결성·버전을 확인한다.
 * 실패하면 이번에 만든 복사본을 지운다. 대상에 이미 DB가 있으면 건드리지 않는다.
 */
async function copyTo(
  source: OpenResult,
  target: string,
  nativeBinding: string | undefined,
): Promise<SwitchErrorReason | null> {
  if (!isDirectory(path.dirname(target))) return 'target_missing';
  if (existsSync(target)) return 'target_exists';
  let ok = false;
  try {
    await source.db.backup(target);
    ok = verifyCopy(target, source.to, nativeBinding);
  } catch {
    ok = false;
  }
  if (ok) return null;
  removeCopy(target);
  return 'copy_failed';
}

function trySave(configFile: string, config: BootConfig): boolean {
  try {
    writeBootConfig(configFile, config);
    return true;
  } catch {
    return false;
  }
}

async function openExisting(dataDir: string, options: BootOptions): Promise<OpenResult | BootErrorReason> {
  try {
    return await openDatabase(path.join(dataDir, DB_FILE_NAME), openOptions(options, false));
  } catch (error) {
    if (error instanceof DbOpenError) return error.code;
    return 'db_open_failed';
  }
}

/**
 * 앱 시작 때 1회: 부트 설정 → 데이터 위치 확인 → (대기 중 전환) → DB 열기·마이그레이션 → 재시작 정리.
 * 설정 손상·데이터 위치 없음(드라이브 분리 포함)·DB 없음은 빈 DB를 만들지 않고 오류로 돌려준다.
 */
export async function bootDataStore(configFile: string, options: BootOptions = {}): Promise<BootResult> {
  const read = readBootConfig(configFile);
  if (read.kind === 'missing') return { kind: 'onboarding' };
  if (read.kind === 'corrupt') return { kind: 'error', reason: 'config_corrupt' };
  const config = read.config;
  let dataDir = config.data_dir;
  if (!isDirectory(dataDir)) return { kind: 'error', reason: 'data_dir_missing', dataDir };

  let open = await openExisting(dataDir, options);
  if (typeof open === 'string') return { kind: 'error', reason: open, dataDir };

  try {
    let switched: { ok: true } | { ok: false; reason: SwitchErrorReason } | undefined;
    if (config.pending_data_dir) {
      const targetDir = config.pending_data_dir;
      const target = path.join(targetDir, DB_FILE_NAME);
      const failure = await copyTo(open, target, options.nativeBinding);
      if (failure) {
        // 기존 위치를 그대로 쓰고 대기 중 전환을 지운다(지우지 못하면 다음 시작 때 다시 시도).
        trySave(configFile, { data_dir: dataDir });
        switched = { ok: false, reason: failure };
      } else if (!trySave(configFile, { data_dir: targetDir })) {
        removeCopy(target);
        switched = { ok: false, reason: 'config_write_failed' };
      } else {
        open.db.close();
        dataDir = targetDir;
        const reopened = await openExisting(dataDir, options);
        if (typeof reopened === 'string') return { kind: 'error', reason: reopened, dataDir };
        open = reopened;
        switched = { ok: true };
      }
    }

    const cleanup = cleanupAfterRestart(open.db, options.now?.());
    return {
      kind: 'ready',
      dataDir,
      open,
      cleanup,
      warnings: dataDirWarnings(dataDir, options.env),
      ...(switched ? { switched } : {}),
    };
  } catch (error) {
    if (open.db.open) open.db.close();
    throw error;
  }
}

/** 고른 폴더에 이미 ssr.db가 있다. 남의 DB에 마이그레이션을 적용하지 않도록 쓰지 않는다. */
export class DataStoreExistsError extends Error {
  constructor() {
    super('ssr.db already exists in the chosen folder');
    this.name = 'DataStoreExistsError';
  }
}

/**
 * 첫 실행(S-01)에서 사용자가 고른 위치에 새 DB를 만들고 부트 설정을 쓴다.
 * 기존 ssr.db가 있으면 DataStoreExistsError. 설정 쓰기가 실패하면 연 DB를 닫고 오류를 그대로 던진다.
 */
export async function createDataStore(
  configFile: string,
  dataDir: string,
  options: BootOptions = {},
): Promise<OpenResult> {
  if (!isDirectory(dataDir)) throw new Error('data dir not found');
  const file = path.join(dataDir, DB_FILE_NAME);
  if (existsSync(file)) throw new DataStoreExistsError();
  const result = await openDatabase(file, openOptions(options, true));
  try {
    writeBootConfig(configFile, { data_dir: dataDir });
  } catch (error) {
    result.db.close();
    // 이번 호출이 만든 DB만 지운다(위에서 없음을 확인했다). 같은 폴더를 다시 고를 수 있게 한다.
    removeCopy(file);
    throw error;
  }
  return result;
}

/** 데이터 위치 변경(A-17)은 대기 중 전환만 기록한다. 복사·전환은 다음 시작 때 bootDataStore가 한다. */
export function requestDataDirSwitch(configFile: string, current: BootConfig, target: string): void {
  writeBootConfig(configFile, { data_dir: current.data_dir, pending_data_dir: target });
}
