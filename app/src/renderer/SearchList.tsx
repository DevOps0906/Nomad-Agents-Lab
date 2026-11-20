import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Spinner, Text, makeStyles } from '@fluentui/react-components';
import type {
  DocPreview,
  IndexStatus,
  SearchItem,
  SearchQueryResult,
  SourceItem,
} from '../shared/ipc';
import { errorCode, invoke } from './api';
import {
  type Filters,
  NO_FILTERS,
  type Submitted,
  buildSearchInput,
  hasFilters,
  mergeItems,
  nextPageInput,
} from './searchState';

/** S-03 Second Brain 목록 경로(A-04 검색·A-06 미리보기). 미리보기 텍스트는 React 텍스트 노드로만 표시한다(HTML 해석 없음). */
const POLL_MS = 1000;

const REASON_TEXT = { link: '링크', manual: '직접 연결', backlink: '이 문서를 링크' } as const;
const STATUS_TEXT = { ok: '색인됨', error: '색인 실패', encrypted: '암호화됨' } as const;

const focusRing = {
  outlineStyle: 'solid',
  outlineWidth: 'var(--focus-ring-width)',
  outlineColor: 'var(--color-focus)',
} as const;

const useStyles = makeStyles({
  root: { display: 'grid', gap: 'calc(var(--spacing) * 4)', paddingTop: 'calc(var(--spacing) * 4)' },
  searchRow: { display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--spacing) * 2)', alignItems: 'center' },
  searchInput: { flexGrow: 1, minWidth: 'var(--layout-search-min)' },
  filters: { display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--spacing) * 2)', alignItems: 'center' },
  body: {
    display: 'grid',
    gridTemplateColumns: 'minmax(var(--layout-result-min), 2fr) 3fr',
    gap: 'calc(var(--spacing) * 4)',
    alignItems: 'start',
    '@media (max-width: 1199px)': { gridTemplateColumns: 'minmax(var(--layout-result-min-narrow), 1fr) 1fr' },
    '@media (max-width: 767px)': { gridTemplateColumns: '1fr' },
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gap: 'calc(var(--spacing) * 1)',
    outlineOffset: 'var(--focus-ring-offset)',
    ':focus-visible': focusRing,
  },
  item: {
    display: 'grid',
    gap: 'calc(var(--spacing) * 1)',
    padding: 'calc(var(--spacing) * 3)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--radius-card)',
    backgroundColor: 'var(--color-surface)',
    cursor: 'pointer',
  },
  itemActive: { ...focusRing, outlineOffset: 0 },
  itemTitle: { fontSize: 'var(--text-h2)', fontWeight: 600, overflowWrap: 'anywhere' },
  muted: { color: 'var(--color-text-muted)', fontSize: 'var(--text-body)', overflowWrap: 'anywhere' },
  card: {
    display: 'grid',
    gap: 'calc(var(--spacing) * 3)',
    padding: 'calc(var(--spacing) * 4)',
    border: 'var(--border-width) solid var(--color-border)',
    borderRadius: 'var(--radius-card)',
    backgroundColor: 'var(--color-surface)',
    minWidth: 0,
    outlineOffset: 'var(--focus-ring-offset)',
    ':focus-visible': focusRing,
  },
  previewTitle: { fontSize: 'var(--text-h1)', margin: 0, overflowWrap: 'anywhere' },
  text: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: 'inherit',
    fontSize: 'var(--text-body)',
    maxHeight: 'var(--layout-preview-max-height)',
    overflow: 'auto',
  },
  related: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'grid',
    gap: 'calc(var(--spacing) * 1)',
    fontSize: 'var(--text-body)',
  },
  relatedButton: { justifyContent: 'flex-start', textAlign: 'start', height: 'auto', whiteSpace: 'normal' },
  skeleton: {
    height: 'var(--size-skeleton-height)',
    borderRadius: 'var(--radius-card)',
    backgroundColor: 'var(--color-border)',
    opacity: 0.5,
  },
  notice: {
    display: 'grid',
    gap: 'calc(var(--spacing) * 3)',
    justifyItems: 'start',
    padding: 'calc(var(--spacing) * 6)',
    border: 'var(--border-width) dashed var(--color-border)',
    borderRadius: 'var(--radius-card)',
  },
});

