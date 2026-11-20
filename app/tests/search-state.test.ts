// S-03 목록 검색 상태 규칙(더 보기 조건 고정·중복 제거).
import { describe, expect, it } from 'vitest';
import type { SearchItem } from '../src/shared/ipc';
import { NO_FILTERS, buildSearchInput, mergeItems, nextPageInput } from '../src/renderer/searchState';

const item = (docId: number): SearchItem => ({
  docId,
  title: `t${docId}`,
  format: 'md',
  sourceLabel: 's',
  relPath: `${docId}.md`,
  excerpt: '',
  score: 0,
});

describe('search state', () => {
  it('더 보기는 마지막 성공 검색 조건으로만 다음 쪽을 요청한다', () => {
    const submitted = { q: 'alpha', f: { ...NO_FILTERS, tag: 'x', sourceId: '2' } };
    // 이후 입력창·필터가 바뀌어도 submitted 객체만 쓰므로 영향이 없다
    const typedLater = buildSearchInput('beta', { ...NO_FILTERS, format: 'pdf' }, 1);
    expect(typedLater.query).toBe('beta');
    expect(nextPageInput(submitted, 1)).toEqual({ query: 'alpha', sourceId: 2, tag: 'x', page: 2 });
    expect(nextPageInput(null, 1)).toBeNull();
  });

  it('쪽을 이어 붙일 때 docId 중복은 뺀다', () => {
    expect(mergeItems([item(1), item(2)], [item(2), item(3)]).map((i) => i.docId)).toEqual([1, 2, 3]);
  });
});
