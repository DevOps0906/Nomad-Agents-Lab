// 링크 대상 해석: dst_doc_id가 NULL이거나 deleted 문서를 가리키는 `link` 행을 dst_key로 다시 찾는다.
// 같은 소스 안에서만 해석한다. 소스 밖(`x:`)·다른 소스는 미해석으로 남긴다.
import path from 'node:path';
import type Database from 'better-sqlite3';

interface LiveDoc {
  id: number;
  rel: string;
  depth: number;
  dir: string;
}

interface PendingLink {
  id: number;
  src_doc_id: number;
  src_rel: string;
  dst_key: string;
}

/** 위키링크 후보 순위: 같은 폴더 우선 → 경로가 짧은 것(폴더 깊이) → id 오름차순 */
function pick(candidates: LiveDoc[], srcDir: string, srcId: number): number | null {
  let best: LiveDoc | null = null;
  const rank = (d: LiveDoc): [number, number, number] => [d.dir === srcDir ? 0 : 1, d.depth, d.id];
  for (const d of candidates) {
    if (d.id === srcId) continue;
    if (!best) {
      best = d;
      continue;
    }
    const [a, b] = [rank(d), rank(best)];
    if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best = d;
  }
  return best ? best.id : null;
}

/** 해석한 행 수를 돌려준다. */
export function resolveLinks(db: Database.Database, sourceId: number): number {
  const live = (
    db
      .prepare(`SELECT id, rel_path AS rel FROM documents WHERE source_id = ? AND status <> 'deleted'`)
      .all(sourceId) as { id: number; rel: string }[]
  ).map((d): LiveDoc => {
    const rel = d.rel.toLowerCase();
    return { id: d.id, rel, depth: rel.split('/').length, dir: path.posix.dirname(rel) };
  });
  const byPath = new Map(live.map((d) => [d.rel, d]));
  const byName = new Map<string, LiveDoc[]>();
  for (const d of live) {
    const name = path.posix.basename(d.rel);
    const list = byName.get(name);
    if (list) list.push(d);
    else byName.set(name, [d]);
  }

  const pending = db
    .prepare(
      `SELECT l.id, l.src_doc_id, s.rel_path AS src_rel, l.dst_key FROM links l
       JOIN documents s ON s.id = l.src_doc_id
       LEFT JOIN documents d ON d.id = l.dst_doc_id
       WHERE s.source_id = ? AND l.kind = 'link' AND (l.dst_doc_id IS NULL OR d.status = 'deleted')`,
    )
    .all(sourceId) as PendingLink[];

  const update = db.prepare('UPDATE links SET dst_doc_id = ? WHERE id = ?');
  let resolved = 0;
  db.transaction(() => {
    for (const link of pending) {
      const srcRel = link.src_rel.toLowerCase();
      let dst: number | null = null;
      if (link.dst_key.startsWith('p:')) {
        const d = byPath.get(link.dst_key.slice(2));
        dst = d && d.id !== link.src_doc_id ? d.id : null;
      } else if (link.dst_key.startsWith('w:')) {
        const key = link.dst_key.slice(2);
        const candidates = (byName.get(path.posix.basename(key)) ?? []).filter(
          (d) => d.rel === key || d.rel.endsWith(`/${key}`),
        );
        dst = pick(candidates, path.posix.dirname(srcRel), link.src_doc_id);
      }
      if (dst !== null) {
        update.run(dst, link.id);
        resolved += 1;
      }
    }
  })();
  return resolved;
}
