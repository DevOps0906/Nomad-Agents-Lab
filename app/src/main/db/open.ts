import { existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { MIGRATIONS, type Migration, applyMigrations, latestVersion, readUserVersion } from './migrations';

/** 데이터 위치 폴더 안의 DB 파일 이름 */
export const DB_FILE_NAME = 'ssr.db';

export type DbOpenErrorCode = 'db_missing' | 'schema_too_new';

export class DbOpenError extends Error {
  constructor(
    readonly code: DbOpenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DbOpenError';
  }
}

export interface OpenOptions {
  /** true일 때만 파일이 없으면 새로 만든다(첫 실행 데이터 위치 선택 때만). */
  readonly create: boolean;
  /** 번들된 Main에서 쓰는 .node 경로. 없으면 better-sqlite3가 스스로 찾는다(테스트·개발). */
  readonly nativeBinding?: string;
  readonly migrations?: readonly Migration[];
  readonly now?: () => Date;
}

export interface OpenResult {
  readonly db: Database.Database;
  readonly from: number;
  readonly to: number;
  /** 마이그레이션 전에 만든 백업 파일(적용할 마이그레이션이 없거나 새 DB면 없음) */
  readonly backupPath?: string;
}

/**
 * 패키지(asar) 안 경로를 asar.unpacked 경로로 바꿔 addon을 불러온다.
 * mainDir는 번들된 Main의 __dirname(out/main).
 */
export function bundledNativeBindingPath(mainDir: string): string {
  const file = path.join(
    mainDir,
    '..',
    '..',
    'node_modules',
    'better-sqlite3',
    'prebuilds',
    `${process.platform}-${process.arch}.node`,
  );
  return file.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
}

const addons = new Map<string, object>();

/** nativeBinding 경로가 있으면 addon을 직접 불러 better-sqlite3 옵션으로 넘긴다(번들 안에서 require 경로 문제 회피). */
export function nativeOptions(nativeBinding: string | undefined): Pick<Database.Options, 'nativeBinding'> {
  if (!nativeBinding) return {};
  let addon = addons.get(nativeBinding);
  if (!addon) {
    const mod = { exports: {} };
    process.dlopen(mod, nativeBinding);
    addon = mod.exports;
    addons.set(nativeBinding, addon);
  }
  return { nativeBinding: addon };
}

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

/**
 * DB를 연다: WAL·외래 키 → user_version이 앱보다 높으면 거부 → 적용할 마이그레이션이 있으면
 * backup API로 백업(WAL 내용 포함) 후 전진 적용.
 */
export async function openDatabase(file: string, options: OpenOptions): Promise<OpenResult> {
  const migrations = options.migrations ?? MIGRATIONS;
  if (!options.create && !existsSync(file)) throw new DbOpenError('db_missing', `DB not found: ${file}`);
  const db = new Database(file, {
    fileMustExist: !options.create,
    ...nativeOptions(options.nativeBinding),
  });
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const current = readUserVersion(db);
    const latest = latestVersion(migrations);
    if (current > latest) {
      throw new DbOpenError('schema_too_new', `DB schema ${current} is newer than app ${latest}`);
    }
    let backupPath: string | undefined;
    if (current > 0 && current < latest) {
      backupPath = `${file}.v${current}-${stamp(options.now?.() ?? new Date())}.bak`;
      await db.backup(backupPath);
    }
    const { from, to } = applyMigrations(db, migrations);
    return { db, from, to, ...(backupPath ? { backupPath } : {}) };
  } catch (error) {
    db.close();
    throw error;
  }
}
