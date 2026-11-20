// Markdown 색인(A-03, task-019). 실제 사용자 자료 없이 임시 폴더만 쓴다.
import { mkdirSync, mkdtempSync, promises as fsp, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { searchDocuments } from '../src/main/db/fts';
import { DB_FILE_NAME, openDatabase } from '../src/main/db/open';
import { cleanupAfterRestart } from '../src/main/db/recovery';
import { MAX_LINKS_PER_DOC, MAX_TAGS_PER_DOC, decodeText, parseMarkdown } from '../src/main/indexer/parse';
import { type IndexerDeps, createIndexer } from '../src/main/indexer/service';
import { createBusyLock, createInvokeHandler } from '../src/main/ipc/router';
import { createRoutes } from '../src/main/ipc/routes';
import { createTrustedUrlCheck } from '../src/main/security';
import { createSources } from '../src/main/sources/service';

let tmp: string;
let srcDir: string;
let dataDir: string;
let db: Database.Database;
let sourceId: number;

beforeEach(async () => {
  tmp = await fsp.realpath(mkdtempSync(path.join(os.tmpdir(), 'ssr-idx-')));
  srcDir = path.join(tmp, 'notes');
  dataDir = path.join(tmp, 'data');
  mkdirSync(srcDir);
  mkdirSync(dataDir);
  db = (await openDatabase(path.join(dataDir, DB_FILE_NAME), { create: true })).db;
  sourceId = addSource(srcDir);
});

afterEach(() => {
  if (db.open) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function addSource(dir: string): number {
  return Number(
    db
      .prepare(`INSERT INTO sources (kind, path, label, created_at) VALUES ('folder', ?, 'notes', '2026-11-20T00:00:00.000Z')`)
      .run(dir).lastInsertRowid,
  );
}

function put(rel: string, content: string | Uint8Array, root = srcDir): string {
  const file = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function indexer(extra: Partial<IndexerDeps> = {}) {
  return createIndexer({ store: () => ({ db, dataDir }), ...extra });
}

async function run(ix = indexer(), id: number | undefined = sourceId) {
  ix.start(id);
  await ix.idle();
  const status = ix.status();
  return status.jobs.find((j) => j.sourceId === (id ?? sourceId)) as (typeof status.jobs)[number];
}

const docId = (rel: string) =>
  (db.prepare('SELECT id FROM documents WHERE rel_path = ?').get(rel) as { id: number } | undefined)?.id;
const docRow = (rel: string) =>
  db.prepare('SELECT title, status, error FROM documents WHERE rel_path = ?').get(rel) as
    | { title: string; status: string; error: string | null }
    | undefined;
const linksOf = (rel: string) =>
  db
    .prepare(
      `SELECT l.dst_key AS key, d.rel_path AS dst, l.kind FROM links l LEFT JOIN documents d ON d.id = l.dst_doc_id
       WHERE l.src_doc_id = ? ORDER BY l.dst_key`,
    )
    .all(docId(rel)) as { key: string; dst: string | null; kind: string }[];
const tagsOf = (rel: string) =>
  db.prepare('SELECT name, origin FROM tags WHERE doc_id = ? ORDER BY name').all(docId(rel)) as {
    name: string;
    origin: string;
  }[];

describe('링크·태그 파싱 규칙', () => {
  const A = [
    '# Alpha',
    '[[b]] [[b.md]] [[B|별칭]] [[b#제목]] ![[b]] [[ b \\| x ]]',
    '[x](sub/c.md#anchor) [y](sub%2Fc.md) [z](sub\\c.md) [w](<sub/c.md> "제목") [n](sub/c)',
    '[[missing]] [[a]] [[#only-heading]] [self](a.md) [self2](./a.md#top) [web](https://x.com/a.md) [mail](mailto:a@b.c)',
    'inline `[[code]] #code` here #tag1 #123 #한글태그 #Mixed/Sub/ x#notag',
    '```',
    '[[fenced]] #fenced',
    '```',
    '~~~~',
    '[[fenced2]]',
    '~~~~',
    '![[img.png]] [esc](../../out.md) [pdf](doc.pdf) [png](pic.png)',
  ].join('\n');

  it('파서: 별칭·제목·임베드·%디코드·앵커·구분자·코드 무시·확장자 합치기·자기 링크 제외', () => {
    const parsed = parseMarkdown(A, 'a.md');
    expect(parsed.title).toBe('Alpha');
    expect(parsed.links.map((l) => l.key).sort()).toEqual([
      'p:doc.pdf',
      'p:sub/c.md',
      'w:b.md',
      'w:missing.md',
      'x:../../out.md',
    ]);
    expect(parsed.tags).toEqual([
      { name: 'tag1', origin: 'inline' },
      { name: '한글태그', origin: 'inline' },
      { name: 'mixed/sub', origin: 'inline' },
    ]);
  });

  it('frontmatter tags 두 형식([a, b]·- 목록), 인라인과 겹치면 frontmatter 우선', () => {
    const one = parseMarkdown('---\ntitle: x\ntags: [Front, "two", #three]\n---\n#front #inline', 'x.md');
    expect(one.tags).toEqual([
      { name: 'front', origin: 'frontmatter' },
      { name: 'two', origin: 'frontmatter' },
      { name: 'three', origin: 'frontmatter' },
      { name: 'inline', origin: 'inline' },
    ]);
    const two = parseMarkdown("---\ntags:\n  - list1\n  - '#List2'\nother: 1\n---\n# T", 'y.md');
    expect(two.tags.map((t) => t.name)).toEqual(['list1', 'list2']);
    expect(two.title).toBe('T');
    // frontmatter 안의 #은 인라인 태그가 아니다
    expect(parseMarkdown('---\nnote: "#nope"\n---\nbody', 'z.md').tags).toEqual([]);
  });

  it('인코딩: UTF-8 BOM 제거, UTF-16 LE/BE(BOM), NUL은 바이너리, 잘못된 UTF-8은 대체 문자', () => {
    expect(decodeText(Buffer.from('\ufeff# 제목', 'utf8'))).toEqual({ text: '# 제목' });
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# 한글', 'utf16le')]);
    expect(decodeText(le)).toEqual({ text: '# 한글' });
    const be = Buffer.from(le.subarray(2)).swap16();
    expect(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toEqual({ text: '# 한글' });
    expect(decodeText(Buffer.from([0x23, 0x00, 0x41]))).toEqual({ error: 'binary' });
    expect(decodeText(Buffer.from([0x61, 0xff, 0x62]))).toEqual({ text: 'a\ufffdb' });
  });

  it('샘플 폴더 색인: 표기 합치기(UNIQUE dst_key)·깨진 링크·동명 파일 선택·../ 탈출 미해석', async () => {
    put('a.md', A);
    put('b.md', '---\ntags: [Front, two]\n---\n# Beta');
    put('sub/c.md', '---\ntags:\n  - list1\n---\nbody [[b]] [[deep/e]]');
    put('sub/b.md', '# sub b');
    put('other/d.md', '[[b]] [up](../a.md)');
    put('x/y/deep/e.md', 'e');
    put('deep/e.md', 'e2');
    const job = await run();
    expect(job.status).toBe('succeeded');
    expect(job.counts).toMatchObject({ total: 7, processed: 7, failed: 0 });

    expect(linksOf('a.md')).toEqual([
      { key: 'p:doc.pdf', dst: null, kind: 'link' },
      { key: 'p:sub/c.md', dst: 'sub/c.md', kind: 'link' },
      { key: 'w:b.md', dst: 'b.md', kind: 'link' },
      { key: 'w:missing.md', dst: null, kind: 'link' },
      { key: 'x:../../out.md', dst: null, kind: 'link' },
    ]);
    // 같은 폴더 우선(sub/b.md), 경로 꼬리 일치 중 짧은 경로(deep/e.md)
    expect(linksOf('sub/c.md')).toEqual([
      { key: 'w:b.md', dst: 'sub/b.md', kind: 'link' },
      { key: 'w:deep/e.md', dst: 'deep/e.md', kind: 'link' },
    ]);
    // 다른 폴더에서는 경로가 짧은 것(b.md). ../는 소스 안이면 해석된다.
    expect(linksOf('other/d.md')).toEqual([
      { key: 'p:a.md', dst: 'a.md', kind: 'link' },
      { key: 'w:b.md', dst: 'b.md', kind: 'link' },
    ]);
    expect(tagsOf('a.md')).toEqual([
      { name: 'mixed/sub', origin: 'inline' },
      { name: 'tag1', origin: 'inline' },
      { name: '한글태그', origin: 'inline' },
    ]);
    expect(tagsOf('b.md')).toEqual([
      { name: 'front', origin: 'frontmatter' },
      { name: 'two', origin: 'frontmatter' },
    ]);
    expect(docRow('b.md')?.title).toBe('Beta');
    expect(docRow('x/y/deep/e.md')?.title).toBe('e');
    // 본문은 FTS로 찾힌다
    expect(searchDocuments(db, 'Alpha').hits.map((h) => h.title)).toEqual(['Alpha']);
  });

  it('다른 소스의 같은 이름 문서로는 해석하지 않는다', async () => {
    const otherDir = path.join(tmp, 'other');
    put('target.md', 'x', otherDir);
    const other = addSource(otherDir);
    put('a.md', '[[target]]');
    const ix = indexer();
    ix.start();
    await ix.idle();
    expect(docId('target.md')).toBeDefined();
    expect(other).toBeGreaterThan(0);
    expect(linksOf('a.md')).toEqual([{ key: 'w:target.md', dst: null, kind: 'link' }]);
  });
});

describe('증분·삭제·재해석', () => {
  it('size+mtime 같으면 건너뜀, 다르면 해시 비교, parser_version 다르면 재처리', async () => {
    put('a.md', '# A');
    const b = put('b.md', '# B');
    expect((await run()).counts).toMatchObject({ processed: 2, unchanged: 0 });
    expect((await run()).counts).toMatchObject({ processed: 0, unchanged: 2 });

    utimesSync(b, new Date(), new Date(Date.now() + 5000)); // 내용 같고 mtime만 바뀜 → 해시 같아 처리 0
    expect((await run()).counts).toMatchObject({ processed: 0, unchanged: 2 });
    expect((await run()).counts).toMatchObject({ processed: 0, unchanged: 2 });

    writeFileSync(b, '# B2');
    expect((await run()).counts).toMatchObject({ processed: 1, unchanged: 1 });
    expect(docRow('b.md')?.title).toBe('B2');

    db.prepare('UPDATE documents SET parser_version = 0 WHERE rel_path = ?').run('a.md');
    expect((await run()).counts).toMatchObject({ processed: 1, unchanged: 1 });
  });

  it('완료된 순회에서만 삭제 표시(태그 삭제), 나중에 생긴 대상은 재해석, manual 보존', async () => {
    const aFile = put('a.md', '[[b]] [[later]] #keep');
    const bFile = put('b.md', '#btag');
    await run();
    const a = docId('a.md') as number;
    const b = docId('b.md') as number;
    db.prepare(
      `INSERT INTO links (src_doc_id, dst_doc_id, dst_raw, dst_key, kind, created_at) VALUES (?, ?, 'b', ?, 'manual', 'x')`,
    ).run(a, b, `m:${b}`);
    expect(linksOf('a.md').find((l) => l.key === 'w:later.md')?.dst).toBeNull();

    rmSync(bFile);
    put('later.md', 'now here');
    const job = await run();
    expect(job.counts.deleted).toBe(1);
    expect(docRow('b.md')?.status).toBe('deleted');
    expect(tagsOf('b.md')).toEqual([]);
    expect(linksOf('a.md').find((l) => l.key === 'w:later.md')?.dst).toBe('later.md');

    // 대상이 돌아오면 deleted를 가리키던 링크도 살아난 문서로 해석된다(같은 id 복원)
    put('b.md', '#btag');
    await run();
    expect(docId('b.md')).toBe(b);
    expect(docRow('b.md')?.status).toBe('ok');
    expect(tagsOf('b.md')).toEqual([{ name: 'btag', origin: 'inline' }]);

    // a를 다시 색인해도 manual은 남고 link 행만 바뀐다
    writeFileSync(aFile, '[[later]]');
    await run();
    expect(linksOf('a.md')).toEqual([
      { key: `m:${b}`, dst: 'b.md', kind: 'manual' },
      { key: 'w:later.md', dst: 'later.md', kind: 'link' },
    ]);
  });

  it('중단된 순회는 삭제 처리하지 않고, 재시작 정리 후 다음 색인에서 처리한다', async () => {
    for (let i = 0; i < 5; i += 1) put(`n${i}.md`, `# ${i}`);
    const gone = put('gone.md', '#t');
    await run();
    rmSync(gone);
    writeFileSync(path.join(srcDir, 'n0.md'), '# changed');

    const ix = indexer({
      batchSize: 1,
      yieldFn: async () => {
        ix.stop();
      },
    });
    ix.start(sourceId);
    await ix.idle();
    expect(ix.busy()).toBe(false);
    expect(docRow('gone.md')?.status).toBe('ok');
    expect(tagsOf('gone.md')).toEqual([{ name: 't', origin: 'inline' }]);
    const stuck = db.prepare('SELECT status FROM index_jobs ORDER BY id DESC LIMIT 1').get();
    expect(stuck).toEqual({ status: 'running' });
    expect(db.prepare('SELECT status FROM sources WHERE id = ?').get(sourceId)).toEqual({ status: 'indexing' });

    // 재시작 정리: 작업 interrupted, 소스 ok → 다음 색인 정상
    expect(cleanupAfterRestart(db)).toMatchObject({ indexJobs: 1, sources: 1 });
    const job = await run();
    expect(job.status).toBe('succeeded');
    expect(job.counts.deleted).toBe(1);
    expect(docRow('gone.md')?.status).toBe('deleted');
  });
});

describe('제외·크기·인코딩·링크', () => {
  it('점·$·System Volume Information·node_modules·민감 폴더·데이터 폴더 제외', async () => {
    put('ok.md', 'x');
    for (const d of ['.hidden', '.ssh', '.claude', '.config', '$RECYCLE.BIN', 'node_modules', 'System Volume Information']) {
      put(`${d}/x.md`, 'secret');
      put(`deep/${d}/y.md`, 'secret');
    }
    put('.dot.md', 'x');
    put('inner-data/z.md', 'x');
    const ix = createIndexer({ store: () => ({ db, dataDir: path.join(srcDir, 'inner-data') }) });
    expect(await ix.preview(sourceId)).toEqual({ targets: 1, excluded: 16, tooLarge: 0, reason: null });
    await run(ix);
    expect((db.prepare('SELECT rel_path FROM documents').all() as { rel_path: string }[]).map((r) => r.rel_path)).toEqual([
      'ok.md',
    ]);
  });

  it('5MB 초과·바이너리는 실패 코드로 건너뛰고, UTF-16·BOM·잘못된 UTF-8은 색인', async () => {
    put('big.md', Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    put('edge.md', Buffer.alloc(5 * 1024 * 1024, 0x61));
    put('bin.md', Buffer.from([0x23, 0x20, 0x00, 0x01]));
    put('u16le.md', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('# 엘이\n#le', 'utf16le')]));
    put('u16be.md', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('# 비이\n#be', 'utf16le').swap16()]));
    put('bom.md', Buffer.from('\ufeff# 봄', 'utf8'));
    put('bad.md', Buffer.from([0x23, 0x20, 0x61, 0xff, 0x62]));
    const ix = indexer();
    expect((await ix.preview(sourceId)).tooLarge).toBe(1);
    const job = await run(ix);
    expect(job.counts).toMatchObject({ total: 7, processed: 5, failed: 2 });
    expect(docRow('big.md')).toMatchObject({ status: 'error', error: 'too_large' });
    expect(docRow('bin.md')).toMatchObject({ status: 'error', error: 'binary' });
    expect(docRow('u16le.md')?.title).toBe('엘이');
    expect(docRow('u16be.md')?.title).toBe('비이');
    expect(tagsOf('u16be.md')).toEqual([{ name: 'be', origin: 'inline' }]);
    expect(docRow('bom.md')?.title).toBe('봄');
    expect(docRow('bad.md')?.title).toBe('a\ufffdb');
    expect(ix.status().failures).toEqual([
      { sourceId, relPath: 'big.md', reason: 'too_large' },
      { sourceId, relPath: 'bin.md', reason: 'binary' },
    ]);
    // 실패 파일도 바뀌지 않았으면 다시 처리하지 않는다
    expect((await run(ix)).counts).toMatchObject({ processed: 0, failed: 0, unchanged: 7 });
  });

  it('소스 안 junction·심볼릭 링크가 밖을 가리키면 제외한다', async () => {
    const outside = path.join(tmp, 'outside');
    put('secret.md', '# secret', outside);
    put('ok.md', 'x');
    symlinkSync(outside, path.join(srcDir, 'jn'), 'junction');
    let fileLink = true;
    try {
      symlinkSync(path.join(outside, 'secret.md'), path.join(srcDir, 'link.md'), 'file');
    } catch {
      fileLink = false; // 파일 심볼릭 링크는 Windows 개발자 모드·관리자 권한이 필요하다
    }
    const ix = indexer();
    expect(await ix.preview(sourceId)).toMatchObject({ targets: 1, excluded: fileLink ? 2 : 1 });
    await run(ix);
    expect(db.prepare('SELECT rel_path FROM documents').all()).toEqual([{ rel_path: 'ok.md' }]);
    expect(searchDocuments(db, 'secret').hits).toEqual([]);
  });

  it('루트 realpath가 바뀌면 root_changed로 실패하고 아무것도 지우지 않는다, 없으면 root_missing', async () => {
    put('a.md', 'x');
    await run();
    const elsewhere = path.join(tmp, 'elsewhere');
    put('b.md', 'y', elsewhere);
    renameSync(srcDir, path.join(tmp, 'moved'));
    symlinkSync(elsewhere, srcDir, 'junction');
    const ix = indexer();
    expect((await ix.preview(sourceId)).reason).toBe('root_changed');
    const job = await run(ix);
    expect(job).toMatchObject({ status: 'failed', reason: 'root_changed' });
    expect(docRow('a.md')?.status).toBe('ok');
    expect(docId('b.md')).toBeUndefined();

    rmSync(srcDir);
    const missing = await run(ix);
    expect(missing).toMatchObject({ status: 'failed', reason: 'root_missing' });
    expect(db.prepare('SELECT status FROM sources WHERE id = ?').get(sourceId)).toEqual({ status: 'missing' });
  });
});

describe('동시성·IPC', () => {
  const trusted = { senderFrame: { url: 'app://bundle/index.html', parent: null } };

  it('색인 중 index.start는 E_BUSY, 없는 소스는 E_NOT_FOUND, 색인 중 소스 삭제는 E_BUSY', async () => {
    for (let i = 0; i < 120; i += 1) put(`n${i}.md`, `# ${i}`);
    const ix = indexer();
    const sources = createSources({
      store: () => ({ db, dataDir }),
      policy: { env: {}, home: tmp, userData: tmp },
      pickFolder: async () => null,
      exclusive: createBusyLock(),
    });
    const handler = createInvokeHandler({
      routes: createRoutes({
        envCheck: async () => ({}) as never,
        setDataDir: async () => ({ status: 'canceled' }),
        sources,
        index: ix,
      }),
      isTrustedUrl: createTrustedUrlCheck(),
    });
    expect(await handler(trusted, 'index.start', { sourceId: 999 })).toEqual({ ok: false, error: { code: 'E_NOT_FOUND' } });
    expect(await handler(trusted, 'index.start', { sourceId, path: 'C:\\x' })).toEqual({
      ok: false,
      error: { code: 'E_VALIDATION' },
    });
    expect((await handler(trusted, 'index.start', { sourceId })).ok).toBe(true);
    expect(await handler(trusted, 'index.start', undefined)).toEqual({ ok: false, error: { code: 'E_BUSY' } });
    expect(await handler(trusted, 'sources.remove', { sourceId })).toEqual({ ok: false, error: { code: 'E_BUSY' } });
    // 미리보기는 동시 허용
    expect(await handler(trusted, 'index.preview', { sourceId })).toMatchObject({ ok: true, data: { targets: 120 } });
    await ix.idle();
    expect(await handler(trusted, 'index.status', {})).toMatchObject({
      ok: true,
      data: { running: false, jobs: [{ status: 'succeeded', counts: { processed: 120 } }] },
    });
  });

  it('색인 중에도 다른 IPC가 응답한다(지연 측정)', async () => {
    for (let i = 0; i < 600; i += 1) put(`d${i % 10}/n${i}.md`, `# 문서 ${i}\n[[n${i + 1}]] #t${i % 7}\n${'본문 '.repeat(200)}`);
    const batches: number[] = [];
    const ix = indexer({ onBatch: (ms) => batches.push(ms) });
    const handler = createInvokeHandler({
      routes: createRoutes({
        envCheck: async () => ({}) as never,
        setDataDir: async () => ({ status: 'canceled' }),
        sources: { list: () => [], add: async () => ({ source: null }), remove: () => ({}) },
        index: ix,
      }),
      isTrustedUrl: createTrustedUrlCheck(),
    });
    ix.start(sourceId);
    const latencies: number[] = [];
    let sawProgress = false;
    while (ix.busy()) {
      // 5ms 뒤 요청을 보내려 한 시점부터 응답까지(배치가 이벤트 루프를 막은 시간 포함)
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 5));
      const res = await handler(trusted, 'index.status', undefined);
      latencies.push(performance.now() - t0 - 5);
      if (res.ok && (res.data as { running: boolean }).running) sawProgress = true;
    }
    const max = Math.max(...latencies);
    console.log(
      `[indexer] IPC 응답 ${latencies.length}회 최대 ${max.toFixed(1)}ms · 배치 ${batches.length}개 최대 ${Math.max(...batches).toFixed(1)}ms`,
    );
    expect(sawProgress).toBe(true);
    expect(latencies.length).toBeGreaterThan(3);
    expect(max).toBeLessThan(200);
  });

  it('성능: 합성 Markdown 2,000개 첫 색인·무변경 재색인 시간', async () => {
    for (let i = 0; i < 2000; i += 1) {
      put(`f${i % 40}/s${i % 7}/doc${i}.md`, `---\ntags: [t${i % 13}]\n---\n# 문서 ${i}\n[[doc${(i * 7) % 2000}]] [r](../s${(i + 1) % 7}/doc${i + 1}.md) #tag${i % 50}\n${'가나다 본문 텍스트 '.repeat(60)}`);
    }
    const batches: number[] = [];
    const ix = indexer({ onBatch: (ms) => batches.push(ms) });
    let t0 = performance.now();
    const first = await run(ix);
    const firstMs = performance.now() - t0;
    t0 = performance.now();
    const again = await run(ix);
    const againMs = performance.now() - t0;
    console.log(
      `[indexer] 2,000개 첫 색인 ${firstMs.toFixed(0)}ms · 무변경 재색인 ${againMs.toFixed(0)}ms · 첫 색인 배치 최대 ${Math.max(...batches.slice(0, 40)).toFixed(1)}ms`,
    );
    expect(first.counts).toMatchObject({ total: 2000, processed: 2000 });
    expect(again.counts).toMatchObject({ processed: 0, unchanged: 2000 });
  }, 120_000);
});