export function SearchList() {
  const styles = useStyles();
  const [sources, setSources] = useState<SourceItem[] | null>(null);
  const [sourcesFailed, setSourcesFailed] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [loadingMore, setLoadingMore] = useState(false);
  const [result, setResult] = useState<SearchQueryResult | null>(null);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const searchSeq = useRef(0);
  const previewSeq = useRef(0);
  /** 마지막으로 완료된 검색 조건. "더 보기"는 입력창 현재 값이 아니라 이 조건으로 이어서 가져온다. */
  const submitted = useRef<Submitted | null>(null);
  const [moreFailed, setMoreFailed] = useState(false);
  /** 컨트롤이 사라지는 갱신(필터 해제·다시 시도·더 보기) 뒤 포커스를 돌려줄 곳 */
  const pendingFocus = useRef<'search' | 'list' | null>(null);

  const loadSources = useCallback(async () => {
    setSourcesFailed(false);
    try {
      setSources(await invoke<SourceItem[]>('sources.list'));
    } catch {
      setSources([]);
      setSourcesFailed(true);
    }
  }, []);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  // 색인 중 표시: 진행 중이면 1초마다 다시 본다.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      let running = false;
      try {
        running = (await invoke<IndexStatus>('index.status')).running;
      } catch {
        running = false;
      }
      if (stopped) return;
      setIndexing(running);
      timer = setTimeout(() => void tick(), running ? POLL_MS : POLL_MS * 5);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // 갱신이 끝나 화면이 안정되면 예약된 포커스를 복원한다.
  useEffect(() => {
    if (phase === 'loading' || loadingMore || !pendingFocus.current) return;
    const target = pendingFocus.current === 'list' && listRef.current ? listRef.current : searchRef.current;
    pendingFocus.current = null;
    target?.focus();
  }, [phase, loadingMore, items]);

  const showPreview = useCallback(async (docId: number) => {
    const seq = ++previewSeq.current;
    setActiveId(docId);
    setOpenNote(null);
    // 선택이 바뀌면 이전 미리보기를 바로 지우고 로딩을 보여 준다.
    setPreview(null);
    setPreviewError(null);
    try {
      const data = await invoke<DocPreview>('doc.preview', { docId });
      if (seq !== previewSeq.current) return;
      setPreview(data);
    } catch (e) {
      if (seq !== previewSeq.current) return;
      setPreviewError(
        errorCode(e) === 'E_NOT_FOUND' ? '문서를 찾을 수 없습니다.' : '미리볼 수 없는 문서입니다(삭제되었거나 연결 폴더 밖).',
      );
    }
  }, []);

  const runSearch = useCallback(async (q: string, f: Filters, page = 1) => {
    if (!q.trim()) return;
    const seq = ++searchSeq.current;
    setMoreFailed(false);
    if (page === 1) {
      // 새 검색은 진행 중이던 "더 보기" 응답을 버린다.
      setLoadingMore(false);
      setPhase('loading');
    } else setLoadingMore(true);
    try {
      const data = await invoke<SearchQueryResult>('search.query', buildSearchInput(q, f, page));
      if (seq !== searchSeq.current) return;
      setResult(data);
      if (page === 1) {
        submitted.current = { q: q.trim(), f };
        setItems(data.items);
        previewSeq.current += 1;
        setPreview(null);
        setPreviewError(null);
        setActiveId(null);
        setPhase('done');
      } else {
        setItems((prev) => mergeItems(prev, data.items));
        setLoadingMore(false);
        pendingFocus.current = 'list';
      }
    } catch {
      if (seq !== searchSeq.current) return;
      setLoadingMore(false);
      // 2쪽 이후 실패는 이미 받은 목록을 유지하고 알림만 띄운다. 1쪽 실패만 오류 화면.
      if (page === 1) setPhase('error');
      else setMoreFailed(true);
    }
  }, []);

  const submit = () => void runSearch(query, filters);

  const loadMore = () => {
    const base = submitted.current;
    if (base && result && nextPageInput(base, result.page)) void runSearch(base.q, base.f, result.page + 1);
  };

  const retry = () => {
    pendingFocus.current = 'search';
    submit();
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && items.length > 0) {
      event.preventDefault();
      listRef.current?.focus();
      const first = items[0];
      if (first && activeId === null) void showPreview(first.docId);
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = items.findIndex((i) => i.docId === activeId);
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeId !== null) previewRef.current?.focus();
      return;
    } else if (event.key === 'Escape') {
      searchRef.current?.focus();
      return;
    } else return;
    event.preventDefault();
    const target = items[next];
    if (target) {
      void showPreview(target.docId);
      document.getElementById(`result-${target.docId}`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const changeFilters = (next: Filters, restoreSearchFocus = false) => {
    setFilters(next);
    if (restoreSearchFocus) pendingFocus.current = 'search';
    if (query.trim()) void runSearch(query, next);
    else if (restoreSearchFocus) searchRef.current?.focus();
  };

  const connect = async () => {
    try {
      await invoke('sources.add', { kind: 'dialog' });
    } finally {
      await loadSources();
    }
  };

  const openOriginal = async (docId: number) => {
    try {
      const r = await invoke<{ opened: boolean }>('doc.openExternal', { docId });
      setOpenNote(r.opened ? null : '원본을 열지 못했습니다.');
    } catch (e) {
      setOpenNote(
        errorCode(e) === 'E_NOT_FOUND' ? '원본 파일이 없습니다.' : '연결 폴더 밖이거나 열 수 없는 문서입니다.',
      );
    }
  };

  /** 관련 노드 선택: 그 문서를 미리보고 포커스를 미리보기 카드로 옮긴다. */
  const openRelated = (docId: number) => {
    void showPreview(docId);
    previewRef.current?.focus();
  };

  if (sources === null) return <Spinner label="불러오는 중…" />;

  if (sourcesFailed) {
    return (
      <div className={styles.notice} role="alert">
        <Text className={styles.itemTitle}>폴더 목록을 불러오지 못했습니다</Text>
        <Text className={styles.muted}>연결 폴더가 없는 것이 아니라 읽는 중 문제가 생겼습니다. 다시 시도하세요.</Text>
        <Button appearance="primary" onClick={() => void loadSources()}>
          다시 시도
        </Button>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className={styles.notice} role="status">
        <Text className={styles.itemTitle}>연결된 폴더가 없습니다</Text>
        <Text className={styles.muted}>폴더를 연결하고 색인하면 이곳에서 검색할 수 있습니다.</Text>
        <Button appearance="primary" onClick={() => void connect()}>
          폴더 연결
        </Button>
      </div>
    );
  }

  const previewLoading = activeId !== null && !preview && !previewError;

  return (
    <section className={styles.root} aria-label="문서 검색">
      <form
        className={styles.searchRow}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          ref={searchRef}
          className={styles.searchInput}
          value={query}
          onChange={(_e, data) => setQuery(data.value)}
          onKeyDown={onSearchKey}
          placeholder="제목·본문 검색 (↓ 로 결과 목록 이동)"
          aria-label="검색어"
          maxLength={200}
        />
        <Button appearance="primary" type="submit" disabled={!query.trim() || phase === 'loading'}>
          검색
        </Button>
        {indexing && (
          <Text className={styles.muted} role="status">
            색인 중…
          </Text>
        )}
      </form>
      <div className={styles.filters} aria-label="필터">
        <Select
          aria-label="소스"
          value={filters.sourceId}
          onChange={(_e, data) => changeFilters({ ...filters, sourceId: data.value })}
        >
          <option value="">모든 소스</option>
          {sources.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="형식"
          value={filters.format}
          onChange={(_e, data) => changeFilters({ ...filters, format: data.value as Filters['format'] })}
        >
          <option value="">모든 형식</option>
          <option value="md">Markdown</option>
          <option value="pdf">PDF</option>
        </Select>
        <Input
          aria-label="태그"
          placeholder="태그"
          value={filters.tag}
          onChange={(_e, data) => setFilters({ ...filters, tag: data.value })}
          onBlur={() => {
            if (query.trim() && phase !== 'idle' && filters.tag.trim() !== (submitted.current?.f.tag.trim() ?? '')) {
              void runSearch(query, filters);
            }
          }}
          maxLength={64}
        />
        {hasFilters(filters) && (
          <Button appearance="subtle" onClick={() => changeFilters(NO_FILTERS, true)}>
            필터 해제
          </Button>
        )}
      </div>

      {phase === 'idle' && (
        <div className={styles.notice} role="status">
          <Text className={styles.itemTitle}>검색어를 입력하세요</Text>
          <Text className={styles.muted}>
            연결한 폴더의 Markdown 제목과 본문을 찾습니다. 검색 후 ↓ 키로 결과를 고르면 미리보기가 열립니다.
          </Text>
        </div>
      )}

      {phase === 'loading' && (
        <div aria-busy="true" aria-label="검색 중" className={styles.root}>
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          <div className={styles.skeleton} />
          {indexing && <Text className={styles.muted}>색인 중이라 결과가 아직 부족할 수 있습니다.</Text>}
        </div>
      )}

      {phase === 'error' && (
        <div className={styles.notice} role="alert">
          <Text className={styles.itemTitle}>검색하지 못했습니다</Text>
          <Text className={styles.muted}>잠시 후 다시 시도하세요.</Text>
          <Button appearance="primary" onClick={retry}>
            다시 시도
          </Button>
        </div>
      )}

      {phase === 'done' && items.length === 0 && (
        <div className={styles.notice} role="status">
          <Text className={styles.itemTitle}>검색 결과가 없습니다</Text>
          <Text className={styles.muted}>
            {hasFilters(filters)
              ? '필터를 해제하거나 다른 검색어를 입력해 보세요.'
              : '다른 검색어를 입력해 보세요. 색인이 끝났는지도 확인하세요.'}
          </Text>
          {hasFilters(filters) && <Button onClick={() => changeFilters(NO_FILTERS, true)}>필터 해제</Button>}
        </div>
      )}

      {phase === 'done' && items.length > 0 && (
        <div className={styles.body}>
          <div>
            <ul
              ref={listRef}
              className={styles.list}
              role="listbox"
              aria-label="검색 결과"
              tabIndex={0}
              aria-activedescendant={items.some((i) => i.docId === activeId) ? `result-${activeId}` : undefined}
              onKeyDown={onListKey}
            >
              {items.map((item) => (
                <li
                  key={item.docId}
                  id={`result-${item.docId}`}
                  role="option"
                  aria-selected={item.docId === activeId}
                  className={`${styles.item} ${item.docId === activeId ? styles.itemActive : ''}`}
                  onClick={() => void showPreview(item.docId)}
                >
                  <Text className={styles.itemTitle}>{item.title}</Text>
                  <Text className={styles.muted}>
                    {item.sourceLabel} / {item.relPath}
                  </Text>
                  {item.excerpt && <Text className={styles.muted}>{item.excerpt}</Text>}
                </li>
              ))}
            </ul>
            {moreFailed && (
              <Text role="alert" className={styles.muted}>
                다음 결과를 불러오지 못했습니다. 이미 받은 목록은 그대로입니다.
              </Text>
            )}
            {result?.hasMore && (
              <Button onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? '불러오는 중…' : moreFailed ? '다시 시도' : '더 보기'}
              </Button>
            )}
          </div>
          <article
            ref={previewRef}
            tabIndex={-1}
            className={styles.card}
            aria-label="문서 미리보기"
            aria-live="polite"
            aria-busy={previewLoading}
          >
            {previewError && <Text role="alert">{previewError}</Text>}
            {!preview && !previewError && (
              <Text className={styles.muted}>
                {previewLoading ? '미리보기를 불러오는 중…' : '결과를 선택하면 미리보기가 나옵니다.'}
              </Text>
            )}
            {preview && (
              <>
                <h2 className={styles.previewTitle}>{preview.title}</h2>
                <Text className={styles.muted}>
                  {preview.format.toUpperCase()} · {preview.sourceLabel} / {preview.relPath} · 수정{' '}
                  {new Date(preview.mtime).toLocaleString()} · {STATUS_TEXT[preview.status]}
                </Text>
                {preview.tags.length > 0 && <Text className={styles.muted}>태그: {preview.tags.join(', ')}</Text>}
                <pre className={styles.text}>{preview.text}</pre>
                {preview.textTruncated && <Text className={styles.muted}>앞부분만 표시합니다.</Text>}
                {preview.related.length > 0 && (
                  <ul className={styles.related} aria-label="관련 노드">
                    {preview.related.map((r, i) => (
                      <li key={`${r.reason}-${r.docId ?? r.title}-${i}`}>
                        {r.docId === null ? (
                          <Text className={styles.muted}>
                            {r.title} (없는 문서) — {REASON_TEXT[r.reason]}
                          </Text>
                        ) : (
                          <Button
                            appearance="subtle"
                            className={styles.relatedButton}
                            onClick={() => openRelated(r.docId as number)}
                          >
                            {r.title} — {REASON_TEXT[r.reason]}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div>
                  <Button onClick={() => void openOriginal(preview.docId)}>원본 열기</Button>
                </div>
                {openNote && <Text role="alert">{openNote}</Text>}
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
