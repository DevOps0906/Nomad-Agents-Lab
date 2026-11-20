import { useCallback, useEffect, useState } from 'react';
import { Button, ProgressBar, Text, makeStyles } from '@fluentui/react-components';
import type { IndexFileError, IndexJobError, IndexStatus, SourceItem } from '../shared/ipc';
import { errorCode, invoke } from './api';

/** 색인 상태 표시(A-03). 진행 중에는 index.status를 500ms마다 다시 읽는다. 검색 화면은 task-020. */
const POLL_MS = 500;

const FILE_ERROR_TEXT: Record<IndexFileError, string> = {
  too_large: '파일이 너무 큼(5MB 초과)',
  binary: '텍스트 파일이 아님',
  read_failed: '읽을 수 없음',
  out_of_scope: '연결 폴더 밖을 가리킴',
};

const JOB_ERROR_TEXT: Record<IndexJobError, string> = {
  root_missing: '폴더를 찾을 수 없습니다.',
  root_changed: '폴더의 실제 위치가 바뀌었습니다. 폴더를 다시 연결하세요.',
  data_dir_overlap: '데이터 위치 안의 폴더는 색인할 수 없습니다.',
  internal: '색인 중 문제가 생겼습니다.',
};

const JOB_STATUS_TEXT = {
  running: '색인 중',
  succeeded: '완료',
  partial: '일부만 완료(읽지 못한 항목 있음)',
  failed: '실패',
  interrupted: '중단됨',
} as const;

const useStyles = makeStyles({
  panel: { display: 'grid', gap: 'calc(var(--spacing) * 4)', maxWidth: '720px', marginTop: 'calc(var(--spacing) * 6)' },
  row: { display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' },
  card: {
    display: 'grid',
    gap: 'calc(var(--spacing) * 2)',
    padding: 'calc(var(--spacing) * 4)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-card)',
    backgroundColor: 'var(--color-surface)',
  },
  label: { fontSize: 'var(--text-h2)', fontWeight: 600 },
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--text-body)' },
  list: { margin: 0, paddingLeft: 'calc(var(--spacing) * 5)', fontSize: 'var(--text-body)' },
});

export function IndexPanel() {
  const styles = useStyles();
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [status, setStatus] = useState<IndexStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextSources, nextStatus] = await Promise.all([
        invoke<SourceItem[]>('sources.list'),
        invoke<IndexStatus>('index.status'),
      ]);
      setSources(nextSources);
      setStatus(nextStatus);
    } catch (e) {
      setError(errorCode(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const running = status?.running ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, refresh]);

  const start = async () => {
    setError(null);
    try {
      await invoke('index.start', {});
    } catch (e) {
      setError(errorCode(e) === 'E_BUSY' ? '이미 색인 중입니다.' : '색인을 시작하지 못했습니다.');
    }
    await refresh();
  };

  return (
    <section className={styles.panel} aria-label="색인 상태">
      <div className={styles.row}>
        <Button appearance="primary" onClick={() => void start()} disabled={running || sources.length === 0}>
          {running ? '색인 중…' : '색인 시작'}
        </Button>
        {error && (
          <Text role="alert" className={styles.muted}>
            {error}
          </Text>
        )}
      </div>
      {sources.map((source) => {
        const job = status?.jobs.find((j) => j.sourceId === source.id);
        const failures = status?.failures.filter((f) => f.sourceId === source.id) ?? [];
        const c = job?.counts;
        return (
          <div key={source.id} className={styles.card}>
            <Text className={styles.label}>{source.label}</Text>
            <Text className={styles.muted}>
              문서 {source.documentCount}개 · {job ? JOB_STATUS_TEXT[job.status] : '아직 색인하지 않음'}
              {source.lastIndexedAt ? ` · 마지막 색인 ${new Date(source.lastIndexedAt).toLocaleString()}` : ''}
            </Text>
            {job?.status === 'running' && c && (
              <ProgressBar value={c.total > 0 ? c.done / c.total : undefined} aria-label="색인 진행률" />
            )}
            {c && (
              <Text className={styles.muted}>
                대상 {c.total} · 처리 {c.processed} · 변경 없음 {c.unchanged} · 실패 {c.failed} · 삭제 {c.deleted} · 제외{' '}
                {c.excluded}
              </Text>
            )}
            {job?.reason && <Text role="alert">{JOB_ERROR_TEXT[job.reason]}</Text>}
            {c && c.truncated > 0 && (
              <Text className={styles.muted}>링크·태그가 너무 많아 일부만 저장한 문서 {c.truncated}개</Text>
            )}
            {job && job.unreadable.length > 0 && (
              <ul className={styles.list} aria-label="읽지 못한 항목">
                {job.unreadable.map((p) => (
                  <li key={p}>{p} — 읽을 수 없음(이번 색인에서 삭제 처리를 하지 않았습니다)</li>
                ))}
              </ul>
            )}
            {failures.length > 0 && (
              <ul className={styles.list} aria-label="실패 파일">
                {failures.map((f) => (
                  <li key={f.relPath}>
                    {f.relPath} — {FILE_ERROR_TEXT[f.reason]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
