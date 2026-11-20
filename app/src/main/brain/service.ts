// 목록 검색(A-04)·문서 미리보기·원본 열기(A-06). 응답에 절대 경로를 넣지 않는다(소스 이름 + 상대 경로).
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { TRIGRAM_MIN_CHARS, splitTerms } from '../db/fts';
import { IpcError } from '../ipc/router';
import {
  type DocPreview,
  type OpenExternalResult,
  type RelatedNode,
  SEARCH_PAGE_SIZE,
  type SearchItem,
  type SearchQueryInput,
  type SearchQueryResult,
} from '../../shared/ipc';

/** 미리보기 텍스트 상한(글자). 거대 문서는 앞부분만 보낸다. */
export const PREVIEW_MAX_CHARS = 4000;
const EXCERPT_CHARS = 160;
const RELATED_LIMIT = 20;
/** 지금 원본 열기를 허용하는 확장자(PDF는 이후 작업). */
const OPENABLE_EXT = new Set(['.md']);

export interface BrainDeps {
  store(): { db: Database.Database } | null;
  /** electron `shell.openPath`. 성공이면 빈 문자열, 실패면 오류 문구. */
  openPath(file: string): Promise<string>;
  log?: (message: string) => void;
}

const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
const isInside = (child: string, parent: string) => {
  const base = key(parent).endsWith(path.sep) ? key(parent) : key(parent) + path.sep;
  return key(child).startsWith(base);
};
const realpathOf = async (p: string) => (await fsp.realpath(p)).replace(/(?<!^[A-Za-z]:)[\\/]+$/, '');

interface Row {
  id: number;
  title: string;
  rel_path: string;
  format: 'md' | 'pdf';
  label: string;
  excerpt: string | null;
  score: number | null;
}

const ftsPhrase = (term: string) => `"${term.replace(/"/g, '""')}"`;
const likePattern = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** 발췌 안의 줄바꿈·연속 공백을 한 칸으로 줄인다. */
const tidy = (text: string) => text.replace(/\s+/gu, ' ').trim();

interface DocRow {
  id: number;
  title: string;
  rel_path: string;
  format: 'md' | 'pdf';
  mtime: number;
  status: 'ok' | 'error' | 'encrypted' | 'deleted';
  error: string | null;
  indexed_at: string | null;
  label: string;
  root: string;
}

