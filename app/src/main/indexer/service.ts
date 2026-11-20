// Markdown 색인(A-03 index.preview·start·status). Main에서 비동기 fs + 50개 단위 트랜잭션 + 배치 사이 setImmediate 양보.
// 색인 작업은 전체에서 동시 1개(중복 start는 E_BUSY). 원본은 읽기만 한다.
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  IndexCounts,
  IndexFailure,
  IndexFileError,
  IndexJobError,
  IndexJobItem,
  IndexPreview,
  IndexStartResult,
  IndexStatus,
} from '../../shared/ipc';
import { writeDocumentText } from '../db/fts';
import { IpcError } from '../ipc/router';
import type { DataStore } from '../sources/service';
import { PARSER_VERSION, type ParsedDoc, decodeText, parseMarkdown } from './parse';
import { resolveLinks } from './resolve';
import { type WalkFile, type WalkOptions, walkSource } from './walk';

/** 파일 크기 상한 기본값 5MB(PRD Q14). 초과는 too_large로 건너뛴다. */
export const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const DEFAULT_BATCH_SIZE = 50;
/** 배치 안에서 동시에 읽는 파일 수 */
export const READ_CONCURRENCY = 8;
/** index.status가 돌려주는 실패 파일 최대 수 */
export const FAILURE_LIMIT = 200;
/** 작업 결과에 남기는 읽지 못한 경로 최대 수 */
export const UNREADABLE_LIMIT = 50;

export interface IndexerDeps {
  readonly store: () => DataStore | null;
  readonly maxFileSize?: number;
  readonly batchSize?: number;
  /** 배치 사이 양보(기본 setImmediate). 테스트가 바꿔 끼운다. */
  readonly yieldFn?: () => Promise<void>;
  /** 배치 하나를 끝낼 때마다(처리 시간 ms). 측정·테스트용. */
  readonly onBatch?: (ms: number) => void;
  /** 파일을 열기 직전(테스트에서 읽기 대기 중 중단·종료 경합을 만든다) */
  readonly onRead?: (rel: string) => void;
  /** 테스트용 순회 fs 대체(오류 주입) */
  readonly walkFs?: WalkOptions['fs'];
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
}

interface SourceRow {
  id: number;
  path: string;
}

interface DocRow {
  id: number;
  rel_path: string;
  size: number;
  mtime: number;
  content_hash: string;
  status: 'ok' | 'error' | 'encrypted' | 'deleted';
  parser_version: number;
}

type FileOutcome =
  | { kind: 'unchanged'; file: WalkFile; row: DocRow; touch: boolean }
  | { kind: 'ok'; file: WalkFile; row: DocRow | undefined; hash: string; text: string; parsed: ParsedDoc }
  | { kind: 'error'; file: WalkFile; row: DocRow | undefined; code: IndexFileError; hash: string };

type MutableCounts = { -readonly [K in keyof IndexCounts]: IndexCounts[K] };

interface Running {
  aborted: boolean;
  readonly progress: Map<number, MutableCounts>;
}

const emptyCounts = (): MutableCounts => ({
  total: 0,
  done: 0,
  processed: 0,
  unchanged: 0,
  failed: 0,
  deleted: 0,
  excluded: 0,
  truncated: 0,
});

const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
const isSameOrInside = (child: string, parent: string) =>
  key(child) === key(parent) || key(child).startsWith(key(parent).endsWith(path.sep) ? key(parent) : key(parent) + path.sep);

/** 연결 폴더 추가(onboarding/folders.ts)와 같은 해석(fs.promises.realpath = OS 실제 경로) */
async function realpathOf(p: string): Promise<string> {
  return (await fsp.realpath(p)).replace(/(?<!^[A-Za-z]:)[\\/]+$/, '');
}

const defaultYield = () => new Promise<void>((resolve) => setImmediate(resolve));

