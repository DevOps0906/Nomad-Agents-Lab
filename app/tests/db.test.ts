// better-sqlite3 13.2.0(N-API 사전 빌드)을 시스템 Node에서 그대로 쓴다. 실제 사용자 자료 없이 임시 폴더만 쓴다.
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchDocuments, writeDocumentText } from '../src/main/db/fts';
import { MIGRATIONS, applyMigrations, latestVersion, parseMigrations } from '../src/main/db/migrations';
import { DB_FILE_NAME, DbOpenError, openDatabase } from '../src/main/db/open';
import { cleanupAfterRestart } from '../src/main/db/recovery';

let dir: string;
let opened: Database.Database[];

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ssr-db-'));
  opened = [];
});

afterEach(() => {
  for (const db of opened) if (db.open) db.close();
  rmSync(dir, { recursive: true, force: true });
});

async function freshDb() {
  const result = await openDatabase(path.join(dir, DB_FILE_NAME), { create: true });
  opened.push(result.db);
  return result.db;
}

const NOW = '2026-11-20T00:00:00.000Z';

function addSource(db: Database.Database, p = 'C:\\notes'): number {
  return Number(
    db.prepare(`INSERT INTO sources (kind, path, label, created_at) VALUES ('folder', ?, 'notes', ?)`).run(p, NOW)
      .lastInsertRowid,
  );
}

