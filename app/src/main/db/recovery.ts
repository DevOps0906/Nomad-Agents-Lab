import type Database from 'better-sqlite3';

export interface CleanupCounts {
  readonly runs: number;
  readonly indexJobs: number;
  readonly sources: number;
}

/**
 * 앱 재시작 직후 1회: 이전 프로세스가 끝내지 못한 작업을 정리한다.
 * - runs: starting·running·waiting_permission → failed(error_code=interrupted)
 * - index_jobs: 미완료 → interrupted
 * - sources: indexing → ok(마지막 색인 결과 유지, 다음 색인에서 갱신)
 */
export function cleanupAfterRestart(db: Database.Database, now: Date = new Date()): CleanupCounts {
  const ts = now.toISOString();
  return db.transaction(() => ({
    runs: db
      .prepare(
        `UPDATE runs SET status = 'failed', error_code = 'interrupted', ended_at = coalesce(ended_at, ?)
         WHERE status IN ('starting', 'running', 'waiting_permission')`,
      )
      .run(ts).changes,
    indexJobs: db
      .prepare(
        `UPDATE index_jobs SET status = 'interrupted', finished_at = coalesce(finished_at, ?)
         WHERE status = 'running' OR finished_at IS NULL`,
      )
      .run(ts).changes,
    sources: db.prepare(`UPDATE sources SET status = 'ok' WHERE status = 'indexing'`).run().changes,
  }))();
}