describe('리뷰 반영: ReDoS·파서 경계', () => {
  const timeParse = (text: string) => {
    const t0 = performance.now();
    parseMarkdown(text, 'big.md');
    return performance.now() - t0;
  };
  const FIVE_MB = 5 * 1024 * 1024;

  it('5MB 한 줄·4KB 줄 반복의 `[`·백틱·공백 폭주에서 파싱 < 500ms', () => {
    const line4k = (unit: string) =>
      `${unit.repeat(Math.floor(4000 / unit.length))}\n`.repeat(Math.floor(FIVE_MB / 4000));
    const cases: Record<string, string> = {
      'bracket-oneline': '['.repeat(FIVE_MB),
      'backtick-oneline': '` ``'.repeat(FIVE_MB / 4),
      'space-oneline': `#${' '.repeat(FIVE_MB)}x`,
      'bracket-lines': line4k(']('),
      'open-bracket-lines': line4k('['),
      'backtick-lines': line4k('` `` ``` '),
      'space-lines': line4k(`# ${' '.repeat(20)}#`),
      'wiki-lines': line4k('[[a'),
    };
    for (const [name, text] of Object.entries(cases)) {
      const ms = timeParse(text);
      console.log(`[indexer] parse ${name} ${ms.toFixed(0)}ms`);
      expect(ms, name).toBeLessThan(500);
    }
  }, 60_000);

  it('이스케이프 괄호·괄호 균형·중첩 라벨·4칸 들여쓰기 코드·BOM 뒤 NUL', () => {
    const doc = [
      '[x](foo\\(bar\\).md) [a [b] c](target.md) [p](a(b).md) [t](<sp ace.md> "제목")',
      '',
      '    [[code]] #code',
      '    [k](indented.md)',
      '',
      'after #real',
    ].join('\n');
    const parsed = parseMarkdown(doc, 'src.md');
    expect(parsed.links.map((l) => l.key)).toEqual(['p:foo(bar).md', 'p:target.md', 'p:a(b).md', 'p:sp ace.md']);
    expect(parsed.tags.map((t) => t.name)).toEqual(['real']);
    // 문단에 이어진 들여쓰기 줄은 코드가 아니다
    expect(parseMarkdown('para\n    #tag', 'x.md').tags.map((t) => t.name)).toEqual(['tag']);
    expect(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x00]))).toEqual({ error: 'binary' });
  });

  it('문서당 링크 1000·태그 100 상한, 넘으면 truncated로 표시', async () => {
    const many = Array.from({ length: 1100 }, (_, i) => `[[n${i}]] #t${i}`).join('\n');
    const parsed = parseMarkdown(many, 'm.md');
    expect(parsed.links).toHaveLength(MAX_LINKS_PER_DOC);
    expect(parsed.tags).toHaveLength(MAX_TAGS_PER_DOC);
    expect(parsed.truncated).toBe(true);
    put('m.md', many);
    const job = await run();
    expect(job.counts).toMatchObject({ processed: 1, truncated: 1 });
    expect(db.prepare('SELECT count(*) AS n FROM links').get()).toEqual({ n: MAX_LINKS_PER_DOC });
  });
});