function addDoc(db: Database.Database, sourceId: number, relPath: string, title: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO documents (source_id, rel_path, title, format, size, mtime, content_hash)
         VALUES (?, ?, ?, 'md', 1, 0, 'h')`,
      )
      .run(sourceId, relPath, title).lastInsertRowid,
  );
}

function ftsRows(db: Database.Database) {
  return db.prepare('SELECT rowid AS id, title, body FROM doc_fts ORDER BY rowid').all();
}

describe('마이그레이션(전진 전용)', () => {
  it('파일 이름 규칙과 연속 번호를 검사한다', () => {
    expect(MIGRATIONS[0]?.name).toBe('init');
    expect(() => parseMigrations({ 'x/0002_b.sql': '' })).toThrow(/gap/);
    expect(() => parseMigrations({ 'x/init.sql': '' })).toThrow(/invalid/);
  });

  it('빈 DB → 최신 적용, 재실행은 무변경(멱등)', async () => {
    const db = await freshDb();
    expect(db.pragma('user_version', { simple: true })).toBe(latestVersion());
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const schema = () => db.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all();
    const before = schema();
    expect(applyMigrations(db)).toEqual({ from: latestVersion(), to: latestVersion() });
    expect(schema()).toEqual(before);
    const tables = db
      .prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'doc_fts_%' AND name NOT LIKE 'sqlite_%'`)
      .all()
      .map((r) => (r as { name: string }).name)
      .sort();
    expect(tables).toEqual(
      [
        'doc_fts', 'documents', 'grants', 'index_jobs', 'links', 'run_events', 'runs', 'settings', 'skills',
        'sources', 'tags', 'usage_events',
      ].sort(),
    );
  });

  it('다시 열어도 백업·변경 없음', async () => {
    const file = path.join(dir, DB_FILE_NAME);
    (await freshDb()).close();
    const again = await openDatabase(file, { create: false });
    opened.push(again.db);
    expect(again).toMatchObject({ from: latestVersion(), to: latestVersion() });
    expect(again.backupPath).toBeUndefined();
  });

  it('적용할 마이그레이션이 있으면 먼저 backup API로 백업한다(체크포인트 안 된 WAL 내용 포함)', async () => {
    const file = path.join(dir, DB_FILE_NAME);
    const v1 = await openDatabase(file, { create: true });
    opened.push(v1.db);
    // 다른 연결이 열린 채 자동 체크포인트를 끄고 쓴다 → 내용은 WAL에만 있다.
    v1.db.pragma('wal_autocheckpoint = 0');
    addSource(v1.db, 'C:\\in-wal');
    expect(statSync(`${file}-wal`).size).toBeGreaterThan(0);
    const next = [...MIGRATIONS, { version: 2, name: 'extra', sql: 'CREATE TABLE extra (id INTEGER PRIMARY KEY);' }];
    const v2 = await openDatabase(file, { create: false, migrations: next, now: () => new Date(NOW) });
    opened.push(v2.db);
    expect(v2).toMatchObject({ from: 1, to: 2 });
    expect(v2.backupPath).toBe(`${file}.v1-20261120T000000Z.bak`);
    expect(existsSync(`${v2.backupPath}-wal`)).toBe(false);
    const backup = new Database(v2.backupPath ?? '', { readonly: true });
    opened.push(backup);
    expect(backup.pragma('user_version', { simple: true })).toBe(1);
    expect(backup.prepare('SELECT path FROM sources').all()).toEqual([{ path: 'C:\\in-wal' }]);
  });

  it('user_version이 앱보다 높으면 열기를 거부한다', async () => {
    const db = await freshDb();
    db.pragma(`user_version = ${latestVersion() + 1}`);
    db.close();
    await expect(openDatabase(path.join(dir, DB_FILE_NAME), { create: false })).rejects.toMatchObject({
      code: 'schema_too_new',
    });
  });

  it('create=false면 DB 파일을 만들지 않는다', async () => {
    await expect(openDatabase(path.join(dir, DB_FILE_NAME), { create: false })).rejects.toBeInstanceOf(DbOpenError);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('실패한 마이그레이션은 되돌려지고 user_version이 그대로다', async () => {
    const db = await freshDb();
    const bad = [...MIGRATIONS, { version: 2, name: 'bad', sql: 'CREATE TABLE t2 (a); SELECT nope FROM missing;' }];
    expect(() => applyMigrations(db, bad)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(db.prepare(`SELECT name FROM sqlite_schema WHERE name = 't2'`).get()).toBeUndefined();
  });
});

describe('doc_fts 동기화·검색(trigram)', () => {
  it('문서 삽입·제목 갱신·삭제·삭제 표시·복원이 doc_fts에 반영된다', async () => {
    const db = await freshDb();
    const src = addSource(db);
    const id = addDoc(db, src, 'a.md', '회의록');
    expect(ftsRows(db)).toEqual([{ id, title: '회의록', body: '' }]);
    expect(writeDocumentText(db, id, '데이터베이스 마이그레이션 계획')).toBe(true);
    db.prepare('UPDATE documents SET title = ? WHERE id = ?').run('주간 회의록', id);
    expect(ftsRows(db)).toEqual([{ id, title: '주간 회의록', body: '데이터베이스 마이그레이션 계획' }]);
    db.prepare(`UPDATE documents SET status = 'deleted' WHERE id = ?`).run(id);
    expect(ftsRows(db)).toEqual([]);
    expect(writeDocumentText(db, id, 'x')).toBe(false);
    db.prepare(`UPDATE documents SET status = 'ok' WHERE id = ?`).run(id);
    expect(ftsRows(db)).toEqual([{ id, title: '주간 회의록', body: '' }]);
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    expect(ftsRows(db)).toEqual([]);
  });

  it('삭제 상태로 삽입한 문서는 검색에 안 나오고, 복원하면 오류 없이 나온다', async () => {
    const db = await freshDb();
    const src = addSource(db);
    const id = Number(
      db
        .prepare(
          `INSERT INTO documents (source_id, rel_path, title, format, size, mtime, content_hash, status)
           VALUES (?, 'gone.md', '사라진 문서', 'md', 1, 0, 'h', 'deleted')`,
        )
        .run(src).lastInsertRowid,
    );
    expect(ftsRows(db)).toEqual([]);
    expect(searchDocuments(db, '사라진').hits).toEqual([]);
    db.prepare(`UPDATE documents SET status = 'ok' WHERE id = ?`).run(id);
    expect(searchDocuments(db, '사라진').hits).toEqual([{ id, title: '사라진 문서' }]);
    // 이미 FTS 행이 있는 상태에서 다시 복원 경로를 타도 중복 rowid 오류가 없다.
    db.prepare(`UPDATE documents SET status = 'deleted' WHERE id = ?`).run(id);
    db.prepare(`UPDATE documents SET status = 'error' WHERE id = ?`).run(id);
    expect(ftsRows(db)).toHaveLength(1);
  });

  it('소스 삭제 연쇄로 문서가 지워져도 doc_fts가 따라 지워진다', async () => {
    const db = await freshDb();
    const src = addSource(db);
    addDoc(db, src, 'a.md', '첫째');
    addDoc(db, src, 'b.md', '둘째');
    db.prepare('DELETE FROM sources WHERE id = ?').run(src);
    expect(db.prepare('SELECT count(*) AS n FROM documents').get()).toEqual({ n: 0 });
    expect(ftsRows(db)).toEqual([]);
  });

  it('한국어 부분 검색(3글자 이상은 FTS, 2글자 이하는 LIKE 경로)', async () => {
    const db = await freshDb();
    const src = addSource(db);
    const a = addDoc(db, src, 'a.md', '설계 노트');
    const b = addDoc(db, src, 'b.md', '회의록');
    writeDocumentText(db, a, '데이터베이스 마이그레이션 계획과 100% 완료');
    writeDocumentText(db, b, '다음 주 일정 정리');
    const c = addDoc(db, src, 'c.md', '예산');
    writeDocumentText(db, c, '1000원 단위 a-b'); // %·_ 없는 대조 자료(이스케이프가 없으면 걸림)

    expect(searchDocuments(db, '베이스')).toEqual({ mode: 'fts', hits: [{ id: a, title: '설계 노트' }] });
    expect(searchDocuments(db, '마이그레 계획과')).toMatchObject({ mode: 'fts', hits: [{ id: a }] });
    expect(searchDocuments(db, '일정')).toEqual({ mode: 'like', hits: [{ id: b, title: '회의록' }] });
    expect(searchDocuments(db, '설계')).toMatchObject({ mode: 'like', hits: [{ id: a }] });
    expect(searchDocuments(db, '정 다음')).toMatchObject({ mode: 'like', hits: [{ id: b }] });
    expect(searchDocuments(db, '0%')).toEqual({ mode: 'like', hits: [{ id: a, title: '설계 노트' }] });
    expect(searchDocuments(db, 'a_b')).toEqual({ mode: 'fts', hits: [] });
    expect(searchDocuments(db, '_')).toEqual({ mode: 'like', hits: [] });
    expect(searchDocuments(db, '0원')).toEqual({ mode: 'like', hits: [{ id: c, title: '예산' }] });
    expect(searchDocuments(db, '"따옴표"')).toEqual({ mode: 'fts', hits: [] });
    expect(searchDocuments(db, '   ').hits).toEqual([]);
  });
});

describe('제약·정리 트리거', () => {
  it('links: 자기 자신 금지, (src, dst_key, kind) 중복 금지, 없는 문서(NULL)는 키가 다르면 여러 개 허용', async () => {
    const db = await freshDb();
    const src = addSource(db);
    const a = addDoc(db, src, 'a.md', 'A');
    const b = addDoc(db, src, 'b.md', 'B');
    const add = db.prepare(
      `INSERT INTO links (src_doc_id, dst_doc_id, dst_raw, dst_key, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    add.run(a, b, 'b', 'w:b.md', 'link', NOW);
    add.run(a, b, 'b', 'm:2', 'manual', NOW);
    expect(() => add.run(a, b, 'b.md', 'w:b.md', 'link', NOW)).toThrow(/UNIQUE/);
    expect(() => add.run(a, a, 'a', 'm:1', 'manual', NOW)).toThrow(/CHECK/);
    add.run(a, null, 'x', 'w:x.md', 'link', NOW);
    add.run(a, null, 'y', 'w:y.md', 'link', NOW);
    expect(() => add.run(a, null, 'Y.md', 'w:y.md', 'link', NOW)).toThrow(/UNIQUE/);
    db.prepare('DELETE FROM documents WHERE id = ?').run(b);
    expect(db.prepare('SELECT count(*) AS n FROM links WHERE dst_doc_id IS NULL').get()).toEqual({ n: 4 });
  });

  it('documents.rel_path는 같은 소스 안에서 대소문자 무시 유일', async () => {
    const db = await freshDb();
    const src = addSource(db);
    addDoc(db, src, 'Notes/A.md', 'A');
    expect(() => addDoc(db, src, 'notes/a.md', 'a')).toThrow(/UNIQUE/);
  });

  it('소스 삭제 시 grants.folders_json에서 그 id를 뺀다', async () => {
    const db = await freshDb();
    const s1 = addSource(db, 'C:\\one');
    const s2 = addSource(db, 'C:\\two');
    const add = db.prepare(`INSERT INTO grants (skill_name, folders_json, tools_json, created_at) VALUES ('k', ?, '[]', ?)`);
    add.run(JSON.stringify([s1, s2]), NOW);
    add.run(JSON.stringify([s2]), NOW);
    db.prepare('DELETE FROM sources WHERE id = ?').run(s2);
    expect(db.prepare('SELECT folders_json FROM grants ORDER BY id').all()).toEqual([
      { folders_json: JSON.stringify([s1]) },
      { folders_json: '[]' },
    ]);
  });
});

describe('재시작 정리', () => {
  it('실행 중 run → failed/interrupted, 미완료 색인 작업 → interrupted, indexing 소스 → ok', async () => {
    const db = await freshDb();
    const src = addSource(db);
    db.prepare(`UPDATE sources SET status = 'indexing' WHERE id = ?`).run(src);
    const insertRun = db.prepare(
      `INSERT INTO runs (skill_name, skill_hash, input_json, scope_json, provider_label,
         external_processing_consent_at, status, started_at) VALUES ('s', 'h', '{}', '{}', 'p', ?, ?, ?)`,
    );
    for (const status of ['starting', 'running', 'waiting_permission', 'succeeded']) insertRun.run(NOW, status, NOW);
    db.prepare(`INSERT INTO index_jobs (source_id, started_at, status) VALUES (?, ?, 'running')`).run(src, NOW);
    db.prepare(
      `INSERT INTO index_jobs (source_id, started_at, finished_at, status) VALUES (?, ?, ?, 'succeeded')`,
    ).run(src, NOW, NOW);

    const later = new Date('2026-11-21T00:00:00.000Z');
    expect(cleanupAfterRestart(db, later)).toEqual({ runs: 3, indexJobs: 1, sources: 1 });
    expect(db.prepare('SELECT status, error_code, ended_at FROM runs ORDER BY id').all()).toEqual([
      { status: 'failed', error_code: 'interrupted', ended_at: later.toISOString() },
      { status: 'failed', error_code: 'interrupted', ended_at: later.toISOString() },
      { status: 'failed', error_code: 'interrupted', ended_at: later.toISOString() },
      { status: 'succeeded', error_code: null, ended_at: null },
    ]);
    expect(db.prepare('SELECT status FROM index_jobs ORDER BY id').all()).toEqual([
      { status: 'interrupted' },
      { status: 'succeeded' },
    ]);
    expect(db.prepare('SELECT status FROM sources').get()).toEqual({ status: 'ok' });
    expect(cleanupAfterRestart(db, later)).toEqual({ runs: 0, indexJobs: 0, sources: 0 });
  });

  it('외부 처리 동의 시각 없는 run은 저장되지 않는다', async () => {
    const db = await freshDb();
    expect(() =>
      db
        .prepare(
          `INSERT INTO runs (skill_name, skill_hash, input_json, scope_json, provider_label, status, started_at)
           VALUES ('s', 'h', '{}', '{}', 'p', 'starting', ?)`,
        )
        .run(NOW),
    ).toThrow(/NOT NULL/);
    expect(existsSync(path.join(dir, DB_FILE_NAME))).toBe(true);
  });
});
