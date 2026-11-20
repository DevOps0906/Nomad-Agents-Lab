// 연결 폴더(A-02 sources.list·add·remove). 새 경로는 Main 대화상자 결과만 쓴다. 샘플 소스는 슬라이스 1에서 제외.
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { SourceAddResult, SourceItem } from '../../shared/ipc';
import { type BusyLock, IpcError } from '../ipc/router';
import { type FolderPolicyContext, checkFolder, overlaps } from '../onboarding/folders';
import type { PickFolder } from '../onboarding/service';

export interface DataStore {
  readonly db: Database.Database;
  readonly dataDir: string;
}

export interface SourcesDeps {
  /** ready가 아니면 null(데이터 위치 지정 전). setDataDir 이후 새 핸들을 돌려준다. */
  readonly store: () => DataStore | null;
  readonly policy: FolderPolicyContext;
  readonly pickFolder: PickFolder;
  readonly exclusive: BusyLock;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

interface SourceRow {
  id: number;
  kind: 'folder' | 'sample';
  path: string;
  label: string;
  status: 'ok' | 'missing' | 'indexing';
  document_count: number;
  last_indexed_at: string | null;
}

const SELECT_SOURCES = `
  SELECT s.id, s.kind, s.path, s.label, s.status, s.last_indexed_at,
    (SELECT count(*) FROM documents d WHERE d.source_id = s.id AND d.status = 'ok') AS document_count
  FROM sources s`;

function toItem(row: SourceRow): SourceItem {
  return {
    id: row.id,
    kind: row.kind,
    path: row.path,
    label: row.label,
    status: row.status,
    documentCount: row.document_count,
    lastIndexedAt: row.last_indexed_at,
  };
}

export function createSources(deps: SourcesDeps) {
  const log = deps.log ?? (() => {});
  const requireStore = (): DataStore => {
    const store = deps.store();
    if (!store) throw new IpcError('E_OUT_OF_SCOPE');
    return store;
  };
  const reject = (reason: string): never => {
    log(`sources.add rejected: ${reason}`);
    throw new IpcError('E_VALIDATION');
  };

  function list(): SourceItem[] {
    const { db } = requireStore();
    return (db.prepare(`${SELECT_SOURCES} ORDER BY s.id`).all() as SourceRow[]).map(toItem);
  }

  async function add(sender: unknown): Promise<SourceAddResult> {
    requireStore();
    return deps.exclusive(async () => {
      const picked = await deps.pickFolder(sender);
      if (picked === null) return { source: null };
      const { db, dataDir } = requireStore();
      const checked = await checkFolder(picked, deps.policy, { sensitive: true });
      if ('rejected' in checked) return reject(checked.rejected);
      const { real } = checked;
      if (overlaps(real, dataDir)) return reject('overlap_data_dir');
      const existing = db.prepare('SELECT path FROM sources').all() as { path: string }[];
      if (existing.some((r) => overlaps(real, r.path))) return reject('overlap_source');
      const label = path.basename(real) || real;
      const createdAt = (deps.now?.() ?? new Date()).toISOString();
      let id: number;
      try {
        id = Number(
          db
            .prepare(`INSERT INTO sources (kind, path, label, created_at) VALUES ('folder', ?, ?, ?)`)
            .run(real, label, createdAt).lastInsertRowid,
        );
      } catch (error) {
        if ((error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') return reject('duplicate');
        throw error;
      }
      log(`sources.add done id=${id}`);
      const row = db.prepare(`${SELECT_SOURCES} WHERE s.id = ?`).get(id) as SourceRow;
      return { source: toItem(row) };
    });
  }

  function remove(sourceId: number): { readonly removed: true } {
    const { db } = requireStore();
    const row = db.prepare('SELECT status FROM sources WHERE id = ?').get(sourceId) as
      | { status: SourceRow['status'] }
      | undefined;
    if (!row) throw new IpcError('E_NOT_FOUND');
    if (row.status === 'indexing') throw new IpcError('E_BUSY');
    db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
    log(`sources.remove done id=${sourceId}`);
    return { removed: true };
  }

  return { list, add, remove };
}