/** 상한+1 바이트까지만 읽는다(그 이상이면 too_large로 판정할 수 있으면 충분). */
async function readLimited(abs: string, max: number, expected: number): Promise<Buffer> {
  const fh = await fsp.open(abs, 'r');
  try {
    // 순회 때 크기만큼 잡고, 그 사이 파일이 커졌으면 상한+1까지 이어 읽는다.
    const chunks: Buffer[] = [];
    let total = 0;
    let size = Math.min(max + 1, expected + 1);
    while (total < max + 1) {
      const buf = Buffer.alloc(size);
      const { bytesRead } = await fh.read(buf, 0, size, total);
      if (bytesRead === 0) break;
      chunks.push(buf.subarray(0, bytesRead));
      total += bytesRead;
      size = Math.min(64 * 1024, max + 1 - total);
    }
    return Buffer.concat(chunks, total);
  } finally {
    await fh.close();
  }
}

/** items를 limit개씩 동시에 처리하고 순서대로 결과를 돌려준다. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function createIndexer(deps: IndexerDeps) {
  const log = deps.log ?? (() => {});
  const maxFileSize = deps.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const yieldFn = deps.yieldFn ?? defaultYield;
  const nowIso = () => (deps.now?.() ?? new Date()).toISOString();
  let running: Running | null = null;
  let finished: Promise<void> = Promise.resolve();

  const requireStore = (): DataStore => {
    const store = deps.store();
    if (!store) throw new IpcError('E_OUT_OF_SCOPE');
    return store;
  };

  /** 저장된 실제 경로를 다시 realpath해 같은지, 데이터 위치 안이 아닌지 확인한다. */
  async function checkRoot(
    source: SourceRow,
    dataDir: string,
  ): Promise<{ real: string; dataDirReal: string } | { reason: IndexJobError }> {
    let real: string;
    try {
      real = await realpathOf(source.path);
    } catch {
      return { reason: 'root_missing' };
    }
    if (key(real) !== key(source.path)) return { reason: 'root_changed' };
    const dataDirReal = await realpathOf(dataDir).catch(() => dataDir);
    if (isSameOrInside(real, dataDirReal)) return { reason: 'data_dir_overlap' };
    return { real, dataDirReal };
  }

  async function preview(sourceId: number): Promise<IndexPreview> {
    const { db, dataDir } = requireStore();
    const source = db.prepare('SELECT id, path FROM sources WHERE id = ?').get(sourceId) as SourceRow | undefined;
    if (!source) throw new IpcError('E_NOT_FOUND');
    const root = await checkRoot(source, dataDir);
    if ('reason' in root) return { targets: 0, excluded: 0, tooLarge: 0, reason: root.reason };
    const walked = await walkSource(root.real, { dataDirReal: root.dataDirReal, ...(deps.walkFs ? { fs: deps.walkFs } : {}) });
    return {
      targets: walked.files.length,
      excluded: walked.excluded,
      tooLarge: walked.files.filter((f) => f.size > maxFileSize).length,
      reason: null,
    };
  }

  async function classify(file: WalkFile, row: DocRow | undefined, root: string): Promise<FileOutcome> {
    const live = row && row.status !== 'deleted' && row.parser_version === PARSER_VERSION;
    if (live && row.size === file.size && row.mtime === file.mtime) {
      return { kind: 'unchanged', file, row, touch: false };
    }
    if (file.size > maxFileSize) return { kind: 'error', file, row, code: 'too_large', hash: '' };
    let buf: Buffer;
    try {
      // 순회 뒤 링크로 바뀌었을 수 있으므로 읽기 직전 실제 경로가 소스 루트 아래인지 다시 본다.
      const real = await realpathOf(file.abs);
      if (!isSameOrInside(real, root) || key(real) === key(root)) {
        return { kind: 'error', file, row, code: 'out_of_scope', hash: '' };
      }
      deps.onRead?.(file.rel);
      buf = await readLimited(file.abs, maxFileSize, file.size);
    } catch {
      return { kind: 'error', file, row, code: 'read_failed', hash: '' };
    }
    if (buf.length > maxFileSize) return { kind: 'error', file, row, code: 'too_large', hash: '' };
    const hash = createHash('sha256').update(buf).digest('hex');
    if (live && row.status === 'ok' && row.content_hash === hash) return { kind: 'unchanged', file, row, touch: true };
    const decoded = decodeText(buf);
    if ('error' in decoded) return { kind: 'error', file, row, code: decoded.error, hash };
    return { kind: 'ok', file, row, hash, text: decoded.text, parsed: parseMarkdown(decoded.text, file.rel) };
  }

  /** 배치 1개를 한 트랜잭션으로 쓴다. 성공했을 때만 반영할 건수를 돌려준다. */
  function apply(db: Database.Database, sourceId: number, outcomes: FileOutcome[]): Partial<MutableCounts> {
    const ts = nowIso();
    const insertDoc = db.prepare(
      `INSERT INTO documents (source_id, rel_path, title, format, size, mtime, content_hash, status, error, indexed_at, parser_version)
       VALUES (?, ?, ?, 'md', ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateDoc = db.prepare(
      `UPDATE documents SET rel_path = ?, title = ?, format = 'md', size = ?, mtime = ?, content_hash = ?, status = ?,
         error = ?, indexed_at = ?, parser_version = ? WHERE id = ?`,
    );
    const touchDoc = db.prepare('UPDATE documents SET rel_path = ?, size = ?, mtime = ? WHERE id = ?');
    const clearLinks = db.prepare(`DELETE FROM links WHERE src_doc_id = ? AND kind = 'link'`);
    const addLink = db.prepare(
      `INSERT INTO links (src_doc_id, dst_doc_id, dst_raw, dst_key, kind, created_at) VALUES (?, NULL, ?, ?, 'link', ?)`,
    );
    const clearTags = db.prepare('DELETE FROM tags WHERE doc_id = ?');
    const addTag = db.prepare('INSERT OR IGNORE INTO tags (doc_id, name, origin) VALUES (?, ?, ?)');

    const upsert = (o: Exclude<FileOutcome, { kind: 'unchanged' }>, title: string, status: 'ok' | 'error'): number => {
      const error = o.kind === 'error' ? o.code : null;
      // read_failed·out_of_scope는 다음 색인에서 다시 시도하도록 mtime을 맞추지 않는다.
      const retry = o.kind === 'error' && (o.code === 'read_failed' || o.code === 'out_of_scope');
      const values = [title, o.file.size, retry ? -1 : o.file.mtime, o.hash, status, error, ts, PARSER_VERSION] as const;
      if (o.row) {
        updateDoc.run(o.file.rel, ...values, o.row.id);
        return o.row.id;
      }
      return Number(insertDoc.run(sourceId, o.file.rel, ...values).lastInsertRowid);
    };

    const delta = { processed: 0, unchanged: 0, failed: 0, truncated: 0 };
    db.transaction(() => {
      for (const o of outcomes) {
        if (o.kind === 'unchanged') {
          if (o.touch || o.row.rel_path !== o.file.rel) touchDoc.run(o.file.rel, o.file.size, o.file.mtime, o.row.id);
          delta.unchanged += 1;
          continue;
        }
        const stem = o.file.rel.split('/').pop() as string;
        const id = upsert(o, o.kind === 'ok' ? o.parsed.title : stem, o.kind === 'ok' ? 'ok' : 'error');
        writeDocumentText(db, id, o.kind === 'ok' ? o.text : '');
        clearLinks.run(id);
        clearTags.run(id);
        if (o.kind === 'ok') {
          for (const link of o.parsed.links) addLink.run(id, link.raw, link.key, ts);
          for (const tag of o.parsed.tags) addTag.run(id, tag.name, tag.origin);
          delta.processed += 1;
          if (o.parsed.truncated) delta.truncated += 1;
        } else {
          delta.failed += 1;
        }
      }
    })();
    return delta;
  }

  async function runSource(db: Database.Database, dataDir: string, source: SourceRow, jobId: number, state: Running) {
    const counts = state.progress.get(jobId) as MutableCounts;
    const stopped = () => state.aborted || !db.open;
    let unreadable: string[] = [];
    const finish = (
      status: 'succeeded' | 'partial' | 'failed',
      reason: IndexJobError | null,
      sourceStatus: 'ok' | 'missing',
    ) => {
      if (!db.open) return;
      const ts = nowIso();
      db.transaction(() => {
        db.prepare('UPDATE index_jobs SET status = ?, finished_at = ?, counts = ? WHERE id = ?').run(
          status,
          ts,
          JSON.stringify({ ...counts, reason, unreadable: unreadable.slice(0, UNREADABLE_LIMIT) }),
          jobId,
        );
        // 마지막 색인 시각은 완전한 순회로 끝났을 때만 바꾼다.
        db.prepare(
          `UPDATE sources SET status = ?, last_indexed_at = CASE WHEN ? THEN ? ELSE last_indexed_at END WHERE id = ?`,
        ).run(sourceStatus, status === 'succeeded' ? 1 : 0, ts, source.id);
      })();
      log(`index job ${jobId} ${status}${reason ? ` ${reason}` : ''} ${JSON.stringify(counts)}`);
    };

    try {
      const root = await checkRoot(source, dataDir);
      if (stopped()) return;
      if ('reason' in root) {
        finish('failed', root.reason, root.reason === 'root_missing' ? 'missing' : 'ok');
        return;
      }
      const walked = await walkSource(root.real, {
        dataDirReal: root.dataDirReal,
        aborted: stopped,
        ...(deps.walkFs ? { fs: deps.walkFs } : {}),
      });
      if (stopped() || walked.aborted) return;
      unreadable = walked.unreadable;
      counts.total = walked.files.length;
      counts.excluded = walked.excluded;

      const rows = db
        .prepare(
          `SELECT id, rel_path, size, mtime, content_hash, status, parser_version FROM documents WHERE source_id = ?`,
        )
        .all(source.id) as DocRow[];
      const byRel = new Map(rows.map((r) => [r.rel_path.toLowerCase(), r]));
      const seen = new Set<number>();

      for (let i = 0; i < walked.files.length; i += batchSize) {
        const batch = walked.files.slice(i, i + batchSize);
        const outcomes = await mapLimited(batch, READ_CONCURRENCY, (file) => {
          const row = byRel.get(file.rel.toLowerCase());
          if (row) seen.add(row.id);
          return classify(file, row, root.real);
        });
        if (stopped()) return;
        const t0 = performance.now();
        const delta = apply(db, source.id, outcomes);
        for (const [k, v] of Object.entries(delta)) counts[k as keyof MutableCounts] += v;
        counts.done += batch.length;
        deps.onBatch?.(performance.now() - t0);
        await yieldFn();
        if (stopped()) return;
      }

      // 완전히 끝난 순회에서만 보지 못한 문서를 삭제 표시한다(중단·불완전·실패 순회는 보존).
      const complete = unreadable.length === 0;
      if (complete) {
        const gone = rows.filter((r) => r.status !== 'deleted' && !seen.has(r.id));
        db.transaction(() => {
          const mark = db.prepare(`UPDATE documents SET status = 'deleted' WHERE id = ?`);
          const clearTags = db.prepare('DELETE FROM tags WHERE doc_id = ?');
          for (const r of gone) {
            mark.run(r.id);
            clearTags.run(r.id);
          }
        })();
        counts.deleted = gone.length;
      }
      resolveLinks(db, source.id);
      finish(complete ? 'succeeded' : 'partial', null, 'ok');
    } catch {
      if (!stopped()) finish('failed', 'internal', 'ok');
    }
  }

  async function runAll(store: DataStore, sources: SourceRow[], jobIds: number[], state: Running) {
    for (let i = 0; i < sources.length; i += 1) {
      if (state.aborted || !store.db.open) return;
      await runSource(store.db, store.dataDir, sources[i] as SourceRow, jobIds[i] as number, state);
    }
  }

  /** 색인 시작. 진행 중이면 E_BUSY, 없는 소스면 E_NOT_FOUND. 작업은 뒤에서 계속되고 status로 본다. */
  function start(sourceId?: number): IndexStartResult {
    const store = requireStore();
    const { db } = store;
    if (running) throw new IpcError('E_BUSY');
    const sources = (
      sourceId === undefined
        ? db.prepare('SELECT id, path FROM sources ORDER BY id').all()
        : db.prepare('SELECT id, path FROM sources WHERE id = ?').all(sourceId)
    ) as SourceRow[];
    if (sourceId !== undefined && sources.length === 0) throw new IpcError('E_NOT_FOUND');
    const ts = nowIso();
    const jobIds = db.transaction(() =>
      sources.map((s) => {
        db.prepare(`UPDATE sources SET status = 'indexing' WHERE id = ?`).run(s.id);
        return Number(
          db
            .prepare(`INSERT INTO index_jobs (source_id, started_at, status) VALUES (?, ?, 'running')`)
            .run(s.id, ts).lastInsertRowid,
        );
      }),
    )();
    const state: Running = { aborted: false, progress: new Map(jobIds.map((id) => [id, emptyCounts()])) };
    running = state;
    finished = runAll(store, sources, jobIds, state).finally(() => {
      if (running === state) running = null;
    });
    log(`index start jobs=${jobIds.join(',') || 'none'}`);
    return { jobIds };
  }

  function status(): IndexStatus {
    const { db } = requireStore();
    const rows = db
      .prepare(
        `SELECT j.id, j.source_id, j.status, j.started_at, j.finished_at, j.counts FROM index_jobs j
         WHERE j.id = (SELECT max(id) FROM index_jobs WHERE source_id = j.source_id) ORDER BY j.source_id`,
      )
      .all() as {
      id: number;
      source_id: number;
      status: IndexJobItem['status'];
      started_at: string;
      finished_at: string | null;
      counts: string | null;
    }[];
    const jobs = rows.map((r): IndexJobItem => {
      const live = running?.progress.get(r.id);
      const stored = r.counts
        ? (JSON.parse(r.counts) as Partial<IndexCounts> & { reason?: IndexJobError | null; unreadable?: string[] })
        : {};
      const { reason, unreadable, ...rest } = stored;
      return {
        jobId: r.id,
        sourceId: r.source_id,
        status: r.status,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        counts: { ...emptyCounts(), ...rest, ...live },
        reason: reason ?? null,
        unreadable: unreadable ?? [],
      };
    });
    const failures = db
      .prepare(
        `SELECT source_id AS sourceId, rel_path AS relPath, error AS reason FROM documents
         WHERE status = 'error' ORDER BY source_id, rel_path LIMIT ?`,
      )
      .all(FAILURE_LIMIT) as IndexFailure[];
    return { running: running !== null, jobs, failures };
  }

  return {
    preview,
    start,
    status,
    /** 색인 중이면 true(데이터 위치 전환 등은 E_BUSY로 막는다) */
    busy: () => running !== null,
    /** 앱 종료 전: 다음 대기 지점부터 멈춘다. 작업 행은 running으로 남아 재시작 정리에서 interrupted가 된다. */
    stop: () => {
      if (running) running.aborted = true;
    },
    /** 진행 중 작업이 끝날 때까지 기다린다(테스트·종료용). */
    idle: () => finished,
  };
}

export type Indexer = ReturnType<typeof createIndexer>;
