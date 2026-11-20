import type Database from 'better-sqlite3';

/** 순번 SQL 파일 1개. 전진 전용(down 없음). 스키마 버전 정본은 PRAGMA user_version 하나다. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const FILE_PATTERN = /(?:^|\/)(\d{4})_([a-z0-9_]+)\.sql$/;

/** `NNNN_name.sql` → Migration[]. 번호는 1부터 빈틈 없이 이어져야 한다. */
export function parseMigrations(files: Record<string, string>): Migration[] {
  const list = Object.entries(files).map(([file, sql]) => {
    const match = FILE_PATTERN.exec(file.replace(/\\/g, '/'));
    if (!match) throw new Error(`migration file name invalid: ${file}`);
    return { version: Number(match[1]), name: match[2] ?? '', sql };
  });
  list.sort((a, b) => a.version - b.version);
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migration version gap at ${m.version}`);
  });
  return list;
}

/** app/migrations/*.sql을 빌드 때 번들에 넣는다(패키지에 .sql 파일을 따로 싣지 않음). */
export const MIGRATIONS: readonly Migration[] = parseMigrations(
  import.meta.glob<string>('../../../migrations/*.sql', { query: '?raw', import: 'default', eager: true }),
);

export function latestVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.at(-1)?.version ?? 0;
}

export function readUserVersion(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

/** 아직 적용 안 된 파일만 파일마다 한 트랜잭션으로 적용한다. 재실행하면 아무것도 바꾸지 않는다. */
export function applyMigrations(
  db: Database.Database,
  migrations: readonly Migration[] = MIGRATIONS,
): { from: number; to: number } {
  const from = readUserVersion(db);
  const latest = latestVersion(migrations);
  if (from > latest) throw new Error(`user_version ${from} > app ${latest}`);
  for (const m of migrations) {
    if (m.version <= from) continue;
    db.transaction(() => {
      db.exec(m.sql);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
  return { from, to: readUserVersion(db) };
}
