import type Database from 'better-sqlite3';

/** trigram 토크나이저는 3글자 이상 검색어만 색인으로 찾는다. 더 짧은 검색어는 LIKE로 대체한다. */
export const TRIGRAM_MIN_CHARS = 3;

export interface SearchHit {
  readonly id: number;
  readonly title: string;
}

export interface SearchResult {
  readonly mode: 'fts' | 'like';
  readonly hits: SearchHit[];
}

/** 공백으로 나눈 검색어(모두 포함해야 일치) */
export function splitTerms(query: string): string[] {
  return query.trim().split(/\s+/u).filter(Boolean);
}

function ftsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** 제목·본문 부분 검색. 3글자 미만 검색어가 하나라도 있으면 전체를 LIKE 경로로 찾는다. */
export function searchDocuments(db: Database.Database, query: string, limit = 50): SearchResult {
  const terms = splitTerms(query);
  if (terms.length === 0) return { mode: 'fts', hits: [] };
  if (terms.every((t) => [...t].length >= TRIGRAM_MIN_CHARS)) {
    const hits = db
      .prepare(
        `SELECT d.id AS id, d.title AS title FROM doc_fts JOIN documents d ON d.id = doc_fts.rowid
         WHERE doc_fts MATCH ? ORDER BY bm25(doc_fts) LIMIT ?`,
      )
      .all(terms.map(ftsPhrase).join(' '), limit) as SearchHit[];
    return { mode: 'fts', hits };
  }
  const where = terms.map(() => `(f.title LIKE ? ESCAPE '\\' OR f.body LIKE ? ESCAPE '\\')`).join(' AND ');
  const params = terms.flatMap((t) => [likePattern(t), likePattern(t)]);
  const hits = db
    .prepare(
      `SELECT d.id AS id, d.title AS title FROM doc_fts f JOIN documents d ON d.id = f.rowid
       WHERE ${where} ORDER BY d.id LIMIT ?`,
    )
    .all(...params, limit) as SearchHit[];
  return { mode: 'like', hits };
}

/** 색인기가 추출한 본문을 넣는다(행이 없으면 만들고, 있으면 바꾼다). 삭제 표시 문서는 넣지 않는다. */
export function writeDocumentText(db: Database.Database, docId: number, body: string): boolean {
  return db.transaction(() => {
    const doc = db
      .prepare(`SELECT title FROM documents WHERE id = ? AND status <> 'deleted'`)
      .get(docId) as { title: string } | undefined;
    if (!doc) return false;
    db.prepare('DELETE FROM doc_fts WHERE rowid = ?').run(docId);
    db.prepare('INSERT INTO doc_fts (rowid, title, body) VALUES (?, ?, ?)').run(docId, doc.title, body);
    return true;
  })();
}
