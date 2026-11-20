// 패키지 스모크 전용 Main 진입점(앱 번들에 넣지 않음). 패키지된 Electron 런타임에서
// 번들된 better-sqlite3 + asar.unpacked addon으로 DB 생성·마이그레이션·FTS 검색·재시작 열기를 확인한다.
// 사용법은 app/README.md "DB 스모크" 참고. 임시 폴더만 쓰고 끝나면 지운다.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { BOOT_CONFIG_FILE_NAME } from '../../src/main/boot/config';
import { bootDataStore, createDataStore } from '../../src/main/boot/start';
import { searchDocuments, writeDocumentText } from '../../src/main/db/fts';
import { bundledNativeBindingPath } from '../../src/main/db/open';

async function run(): Promise<Record<string, unknown>> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ssr-db-smoke-'));
  try {
    const nativeBinding = bundledNativeBindingPath(__dirname);
    const configFile = path.join(root, BOOT_CONFIG_FILE_NAME);
    const dataDir = path.join(root, 'data');
    mkdirSync(dataDir);
    const created = await createDataStore(configFile, dataDir, { nativeBinding });
    const db = created.db;
    const src = db
      .prepare(`INSERT INTO sources (kind, path, label, created_at) VALUES ('sample', ?, 's', 'now')`)
      .run(path.join(root, 'sample')).lastInsertRowid;
    const doc = Number(
      db
        .prepare(
          `INSERT INTO documents (source_id, rel_path, title, format, size, mtime, content_hash)
           VALUES (?, 'a.md', '스모크', 'md', 1, 0, 'h')`,
        )
        .run(src).lastInsertRowid,
    );
    writeDocumentText(db, doc, '데이터베이스 마이그레이션');
    db.close();
    const boot = await bootDataStore(configFile, { nativeBinding });
    if (boot.kind !== 'ready') return { ok: false, boot };
    const fts = searchDocuments(boot.open.db, '베이스');
    const like = searchDocuments(boot.open.db, '스모');
    const sqlite = boot.open.db.prepare('SELECT sqlite_version() AS v').get();
    boot.open.db.close();
    return {
      ok: fts.hits.length === 1 && like.hits.length === 1 && like.mode === 'like',
      packaged: app.isPackaged,
      electron: process.versions.electron,
      nativeBinding,
      userVersion: boot.open.to,
      sqlite,
      fts,
      like,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

void app.whenReady().then(async () => {
  try {
    const result = await run();
    console.log(`[db-smoke] ${JSON.stringify(result)}`);
    app.exit(result['ok'] ? 0 : 1);
  } catch (error) {
    console.log(`[db-smoke] error ${(error as Error).stack ?? String(error)}`);
    app.exit(1);
  }
});
