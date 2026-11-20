// 목록 검색·미리보기·원본 열기(A-04·A-06, task-020). 임시 폴더만 쓰고 shell은 가짜로 바꾼다.
import { mkdirSync, mkdtempSync, promises as fsp, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREVIEW_MAX_CHARS, createBrain } from '../src/main/brain/service';
import { DB_FILE_NAME, openDatabase } from '../src/main/db/open';
import { createIndexer } from '../src/main/indexer/service';
import { createInvokeHandler } from '../src/main/ipc/router';
import { createRoutes } from '../src/main/ipc/routes';
import { createTrustedUrlCheck } from '../src/main/security';

let tmp: string;
let srcDir: string;
let dataDir: string;
let db: Database.Database;
let sourceId: number;
const openPath = vi.fn(async (_file: string) => '');

beforeEach(async () => {
  openPath.mockClear();
  tmp = await fsp.realpath(mkdtempSync(path.join(os.tmpdir(), 'ssr-brain-')));
  srcDir = path.join(tmp, 'notes');
  dataDir = path.join(tmp, 'data');
  mkdirSync(srcDir);
  mkdirSync(dataDir);
  db = (await openDatabase(path.join(dataDir, DB_FILE_NAME), { create: true })).db;
  sourceId = Number(
    db
      .prepare(`INSERT INTO sources (kind, path, label, created_at) VALUES ('folder', ?, 'notes', '2026-11-20T00:00:00.000Z')`)
      .run(srcDir).lastInsertRowid,
  );
});

