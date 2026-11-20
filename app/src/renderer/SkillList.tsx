import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Input, Select, Text, makeStyles } from '@fluentui/react-components';
import type { SkillDetail, SkillErrorCode, SkillItem, SkillRoot, SkillsListResult } from '../shared/ipc';
import { errorCode, invoke } from './api';

/** S-04 스킬 목록·상세(A-07 목록, A-08 상세·폴더 열기). SKILL.md 내용은 React 텍스트 노드로만 표시한다(HTML 해석 없음). */
const ROOT_TEXT: Record<SkillRoot, string> = { user: '사용자', app: '앱' };

/** 유효하지 않은 스킬의 사유 문구(코드만 받는다: 원문·경로 없음) */
const ERROR_TEXT: Record<SkillErrorCode, string> = {
  not_file: 'SKILL.md가 일반 파일이 아닙니다(링크는 읽지 않습니다).',
  too_large: 'SKILL.md가 1MB를 넘습니다.',
  read_failed: 'SKILL.md를 읽지 못했습니다.',
  no_frontmatter: '맨 위에 --- 로 감싼 frontmatter가 없습니다.',
  frontmatter_too_large: 'frontmatter가 64KB를 넘습니다.',
  yaml_error: 'frontmatter의 YAML 형식이 올바르지 않습니다.',
  alias_limit: 'frontmatter의 YAML 별칭(*)이 너무 많습니다.',
  frontmatter_not_object: 'frontmatter가 name: 값 형태의 목록이 아닙니다.',
  name_missing: 'frontmatter에 name이 없습니다.',
  name_invalid: 'name이 올바르지 않습니다(문자열, 100자 이하).',
  ssr_invalid: 'ssr: 항목(inputs·reads·tools) 형식이 올바르지 않습니다.',
  duplicate_name: '같은 폴더 안에 같은 name의 스킬이 먼저 있어 이 스킬은 쓰지 않습니다.',
  shadowed: '앱 스킬 폴더에 같은 name의 스킬이 있어 이 스킬은 쓰지 않습니다.',
};

const RUN_STATUS_TEXT: Record<string, string> = {
  starting: '시작 중',
  running: '실행 중',
  waiting_permission: '승인 대기',
  succeeded: '성공',
  partial: '일부 성공',
  failed: '실패',
  cancelled: '취소됨',
};

const focusRing = {
  outlineStyle: 'solid',
  outlineWidth: 'var(--focus-ring-width)',
  outlineColor: 'var(--color-focus)',
} as const;