describe('리뷰 반영: 불완전 순회·경합·범위', () => {
  const failing = (match: (p: string) => boolean, code: string, op: 'lstat' | 'readdir') => ({
    readdir: ((p: string, o: unknown) => {
      if (op === 'readdir' && match(p)) return Promise.reject(Object.assign(new Error(code), { code }));
      return fsp.readdir(p, o as { withFileTypes: true });
    }) as typeof fsp.readdir,
    lstat: ((p: string) => {
      if (op === 'lstat' && match(p)) return Promise.reject(Object.assign(new Error(code), { code }));
      return fsp.lstat(p);
    }) as typeof fsp.lstat,
  });
  const sourceRow = () =>
    db.prepare('SELECT status, last_indexed_at FROM sources WHERE id = ?').get(sourceId) as {
      status: string;
      last_indexed_at: string | null;
    };

  it('lstat EACCES·하위 readdir EACCES는 partial로 끝나고 삭제 처리·마지막 색인 시각 갱신을 하지 않는다', async () => {
    put('locked.md', '#keep');
    put('sub/inner.md', '#inner');
    const gone = put('gone.md', 'x');
    await run();
    const before = sourceRow().last_indexed_at;
    rmSync(gone);

    const cases = [
      ['lstat', (p: string) => p.endsWith('locked.md'), 'locked.md'],
      ['readdir', (p: string) => p.endsWith(`${path.sep}sub`), 'sub'],
    ] as const;
    for (const [op, match, expected] of cases) {
      const job = await run(indexer({ walkFs: failing(match, 'EACCES', op) }));
      expect(job).toMatchObject({ status: 'partial', unreadable: [expected], counts: { deleted: 0 } });
      expect(docRow('locked.md')?.status).toBe('ok');
      expect(docRow('sub/inner.md')?.status).toBe('ok');
      expect(docRow('gone.md')?.status).toBe('ok');
      expect(tagsOf('locked.md')).toEqual([{ name: 'keep', origin: 'inline' }]);
      expect(sourceRow()).toEqual({ status: 'ok', last_indexed_at: before });
    }

    // ENOENT(순회 중 사라짐)는 보지 못한 것으로 처리해 삭제된다
    const job = await run(indexer({ walkFs: failing((p) => p.endsWith('locked.md'), 'ENOENT', 'lstat') }));
    expect(job.status).toBe('succeeded');
    expect(docRow('locked.md')?.status).toBe('deleted');
    expect(docRow('gone.md')?.status).toBe('deleted');
  });

  it('배치가 롤백되면 처리 건수는 커밋된 것만 남는다', async () => {
    for (const n of ['a', 'b', 'c', 'd']) put(`${n}.md`, n);
    db.exec(
      `CREATE TRIGGER boom BEFORE INSERT ON documents WHEN new.rel_path = 'c.md' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    const job = await run(indexer({ batchSize: 2 }));
    const stored = db.prepare('SELECT count(*) AS n FROM documents').get() as { n: number };
    expect(job).toMatchObject({ status: 'failed', reason: 'internal' });
    expect(stored.n).toBe(2);
    expect(job.counts.processed).toBe(stored.n);
  });

  it('읽기 대기 중 stop·DB close: 예외 없이 끝나고 잠금·파일 핸들이 풀린다', async () => {
    for (let i = 0; i < 30; i += 1) put(`n${i}.md`, `# ${i}`);
    let stoppedOnce = false;
    const ix = indexer({
      onRead: () => {
        if (stoppedOnce) return;
        stoppedOnce = true;
        ix.stop();
        db.close();
      },
    });
    ix.start(sourceId);
    await expect(ix.idle()).resolves.toBeUndefined();
    expect(ix.busy()).toBe(false);
    // 열린 핸들이 남아 있으면 Windows에서 삭제가 실패한다
    rmSync(path.join(srcDir, 'n0.md'));

    db = (await openDatabase(path.join(dataDir, DB_FILE_NAME), { create: false })).db;
    expect(db.prepare('SELECT status FROM index_jobs').all()).toEqual([{ status: 'running' }]);
    cleanupAfterRestart(db);
    const job = await run(ix);
    expect(job).toMatchObject({ status: 'succeeded', counts: { processed: 29 } });
  });

  it('소스 루트가 데이터 위치 안이면 data_dir_overlap으로 실패한다', async () => {
    const inside = path.join(dataDir, 'inside');
    put('a.md', 'x', inside);
    const id = addSource(inside);
    const job = await run(indexer(), id);
    expect(job).toMatchObject({ status: 'failed', reason: 'data_dir_overlap' });
    expect(docId('a.md')).toBeUndefined();
  });

  it('순회 뒤 경로가 밖을 가리키게 바뀌면 읽지 않고 out_of_scope', async () => {
    put('a.md', 'a');
    put('sub/z.md', '# inside');
    const outside = path.join(tmp, 'outside');
    put('z.md', '# outside secret', outside);
    let swapped = false;
    const ix = indexer({
      batchSize: 1,
      yieldFn: async () => {
        if (swapped) return;
        swapped = true;
        renameSync(path.join(srcDir, 'sub'), path.join(tmp, 'sub-old'));
        symlinkSync(outside, path.join(srcDir, 'sub'), 'junction');
      },
    });
    await run(ix);
    expect(docRow('sub/z.md')).toMatchObject({ status: 'error', error: 'out_of_scope' });
    expect(searchDocuments(db, 'secret').hits).toEqual([]);
  });
});