afterEach(() => {
  if (db.open) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function put(rel: string, content: string): void {
  const file = path.join(srcDir, ...rel.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

async function index(): Promise<void> {
  const ix = createIndexer({ store: () => ({ db, dataDir }) });
  ix.start(sourceId);
  await ix.idle();
}

const brain = () => createBrain({ store: () => ({ db }), openPath });
const docId = (rel: string) => (db.prepare('SELECT id FROM documents WHERE rel_path = ?').get(rel) as { id: number }).id;

describe('search.query', () => {
  beforeEach(async () => {
    put('a.md', '---\ntags: [alpha]\n---\n# 알파 노트\nSecond Brain research notes about gardening.');
    put('b/b.md', '# Beta\n#beta tomatoes and gardening tips. [[a]]');
    await index();
  });

  it('제목·본문을 찾고 소스 이름 + 상대 경로 + 발췌만 돌려준다(절대 경로 없음)', () => {
    const r = brain().search({ query: 'gardening' });
    expect(r.items.map((i) => i.relPath).sort()).toEqual(['a.md', 'b/b.md']);
    expect(r.items[0]).toMatchObject({ sourceLabel: 'notes', format: 'md' });
    expect(r.items[0]?.excerpt).toContain('gardening');
    const json = JSON.stringify(r);
    expect(json).not.toContain(tmp);
    expect(json).not.toContain(srcDir.replaceAll('\\', '\\\\'));
  });

  it('3글자 미만 검색어는 LIKE 경로로 찾는다', () => {
    expect(brain().search({ query: '알파' }).items.map((i) => i.relPath)).toEqual(['a.md']);
  });

  it('FTS 구문은 지원하지 않는다: 연산자·특수문자도 일반 토큰으로 찾는다', async () => {
    put('c/special.md', '# Special\nfoo-bar and a.md plus C++ and "ab" cde tokens AND NEAR(x y) title:zzz');
    put('c/mixed.md', '# Mixed\nab xyz123 only here');
    await index();
    const rel = (query: string) =>
      brain()
        .search({ query })
        .items.map((i) => i.relPath);
    expect(rel('foo-bar')).toEqual(['c/special.md']);
    expect(rel('a.md')).toEqual(['c/special.md']);
    expect(rel('C++')).toEqual(['c/special.md']);
    expect(rel('"ab" cde')).toEqual(['c/special.md']);
    expect(rel('gardening AND')).toEqual(['b/b.md']); // AND는 연산자가 아니라 일반 토큰
    expect(rel('NEAR(x y)')).toEqual(['c/special.md']);
    expect(rel('title:zzz')).toEqual(['c/special.md']);
    // 2글자 + 3글자 혼합 → 전체 LIKE AND
    expect(rel('ab xyz123')).toEqual(['c/mixed.md']);
    expect(rel('ab cde')).toEqual(['c/special.md']);
    expect(rel('ab nothere')).toEqual([]);
    // 한 글자 와일드카드 문자는 글자 그대로
    expect(rel('%')).toEqual([]);
    expect(rel('_')).toEqual([]);
  });

  it('소스·태그·형식 필터', () => {
    const b = brain();
    expect(b.search({ query: 'gardening', tag: 'alpha' }).items.map((i) => i.relPath)).toEqual(['a.md']);
    expect(b.search({ query: 'gardening', tag: 'ALPHA' }).items).toHaveLength(1);
    expect(b.search({ query: 'gardening', tag: 'none' }).items).toEqual([]);
    expect(b.search({ query: 'gardening', sourceId }).items).toHaveLength(2);
    expect(b.search({ query: 'gardening', sourceId: sourceId + 1 }).items).toEqual([]);
    expect(b.search({ query: 'gardening', format: 'pdf' }).items).toEqual([]);
    expect(b.search({ query: 'gardening', format: 'md' }).items).toHaveLength(2);
  });

  it('삭제된 문서는 결과에 없다', () => {
    db.prepare(`UPDATE documents SET status = 'deleted' WHERE rel_path = 'a.md'`).run();
    expect(brain().search({ query: 'gardening' }).items.map((i) => i.relPath)).toEqual(['b/b.md']);
  });

  it('페이지 크기를 넘으면 hasMore와 다음 페이지', () => {
    for (let i = 0; i < 25; i += 1) put(`p/p${i}.md`, `# P${i}\nzucchini ${i}`);
    return index().then(() => {
      const first = brain().search({ query: 'zucchini' });
      expect(first.items).toHaveLength(20);
      expect(first.hasMore).toBe(true);
      const second = brain().search({ query: 'zucchini', page: 2 });
      expect(second.items).toHaveLength(5);
      expect(second.hasMore).toBe(false);
    });
  });

  it('IPC 입력 검증: 빈 검색어·알 수 없는 키는 E_VALIDATION', async () => {
    const handler = createInvokeHandler({
      routes: createRoutes({
        envCheck: async () => ({}) as never,
        setDataDir: async () => ({ status: 'canceled' }),
        sources: {} as never,
        index: {} as never,
        brain: brain(),
      }),
      isTrustedUrl: createTrustedUrlCheck(),
    });
    const trusted = { senderFrame: { url: 'app://bundle/index.html', parent: null } };
    const bad = { ok: false, error: { code: 'E_VALIDATION' } };
    expect(await handler(trusted, 'search.query', { query: '  ' })).toEqual(bad);
    expect(await handler(trusted, 'search.query', { query: 'x', path: 'C:\\' })).toEqual(bad);
    expect(await handler(trusted, 'doc.openExternal', { docId: 1, path: 'C:\\x.md' })).toEqual(bad);
    expect(await handler(trusted, 'search.query', { query: 'gardening' })).toMatchObject({ ok: true });
  });
});

describe('doc.preview', () => {
  it('HTML·스크립트는 문자열로만 돌려준다(렌더링 경로 없음)와 절대 경로 없음', async () => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)> [x](javascript:alert(3))';
    put('evil.md', `# Evil\n${evil}\n#tagx [[missing]]`);
    put('ok.md', '# OK\n[[evil]]');
    await index();
    const p = brain().preview(docId('evil.md'));
    expect(p.text).toContain(evil);
    expect(p.tags).toEqual(['tagx']);
    expect(p.related).toEqual(
      expect.arrayContaining([
        { docId: null, title: 'missing', reason: 'link' },
        { docId: docId('ok.md'), title: 'OK', reason: 'backlink' },
      ]),
    );
    expect(JSON.stringify(p)).not.toContain(tmp);
    // 렌더러는 text를 React 텍스트 노드로만 쓴다: dangerouslySetInnerHTML·innerHTML 사용 금지
    const src = await fsp.readFile(path.join(__dirname, '..', 'src', 'renderer', 'SearchList.tsx'), 'utf8');
    expect(src).not.toMatch(/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|<iframe|<webview/);
  });

  it('거대 문서는 앞부분만 보낸다', async () => {
    put('big.md', `# Big\n${'가'.repeat(PREVIEW_MAX_CHARS * 3)}`);
    await index();
    const p = brain().preview(docId('big.md'));
    expect([...p.text].length).toBe(PREVIEW_MAX_CHARS);
    expect(p.textTruncated).toBe(true);
  });

  it('없는 문서 E_NOT_FOUND, 삭제된 문서 E_OUT_OF_SCOPE', async () => {
    put('a.md', '# A');
    await index();
    expect(() => brain().preview(9999)).toThrowError('E_NOT_FOUND');
    db.prepare(`UPDATE documents SET status = 'deleted'`).run();
    expect(() => brain().preview(docId('a.md'))).toThrowError('E_OUT_OF_SCOPE');
  });

  it('데이터 위치 지정 전(DB 없음)은 E_OUT_OF_SCOPE', () => {
    expect(() => createBrain({ store: () => null, openPath }).preview(1)).toThrowError('E_OUT_OF_SCOPE');
  });
});

describe('doc.openExternal', () => {
  beforeEach(async () => {
    put('a.md', '# A');
    await index();
  });

  it('색인된 .md만 realpath 확인 뒤 연다', async () => {
    expect(await brain().openExternal(docId('a.md'))).toEqual({ opened: true });
    expect(openPath).toHaveBeenCalledWith(path.join(srcDir, 'a.md'));
  });

  it('shell 실패는 opened: false', async () => {
    openPath.mockResolvedValueOnce('failed');
    expect(await brain().openExternal(docId('a.md'))).toEqual({ opened: false });
  });

  it('없는 문서·삭제 문서·사라진 파일', async () => {
    await expect(brain().openExternal(9999)).rejects.toThrow('E_NOT_FOUND');
    rmSync(path.join(srcDir, 'a.md'));
    await expect(brain().openExternal(docId('a.md'))).rejects.toThrow('E_NOT_FOUND');
    db.prepare(`UPDATE documents SET status = 'deleted'`).run();
    await expect(brain().openExternal(docId('a.md'))).rejects.toThrow('E_OUT_OF_SCOPE');
    expect(openPath).not.toHaveBeenCalled();
  });

  it('확장자 제한: pdf·error 상태·.md가 아닌 경로는 열지 않는다', async () => {
    put('c.txt', 'x');
    const id = Number(
      db
        .prepare(
          `INSERT INTO documents (source_id, rel_path, title, format, size, mtime, content_hash) VALUES (?, 'c.txt', 'c', 'md', 1, 1, 'h')`,
        )
        .run(sourceId).lastInsertRowid,
    );
    await expect(brain().openExternal(id)).rejects.toThrow('E_OUT_OF_SCOPE');
    db.prepare(`UPDATE documents SET format = 'pdf', rel_path = 'a.pdf' WHERE id = ?`).run(id);
    await expect(brain().openExternal(id)).rejects.toThrow('E_OUT_OF_SCOPE');
    db.prepare(`UPDATE documents SET status = 'error' WHERE rel_path = 'a.md'`).run();
    await expect(brain().openExternal(docId('a.md'))).rejects.toThrow('E_OUT_OF_SCOPE');
    expect(openPath).not.toHaveBeenCalled();
  });

  it('연결 폴더 밖을 가리키는 경로는 열지 않는다(.. 경로·junction 교체)', async () => {
    writeFileSync(path.join(tmp, 'outside.md'), '# out');
    const escape = Number(
      db
        .prepare(
          `INSERT INTO documents (source_id, rel_path, title, format, size, mtime, content_hash) VALUES (?, '../outside.md', 'o', 'md', 1, 1, 'h')`,
        )
        .run(sourceId).lastInsertRowid,
    );
    await expect(brain().openExternal(escape)).rejects.toThrow('E_OUT_OF_SCOPE');

    // 색인 뒤 하위 폴더가 밖을 가리키는 junction으로 바뀐 경우(읽기 직전 재확인)
    put('sub/in.md', '# in');
    await index();
    const id = docId('sub/in.md');
    mkdirSync(path.join(tmp, 'elsewhere'));
    writeFileSync(path.join(tmp, 'elsewhere', 'in.md'), '# swapped');
    renameSync(path.join(srcDir, 'sub'), path.join(tmp, 'sub-moved'));
    symlinkSync(path.join(tmp, 'elsewhere'), path.join(srcDir, 'sub'), 'junction');
    await expect(brain().openExternal(id)).rejects.toThrow('E_OUT_OF_SCOPE');
    expect(openPath).not.toHaveBeenCalled();
  });

  it('열기 직전 일반 파일이 아니면(폴더로 교체) 열지 않는다', async () => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO documents (source_id, rel_path, title, format, size, mtime, content_hash) VALUES (?, 'dir.md', 'd', 'md', 1, 1, 'h')`,
        )
        .run(sourceId).lastInsertRowid,
    );
    mkdirSync(path.join(srcDir, 'dir.md'));
    await expect(brain().openExternal(id)).rejects.toThrow('E_OUT_OF_SCOPE');
    expect(openPath).not.toHaveBeenCalled();
  });

  it('소스 루트가 다른 곳으로 바뀌었으면(root_changed) 열지 않는다', async () => {
    const moved = path.join(tmp, 'moved');
    mkdirSync(moved);
    writeFileSync(path.join(moved, 'a.md'), '# moved');
    rmSync(srcDir, { recursive: true, force: true });
    symlinkSync(moved, srcDir, 'junction');
    await expect(brain().openExternal(docId('a.md'))).rejects.toThrow('E_OUT_OF_SCOPE');
    expect(openPath).not.toHaveBeenCalled();
  });
});