const useStyles = makeStyles({
  root: { display: 'grid', gap: 'calc(var(--spacing) * 4)', paddingTop: 'calc(var(--spacing) * 4)' },
  row: { display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--spacing) * 2)', alignItems: 'center' },
  searchInput: { flexGrow: 1, minWidth: 'var(--layout-search-min)' },
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
  itemHead: { display: 'flex', flexWrap: 'wrap', gap: 'calc(var(--spacing) * 2)', alignItems: 'center' },
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
  detailTitle: { fontSize: 'var(--text-h1)', margin: 0, overflowWrap: 'anywhere' },
  section: { display: 'grid', gap: 'calc(var(--spacing) * 1)' },
  sectionLabel: { fontSize: 'var(--text-caption)', color: 'var(--color-text-muted)' },
  plainList: {
    margin: 0,
    paddingInlineStart: 'calc(var(--spacing) * 5)',
    fontSize: 'var(--text-body)',
    overflowWrap: 'anywhere',
  },
  text: {
    margin: 0,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontFamily: 'inherit',
    fontSize: 'var(--text-body)',
    maxHeight: 'var(--layout-preview-max-height)',
    overflow: 'auto',
  },
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

type Sort = 'name' | 'recent';

const itemKey = (item: SkillItem) => `${item.root}:${item.folder}`;

export function SkillList() {
  const styles = useStyles();
  const [data, setData] = useState<SkillsListResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [rootFilter, setRootFilter] = useState<'' | SkillRoot>('');
  const [sort, setSort] = useState<Sort>('name');
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailSeq = useRef(0);
  const loadSeq = useRef(0);
  const openSeq = useRef(0);
  const activeKeyRef = useRef<string | null>(null);
  activeKeyRef.current = activeKey;
  /** 새로 고침·다시 시도 뒤 포커스를 검색창으로 돌려준다(누른 버튼이 사라질 수 있음) */
  const refocus = useRef(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = (data?.items ?? []).filter(
      (i) =>
        (rootFilter === '' || i.root === rootFilter) &&
        (needle === '' || i.name.toLowerCase().includes(needle) || i.description.toLowerCase().includes(needle)),
    );
    return [...list].sort((a, b) =>
      {
      const byFolder = a.folder.toLowerCase() < b.folder.toLowerCase() ? -1 : 1;
      if (sort === 'recent') return b.mtime - a.mtime || byFolder;
      const x = a.name.toLowerCase();
      const y = b.name.toLowerCase();
      return x < y ? -1 : x > y ? 1 : byFolder;
    });
  }, [data, query, rootFilter, sort]);

  const active = visible.find((i) => itemKey(i) === activeKey) ?? null;
  const filtered = query.trim() !== '' || rootFilter !== '';

  const select = useCallback(async (item: SkillItem) => {
    const seq = ++detailSeq.current;
    setActiveKey(itemKey(item));
    openSeq.current += 1;
    setOpenNote(null);
    setDetail(null);
    setDetailError(null);
    // 유효하지 않은 스킬은 상세를 부르지 않고 목록의 사유를 보여 준다(A-08은 E_VALIDATION).
    if (!item.valid) return;
    try {
      const result = await invoke<SkillDetail>('skills.get', { name: item.name });
      if (seq === detailSeq.current) setDetail(result);
    } catch (e) {
      if (seq !== detailSeq.current) return;
      setDetailError(
        errorCode(e) === 'E_NOT_FOUND' ? '스킬을 찾을 수 없습니다(폴더가 바뀌었을 수 있습니다).' : '상세를 읽지 못했습니다.',
      );
    }
  }, []);

  const load = useCallback(
    async (initial: boolean) => {
      const seq = ++loadSeq.current;
      setFailed(false);
      if (initial) setData(null);
      try {
        const result = await invoke<SkillsListResult>('skills.list');
        if (seq !== loadSeq.current) return;
        setData(result);
        // 선택한 스킬이 아직 있으면 상세를 다시 읽고, 없으면 선택을 비운다.
        const kept = result.items.find((i) => itemKey(i) === activeKeyRef.current);
        if (kept) void select(kept);
        else {
          detailSeq.current += 1;
          setActiveKey(null);
          setDetail(null);
          setDetailError(null);
          setOpenNote(null);
        }
      } catch {
        if (seq === loadSeq.current) setFailed(true);
      }
    },
    [select],
  );

  useEffect(() => {
    void load(true);
  }, [load]);

  // 갱신이 끝나 화면이 안정되면 예약된 포커스를 복원한다.
  useEffect(() => {
    if (data && refocus.current) {
      refocus.current = false;
      searchRef.current?.focus();
    }
  }, [data]);

  const reload = (initial: boolean) => {
    refocus.current = true;
    void load(initial);
  };

  const openFolder = async (item: SkillItem) => {
    const seq = ++openSeq.current;
    try {
      const r = await invoke<{ opened: boolean }>('skills.openFolder', { root: item.root, folder: item.folder });
      if (seq !== openSeq.current) return;
      setOpenNote(r.opened ? null : '폴더를 열지 못했습니다.');
    } catch (e) {
      if (seq !== openSeq.current) return;
      setOpenNote(
        errorCode(e) === 'E_NOT_FOUND'
          ? '스킬 폴더가 없습니다. 목록을 새로 고치세요.'
          : '등록된 스킬 폴더 밖이라 열 수 없습니다.',
      );
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && visible.length > 0) {
      event.preventDefault();
      listRef.current?.focus();
      const first = visible[0];
      if (first && !active) void select(first);
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = visible.findIndex((i) => itemKey(i) === activeKey);
    let next = -1;
    if (event.key === 'ArrowDown') next = Math.min(visible.length - 1, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visible.length - 1;
    else if (event.key === 'Enter') {
      event.preventDefault();
      if (active) detailRef.current?.focus();
      return;
    } else if (event.key === 'Escape') {
      searchRef.current?.focus();
      return;
    } else return;
    event.preventDefault();
    const target = visible[next];
    if (target) {
      void select(target);
      document.getElementById(`skill-${visible.indexOf(target)}`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const clearFilters = () => {
    setQuery('');
    setRootFilter('');
    searchRef.current?.focus();
  };

  if (failed) {
    return (
      <div className={styles.notice} role="alert">
        <Text className={styles.itemTitle}>스킬 목록을 불러오지 못했습니다</Text>
        <Text className={styles.muted}>스킬 폴더가 없는 것이 아니라 읽는 중 문제가 생겼습니다. 다시 시도하세요.</Text>
        <Button appearance="primary" onClick={() => reload(true)}>
          다시 시도
        </Button>
      </div>
    );
  }

  if (data === null) {
    return (
      <div aria-busy="true" aria-label="스킬 목록을 불러오는 중" className={styles.root}>
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
        <div className={styles.skeleton} />
      </div>
    );
  }

  if (data.items.length === 0) {
    const unreadable = data.roots.some((r) => r.status === 'unreadable');
    return (
      <div className={styles.notice} role="status">
        <Text className={styles.itemTitle}>{unreadable ? '스킬 폴더를 읽지 못했습니다' : '스킬이 없습니다'}</Text>
        <Text className={styles.muted}>
          {unreadable
            ? '스킬 폴더의 접근 권한을 확인한 뒤 다시 시도하세요.'
            : '사용자 스킬은 홈 폴더의 .claude/skills/<스킬 이름>/SKILL.md 위치에서 읽습니다. 이 폴더에 스킬을 만들면 이곳에 나타납니다.'}
        </Text>
        <Button appearance="primary" onClick={() => reload(true)}>
          새로 고침
        </Button>
      </div>
    );
  }

  const unreadableRoots = data.roots.filter((r) => r.status === 'unreadable').map((r) => ROOT_TEXT[r.root]);
  const invalidCount = data.items.filter((i) => !i.valid).length;

  return (
    <section className={styles.root} aria-label="스킬 목록">
      <div className={styles.row} role="search">
        <Input
          ref={searchRef}
          className={styles.searchInput}
          value={query}
          onChange={(_e, d) => setQuery(d.value)}
          onKeyDown={onSearchKey}
          placeholder="이름·설명 검색 (↓ 로 목록 이동)"
          aria-label="스킬 검색어"
          maxLength={200}
        />
        <Select aria-label="위치" value={rootFilter} onChange={(_e, d) => setRootFilter(d.value as '' | SkillRoot)}>
          <option value="">모든 위치</option>
          <option value="user">사용자</option>
          <option value="app">앱</option>
        </Select>
        <Select aria-label="정렬" value={sort} onChange={(_e, d) => setSort(d.value as Sort)}>
          <option value="name">이름순</option>
          <option value="recent">최근 수정순</option>
        </Select>
        <Button onClick={() => reload(false)}>새로 고침</Button>
        {filtered && (
          <Button appearance="subtle" onClick={clearFilters}>
            필터 해제
          </Button>
        )}
      </div>
      {unreadableRoots.length > 0 && (
        <Text role="alert">
          {unreadableRoots.join('·')} 스킬 폴더를 읽지 못해 그 위치의 목록이 빠져 있을 수 있습니다. 접근 권한을 확인하고 새로 고침하세요.
        </Text>
      )}
      {invalidCount > 0 && (
        <Text className={styles.muted} role="status">
          읽을 수 없는 스킬 {invalidCount}개가 있습니다. 오류 배지가 붙은 항목을 선택하면 사유가 나옵니다.
        </Text>
      )}

      {visible.length === 0 ? (
        <div className={styles.notice} role="status">
          <Text className={styles.itemTitle}>검색 결과가 없습니다</Text>
          <Text className={styles.muted}>필터를 해제하거나 다른 검색어를 입력해 보세요.</Text>
          <Button onClick={clearFilters}>필터 해제</Button>
        </div>
      ) : (
        <div className={styles.body}>
          <ul
            ref={listRef}
            className={styles.list}
            role="listbox"
            aria-label="스킬"
            tabIndex={0}
            aria-activedescendant={active ? `skill-${visible.indexOf(active)}` : undefined}
            onKeyDown={onListKey}
          >
            {visible.map((item, index) => (
              <li
                key={itemKey(item)}
                id={`skill-${index}`}
                role="option"
                aria-selected={itemKey(item) === activeKey}
                className={`${styles.item} ${itemKey(item) === activeKey ? styles.itemActive : ''}`}
                onClick={() => void select(item)}
              >
                <div className={styles.itemHead}>
                  <Text className={styles.itemTitle}>{item.name}</Text>
                  <Badge appearance="outline" color="informative">
                    {ROOT_TEXT[item.root]}
                  </Badge>
                  {!item.valid && (
                    <Badge appearance="filled" color="danger">
                      오류
                    </Badge>
                  )}
                </div>
                {item.description && <Text className={styles.muted}>{item.description}</Text>}
                <Text className={styles.muted}>
                  {item.lastRun
                    ? `최근 실행: ${RUN_STATUS_TEXT[item.lastRun.status] ?? item.lastRun.status} · ${new Date(item.lastRun.startedAt).toLocaleString()}`
                    : '최근 실행 없음'}
                </Text>
              </li>
            ))}
          </ul>
          <article ref={detailRef} tabIndex={-1} className={styles.card} aria-label="스킬 상세" aria-live="polite">
            {!active && <Text className={styles.muted}>스킬을 선택하면 상세가 나옵니다.</Text>}
            {active && !active.valid && (
              <>
                <h2 className={styles.detailTitle}>{active.name}</h2>
                <Text role="alert">
                  SKILL.md를 사용할 수 없습니다: {active.error ? ERROR_TEXT[active.error] : '알 수 없는 오류'}
                </Text>
                <Text className={styles.muted}>폴더를 열어 SKILL.md를 고친 뒤 새로 고침하세요.</Text>
                <div>
                  <Button onClick={() => void openFolder(active)}>폴더 열기</Button>
                </div>
                {openNote && <Text role="alert">{openNote}</Text>}
              </>
            )}
            {active?.valid && detailError && (
              <>
                <Text role="alert">{detailError}</Text>
                <div>
                  <Button onClick={() => void select(active)}>다시 시도</Button>
                </div>
              </>
            )}
            {active?.valid && !detail && !detailError && <Text className={styles.muted}>상세를 불러오는 중…</Text>}
            {active?.valid && detail && (
              <>
                <h2 className={styles.detailTitle}>{detail.name}</h2>
                <Text className={styles.muted}>
                  {ROOT_TEXT[detail.root]} 스킬 · 수정 {new Date(detail.mtime).toLocaleString()}
                </Text>
                <div className={styles.section}>
                  <Text className={styles.sectionLabel}>목적</Text>
                  <Text>{detail.description || '설명이 없습니다.'}</Text>
                </div>
                <div className={styles.section}>
                  <Text className={styles.sectionLabel}>필수 입력</Text>
                  {detail.ssr && detail.ssr.inputs.length > 0 ? (
                    <ul className={styles.plainList}>
                      {detail.ssr.inputs.map((input) => (
                        <li key={input.name}>
                          {input.label ?? input.name}
                          {input.required ? ' (필수)' : ' (선택)'}
                          {input.description ? ` — ${input.description}` : ''}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Text className={styles.muted}>자유 텍스트 입력 1칸</Text>
                  )}
                </div>
                <div className={styles.section}>
                  <Text className={styles.sectionLabel}>참조 자료</Text>
                  {detail.ssr && detail.ssr.reads.length > 0 ? (
                    <ul className={styles.plainList}>
                      {detail.ssr.reads.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  ) : (
                    <Text className={styles.muted}>지정 없음(실행 승인 때 폴더를 고릅니다)</Text>
                  )}
                </div>
                <div className={styles.section}>
                  <Text className={styles.sectionLabel}>사용 도구</Text>
                  {detail.ssr && detail.ssr.tools.length > 0 ? (
                    <Text>{detail.ssr.tools.join(', ')}</Text>
                  ) : (
                    <Text className={styles.muted}>지정 없음(실행 승인 때 지정합니다)</Text>
                  )}
                </div>
                <div className={styles.section}>
                  <Text className={styles.sectionLabel}>최근 실행</Text>
                  <Text>
                    {detail.lastRun
                      ? `${RUN_STATUS_TEXT[detail.lastRun.status] ?? detail.lastRun.status} · ${new Date(detail.lastRun.startedAt).toLocaleString()}`
                      : '아직 실행한 적이 없습니다.'}
                  </Text>
                </div>
                <div className={styles.section}>
                  <Text className={styles.sectionLabel}>기억한 허용</Text>
                  <Text>
                    {detail.grants.length > 0
                      ? detail.grants
                          .map((g) => `폴더 ${g.folderIds.length}개 · 도구 ${g.tools.join(', ') || '없음'}`)
                          .join(' / ')
                      : '없음'}
                  </Text>
                </div>
                {detail.bodySummary && (
                  <div className={styles.section}>
                    <Text className={styles.sectionLabel}>본문 요약</Text>
                    <pre className={styles.text}>{detail.bodySummary}</pre>
                    {detail.bodyTruncated && <Text className={styles.muted}>앞부분만 표시합니다.</Text>}
                  </div>
                )}
                <div>
                  <Button onClick={() => void openFolder(active)}>폴더 열기</Button>
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