export function createBrain(deps: BrainDeps) {
  const log = deps.log ?? (() => {});
  const requireDb = () => {
    const store = deps.store();
    if (!store) throw new IpcError('E_OUT_OF_SCOPE');
    return store.db;
  };

  function filters(input: SearchQueryInput): { sql: string; params: unknown[] } {
    const parts = [`d.status <> 'deleted'`];
    const params: unknown[] = [];
    if (input.sourceId !== undefined) {
      parts.push('d.source_id = ?');
      params.push(input.sourceId);
    }
    if (input.format) {
      parts.push('d.format = ?');
      params.push(input.format);
    }
    if (input.tag) {
      parts.push('EXISTS (SELECT 1 FROM tags t WHERE t.doc_id = d.id AND t.name = ?)');
      params.push(input.tag.toLowerCase());
    }
    return { sql: parts.join(' AND '), params };
  }

  function ftsRows(db: Database.Database, match: string, input: SearchQueryInput, offset: number): Row[] {
    const f = filters(input);
    return db
      .prepare(
        `SELECT d.id AS id, d.title AS title, d.rel_path AS rel_path, d.format AS format, s.label AS label,
                snippet(doc_fts, 1, '', '', '…', 24) AS excerpt, -bm25(doc_fts) AS score
         FROM doc_fts JOIN documents d ON d.id = doc_fts.rowid JOIN sources s ON s.id = d.source_id
         WHERE doc_fts MATCH ? AND ${f.sql} ORDER BY bm25(doc_fts), d.id LIMIT ? OFFSET ?`,
      )
      .all(match, ...f.params, SEARCH_PAGE_SIZE + 1, offset) as Row[];
  }

  function likeRows(db: Database.Database, terms: string[], input: SearchQueryInput, offset: number): Row[] {
    const f = filters(input);
    const where = terms.map(() => `(w.title LIKE ? ESCAPE '\\' OR w.body LIKE ? ESCAPE '\\')`).join(' AND ');
    return db
      .prepare(
        `SELECT d.id AS id, d.title AS title, d.rel_path AS rel_path, d.format AS format, s.label AS label,
                substr(w.body, 1, ${EXCERPT_CHARS}) AS excerpt, 0 AS score
         FROM doc_fts w JOIN documents d ON d.id = w.rowid JOIN sources s ON s.id = d.source_id
         WHERE ${where} AND ${f.sql} ORDER BY d.id LIMIT ? OFFSET ?`,
      )
      .all(
        ...terms.flatMap((t) => [likePattern(t), likePattern(t)]),
        ...f.params,
        SEARCH_PAGE_SIZE + 1,
        offset,
      ) as Row[];
  }

  function search(input: SearchQueryInput): SearchQueryResult {
    const db = requireDb();
    const page = input.page ?? 1;
    const offset = (page - 1) * SEARCH_PAGE_SIZE;
    const terms = splitTerms(input.query);
    let rows: Row[] = [];
    if (terms.length > 0) {
      // 사용자 FTS 구문은 지원하지 않는다: 토큰마다 따옴표 구절로 감싸 AND. 하나라도 3글자 미만이면 전체 LIKE AND.
      rows = terms.every((t) => Array.from(t).length >= TRIGRAM_MIN_CHARS)
        ? ftsRows(db, terms.map(ftsPhrase).join(' '), input, offset)
        : likeRows(db, terms, input, offset);
    }
    const hasMore = rows.length > SEARCH_PAGE_SIZE;
    const items: SearchItem[] = rows.slice(0, SEARCH_PAGE_SIZE).map((r) => ({
      docId: r.id,
      title: r.title,
      format: r.format,
      sourceLabel: r.label,
      relPath: r.rel_path,
      excerpt: tidy(r.excerpt ?? ''),
      score: Math.round((r.score ?? 0) * 100) / 100,
    }));
    log(`search results=${items.length}`);
    return { items, page, hasMore };
  }

  function loadDoc(db: Database.Database, docId: number): DocRow {
    const row = db
      .prepare(
        `SELECT d.id, d.title, d.rel_path, d.format, d.mtime, d.status, d.error, d.indexed_at,
                s.label AS label, s.path AS root
         FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ?`,
      )
      .get(docId) as DocRow | undefined;
    if (!row) throw new IpcError('E_NOT_FOUND');
    // 삭제된 문서는 연결 폴더 안에 더는 없는 것으로 본다(A-06).
    if (row.status === 'deleted') throw new IpcError('E_OUT_OF_SCOPE');
    return row;
  }

  function preview(docId: number): DocPreview {
    const db = requireDb();
    const row = loadDoc(db, docId);
    const body =
      (db.prepare('SELECT body FROM doc_fts WHERE rowid = ?').get(docId) as { body: string } | undefined)?.body ?? '';
    const chars = Array.from(body.slice(0, PREVIEW_MAX_CHARS * 2));
    const textTruncated = body.length > PREVIEW_MAX_CHARS && chars.length > PREVIEW_MAX_CHARS;
    const tags = (db.prepare('SELECT name FROM tags WHERE doc_id = ? ORDER BY name').all(docId) as { name: string }[]).map(
      (t) => t.name,
    );
    const out = db
      .prepare(
        `SELECT l.kind AS kind, l.dst_raw AS raw, l.dst_doc_id AS dst, d.title AS title, d.status AS status
         FROM links l LEFT JOIN documents d ON d.id = l.dst_doc_id
         WHERE l.src_doc_id = ? ORDER BY l.id LIMIT ?`,
      )
      .all(docId, RELATED_LIMIT) as {
      kind: 'link' | 'manual';
      raw: string;
      dst: number | null;
      title: string | null;
      status: string | null;
    }[];
    const back = db
      .prepare(
        `SELECT d.id AS id, d.title AS title FROM links l JOIN documents d ON d.id = l.src_doc_id
         WHERE l.dst_doc_id = ? AND d.status <> 'deleted' ORDER BY l.id LIMIT ?`,
      )
      .all(docId, RELATED_LIMIT) as { id: number; title: string }[];
    const related: RelatedNode[] = [
      ...out.map((l): RelatedNode => {
        const alive = l.dst !== null && l.status !== null && l.status !== 'deleted';
        return { docId: alive ? l.dst : null, title: alive ? (l.title as string) : l.raw, reason: l.kind };
      }),
      ...back.map((b): RelatedNode => ({ docId: b.id, title: b.title, reason: 'backlink' })),
    ];
    return {
      docId: row.id,
      title: row.title,
      format: row.format,
      sourceLabel: row.label,
      relPath: row.rel_path,
      mtime: row.mtime,
      indexedAt: row.indexed_at,
      status: row.status as DocPreview['status'],
      error: row.error,
      tags,
      text: chars.slice(0, PREVIEW_MAX_CHARS).join(''),
      textTruncated,
      related,
    };
  }

  /** 색인된 문서(ok·.md)만, 열기 직전 realpath가 연결 폴더 안일 때만 OS 기본 앱으로 연다. */
  async function openExternal(docId: number): Promise<OpenExternalResult> {
    const db = requireDb();
    const row = loadDoc(db, docId);
    if (row.status !== 'ok' || !OPENABLE_EXT.has(path.extname(row.rel_path).toLowerCase())) {
      throw new IpcError('E_OUT_OF_SCOPE');
    }
    let realRoot: string;
    let real: string;
    try {
      realRoot = await realpathOf(row.root);
      real = await realpathOf(path.join(row.root, ...row.rel_path.split('/')));
    } catch (error) {
      throw new IpcError((error as { code?: string }).code === 'ENOENT' ? 'E_NOT_FOUND' : 'E_OUT_OF_SCOPE');
    }
    // 저장된 소스 경로가 다른 곳으로 바뀌었거나, 파일이 링크로 밖을 가리키면 거부한다.
    if (
      key(realRoot) !== key(row.root) ||
      !isInside(real, realRoot) ||
      !OPENABLE_EXT.has(path.extname(real).toLowerCase())
    ) {
      throw new IpcError('E_OUT_OF_SCOPE');
    }
    // 열기 직전: 일반 파일(링크·폴더 아님)인지 다시 보고, 그 사이 문서·소스가 바뀌지 않았는지 확인한다.
    // 이 확인과 shell.openPath 사이의 짧은 교체 창(TOCTOU)은 남는다(tasks/task-020.md 잔여 위험).
    try {
      const st = await fsp.lstat(real);
      if (!st.isFile() || st.isSymbolicLink()) throw new IpcError('E_OUT_OF_SCOPE');
    } catch (error) {
      if (error instanceof IpcError) throw error;
      throw new IpcError((error as { code?: string }).code === 'ENOENT' ? 'E_NOT_FOUND' : 'E_OUT_OF_SCOPE');
    }
    const again = loadDoc(db, docId);
    if (again.status !== 'ok' || key(again.root) !== key(row.root) || again.rel_path !== row.rel_path) {
      throw new IpcError('E_OUT_OF_SCOPE');
    }
    const failure = await deps.openPath(real);
    log(`doc.openExternal ${failure === '' ? 'opened' : 'failed'}`);
    return { opened: failure === '' };
  }

  return { search, preview, openExternal };
}
