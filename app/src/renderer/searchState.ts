// S-03 목록 검색의 순수 상태 규칙(React 없음 → 단위 테스트 가능).
import type { SearchItem, SearchQueryInput } from '../shared/ipc';

export type Filters = { sourceId: string; tag: string; format: '' | 'md' | 'pdf' };
export const NO_FILTERS: Filters = { sourceId: '', tag: '', format: '' };

export interface Submitted {
  readonly q: string;
  readonly f: Filters;
}

export function hasFilters(f: Filters): boolean {
  return f.sourceId !== '' || f.tag.trim() !== '' || f.format !== '';
}

export function buildSearchInput(q: string, f: Filters, page: number): SearchQueryInput {
  return {
    query: q.trim(),
    ...(f.sourceId ? { sourceId: Number(f.sourceId) } : {}),
    ...(f.tag.trim() ? { tag: f.tag.trim() } : {}),
    ...(f.format ? { format: f.format } : {}),
    page,
  };
}

/** "더 보기" 요청: 입력창·필터의 현재 값이 아니라 마지막으로 성공한 검색 조건으로만 만든다. */
export function nextPageInput(submitted: Submitted | null, currentPage: number): SearchQueryInput | null {
  return submitted ? buildSearchInput(submitted.q, submitted.f, currentPage + 1) : null;
}

/** 쪽을 이어 붙일 때 이미 있는 docId는 뺀다(쪽 사이 변경으로 겹칠 수 있음). */
export function mergeItems(prev: readonly SearchItem[], next: readonly SearchItem[]): SearchItem[] {
  const seen = new Set(prev.map((i) => i.docId));
  return [...prev, ...next.filter((i) => !seen.has(i.docId))];
}
