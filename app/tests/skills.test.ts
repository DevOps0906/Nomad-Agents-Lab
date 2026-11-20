// 스킬 목록·상세·폴더 열기(A-07·A-08, task-011). 스킬 루트는 임시 폴더로 주입하고 shell은 가짜로 바꾼다.
import { mkdirSync, mkdtempSync, promises as fsp, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_FILE_NAME, openDatabase } from '../src/main/db/open';
import { createInvokeHandler } from '../src/main/ipc/router';
import { createRoutes } from '../src/main/ipc/routes';
import { createTrustedUrlCheck } from '../src/main/security';
import {
  FRONTMATTER_MAX_BYTES,
  SKILL_FILE_MAX_BYTES,
  type SkillRootDir,
  createSkills,
  parseSkillMarkdown,
} from '../src/main/skills/service';

let tmp: string;
let userDir: string;
let appDir: string;
let db: Database.Database;
let roots: SkillRootDir[];
const openPath = vi.fn(async (_file: string) => '');

beforeEach(async () => {
  openPath.mockClear();
  tmp = await fsp.realpath(mkdtempSync(path.join(os.tmpdir(), 'ssr-skills-')));
  userDir = path.join(tmp, 'user-skills');
  appDir = path.join(tmp, 'app-skills');
  mkdirSync(userDir);
  mkdirSync(path.join(tmp, 'data'));
  db = (await openDatabase(path.join(tmp, 'data', DB_FILE_NAME), { create: true })).db;
  roots = [{ root: 'user', dir: userDir }];
});

afterEach(() => {
  if (db.open) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function put(folder: string, content: string, dir = userDir): void {
  mkdirSync(path.join(dir, folder), { recursive: true });
  writeFileSync(path.join(dir, folder, 'SKILL.md'), content);
}

const good = (name: string, extra = '') => `---\nname: ${name}\ndescription: ${name} 설명\n${extra}---\n본문 ${name}\n`;
const U = (folder: string) => ({ root: 'user' as const, folder });
const skills = () => createSkills({ store: () => ({ db }), roots: () => roots, openPath });

describe('parseSkillMarkdown: 잘못된 SKILL.md는 사유 코드만', () => {
  const cases: [string, string, string][] = [
    ['frontmatter 없음', '# 제목\n본문', 'no_frontmatter'],
    ['닫는 --- 없음', '---\nname: a\n본문', 'no_frontmatter'],
    ['YAML 오류', '---\nname: [unclosed\n---\n', 'yaml_error'],
    ['객체 아님', '---\n- a\n- b\n---\n', 'frontmatter_not_object'],
    ['빈 frontmatter', '---\n---\n', 'frontmatter_not_object'],
    ['name 누락', '---\ndescription: x\n---\n', 'name_missing'],
    ['name 숫자', '---\nname: 123\n---\n', 'name_invalid'],
    ['name 너무 김', `---\nname: ${'a'.repeat(101)}\n---\n`, 'name_invalid'],
    ['ssr 객체 아님', '---\nname: a\nssr: yes please\n---\n', 'ssr_invalid'],
    ['ssr.inputs 형식 위반', '---\nname: a\nssr:\n  inputs:\n    - name: q\n      required: maybe\n---\n', 'ssr_invalid'],
    ['ssr.inputs 이름 중복', '---\nname: a\nssr:\n  inputs:\n    - name: q\n    - name: q\n---\n', 'ssr_invalid'],
    ['ssr.tools 문자열 아님', '---\nname: a\nssr:\n  tools: [1, 2]\n---\n', 'ssr_invalid'],
    ['ssr.reads 상한 초과', `---\nname: a\nssr:\n  reads: [${Array.from({ length: 21 }, (_, i) => `r${i}`).join(', ')}]\n---\n`, 'ssr_invalid'],
    [
      '별칭 폭주',
      `---\nname: a\nbase: &x value\n${Array.from({ length: 30 }, (_, i) => `k${i}: *x`).join('\n')}\n---\n`,
      'alias_limit',
    ],
    ['frontmatter 크기 초과', `---\nname: a\nnote: ${'x'.repeat(FRONTMATTER_MAX_BYTES)}\n---\n`, 'frontmatter_too_large'],
  ];
  it.each(cases)('%s → %s', (_title, text, code) => {
    expect(parseSkillMarkdown(text).error).toBe(code);
  });

  it('ssr가 없으면 유효하고 ssr=null', () => {
    const r = parseSkillMarkdown('---\nname: plain\ndescription: d\n---\n본문');
    expect(r).toMatchObject({ error: null, name: 'plain', description: 'd', ssr: null, body: '본문' });
  });

  it('BOM·CRLF·ssr 기본값을 처리한다', () => {
    const r = parseSkillMarkdown('\uFEFF---\r\nname: crlf\r\nssr:\r\n  inputs:\r\n    - name: topic\r\n      required: true\r\n---\r\n본문');
    expect(r.error).toBeNull();
    expect(r.ssr).toEqual({ inputs: [{ name: 'topic', required: true }], reads: [], tools: [] });
  });
});

describe('skills.list', () => {
  it('잘못된 SKILL.md는 valid=false + 사유 코드, 올바른 스킬은 유효', async () => {
    put('ok-plain', good('ok-plain'));
    put('ok-ssr', good('ok-ssr', 'ssr:\n  inputs:\n    - name: topic\n      required: true\n  reads: [notes]\n  tools: [Read]\n'));
    put('no-front', '# 제목만 있음');
    put('bad-yaml', '---\nname: [unclosed\n---\n');
    put('no-name', '---\ndescription: 이름 없음\n---\n');
    put('bad-ssr', good('bad-ssr', 'ssr:\n  inputs: not-a-list\n'));
    put('alias-bomb', `---\nname: alias-bomb\nbase: &x v\n${Array.from({ length: 30 }, (_, i) => `k${i}: *x`).join('\n')}\n---\n`);
    put('huge', `---\nname: huge\n---\n${'x'.repeat(SKILL_FILE_MAX_BYTES + 10)}`);
    mkdirSync(path.join(userDir, 'empty-folder'));
    const { items, roots: rootStatus } = await skills().list();
    expect(rootStatus).toEqual([{ root: 'user', status: 'ok' }]);
    const by = (folder: string) => items.find((i) => i.folder === folder);
    expect(by('ok-plain')).toMatchObject({ valid: true, error: null, name: 'ok-plain', description: 'ok-plain 설명', root: 'user', lastRun: null });
    expect(by('ok-ssr')).toMatchObject({ valid: true, error: null });
    expect(by('no-front')).toMatchObject({ valid: false, error: 'no_frontmatter', name: 'no-front' });
    expect(by('bad-yaml')).toMatchObject({ valid: false, error: 'yaml_error' });
    expect(by('no-name')).toMatchObject({ valid: false, error: 'name_missing' });
    expect(by('bad-ssr')).toMatchObject({ valid: false, error: 'ssr_invalid' });
    expect(by('alias-bomb')).toMatchObject({ valid: false, error: 'alias_limit' });
    expect(by('huge')).toMatchObject({ valid: false, error: 'too_large' });
    expect(by('empty-folder')).toBeUndefined();
  });

  it('같은 폴더 안 중복 name은 폴더 이름순 첫 번째만 유효', async () => {
    put('b-copy', good('dup'));
    put('a-first', good('dup'));
    put('c-copy', good('dup'));
    const { items } = await skills().list();
    const dups = items.filter((i) => i.name === 'dup');
    expect(dups.map((i) => [i.folder, i.valid, i.error])).toEqual([
      ['a-first', true, null],
      ['b-copy', false, 'duplicate_name'],
      ['c-copy', false, 'duplicate_name'],
    ]);
  });

  it('앱 폴더가 사용자 폴더보다 우선한다(Q12)', async () => {
    put('same', good('same'), userDir);
    put('same-app', good('same'), appDir);
    roots = [
      { root: 'user', dir: userDir },
      { root: 'app', dir: appDir },
    ];
    const { items } = await skills().list();
    expect(items.find((i) => i.root === 'app')).toMatchObject({ valid: true });
    expect(items.find((i) => i.root === 'user')).toMatchObject({ valid: false, error: 'shadowed' });
  });

  it('링크·junction 하위 폴더는 따라가지 않고 제외, 하위 폴더의 하위는 보지 않는다', async () => {
    const outside = path.join(tmp, 'outside');
    put('outside-skill', good('escaped'), outside);
    symlinkSync(path.join(outside, 'outside-skill'), path.join(userDir, 'linked'), 'junction');
    put('real', good('real'));
    put('real/nested', good('nested'));
    // SKILL.md 자체가 링크인 경우
    mkdirSync(path.join(userDir, 'file-link'));
    try {
      symlinkSync(path.join(outside, 'outside-skill', 'SKILL.md'), path.join(userDir, 'file-link', 'SKILL.md'), 'file');
    } catch {
      // 파일 심볼릭 링크 권한이 없는 환경은 건너뛴다.
    }
    const { items } = await skills().list();
    const names = items.map((i) => i.name);
    expect(names).not.toContain('escaped');
    expect(names).not.toContain('nested');
    expect(items.find((i) => i.folder === 'linked')).toBeUndefined();
    expect(items.find((i) => i.folder === 'real')).toMatchObject({ valid: true });
    const fileLink = items.find((i) => i.folder === 'file-link');
    if (fileLink) expect(fileLink).toMatchObject({ valid: false, error: 'not_file' });
  });

  it('검색어는 이름·설명으로 거른다, 없는 스킬 폴더는 missing', async () => {
    put('alpha', good('alpha'));
    put('beta', '---\nname: beta\ndescription: Gardening helper\n---\n');
    const s = skills();
    expect((await s.list({ query: 'GARDEN' })).items.map((i) => i.name)).toEqual(['beta']);
    expect((await s.list({ query: 'zzz' })).items).toEqual([]);
    roots = [{ root: 'user', dir: path.join(tmp, 'nope') }];
    expect(await s.list()).toEqual({ items: [], roots: [{ root: 'user', status: 'missing' }] });
  });

  it('SQLite에 색인하고 없어진 폴더는 지우며, last_run은 runs에서 읽는다', async () => {
    put('one', good('one'));
    put('two', good('two'));
    const s = skills();
    await s.list();
    expect((db.prepare('SELECT count(*) AS n FROM skills').get() as { n: number }).n).toBe(2);
    expect(db.prepare(`SELECT valid, error, length(content_hash) AS h FROM skills WHERE name = 'one'`).get()).toEqual({
      valid: 1,
      error: null,
      h: 64,
    });
    rmSync(path.join(userDir, 'two'), { recursive: true });
    db.prepare(
      `INSERT INTO runs (skill_name, skill_hash, input_json, scope_json, provider_label, external_processing_consent_at, status, started_at)
       VALUES ('one', 'h', '{}', '{}', 'p', '2026-11-20T00:00:00Z', 'succeeded', '2026-11-20T01:00:00Z')`,
    ).run();
    const { items } = await s.list();
    expect(items).toHaveLength(1);
    expect(items[0]?.lastRun).toEqual({ status: 'succeeded', startedAt: '2026-11-20T01:00:00Z' });
    expect((db.prepare('SELECT count(*) AS n FROM skills').get() as { n: number }).n).toBe(1);
  });

  it('데이터 위치가 아직 없으면 E_OUT_OF_SCOPE', async () => {
    await expect(createSkills({ store: () => null, roots: () => roots, openPath }).list()).rejects.toMatchObject({
      code: 'E_OUT_OF_SCOPE',
    });
  });
});

describe('skills.get', () => {
  it('ssr·본문 요약·기억한 허용을 돌려주고 유효하지 않으면 E_VALIDATION, 없으면 E_NOT_FOUND', async () => {
    put('rich', good('rich', 'ssr:\n  inputs:\n    - name: topic\n      label: 주제\n      required: true\n  reads: [notes]\n  tools: [Read, Grep]\n'));
    put('broken', '# no frontmatter');
    db.prepare(`INSERT INTO grants (skill_name, folders_json, tools_json, created_at) VALUES ('rich', '[1,2]', '["Read"]', 'x')`).run();
    db.prepare(`INSERT INTO grants (skill_name, folders_json, tools_json, created_at, revoked_at) VALUES ('rich', '[9]', '[]', 'x', 'y')`).run();
    const s = skills();
    const detail = await s.get('rich');
    expect(detail).toMatchObject({
      name: 'rich',
      valid: true,
      bodySummary: '본문 rich',
      bodyTruncated: false,
      ssr: { inputs: [{ name: 'topic', label: '주제', required: true }], reads: ['notes'], tools: ['Read', 'Grep'] },
      grants: [{ folderIds: [1, 2], tools: ['Read'], lastUsedAt: null }],
    });
    await expect(s.get('broken')).rejects.toMatchObject({ code: 'E_VALIDATION' });
    await expect(s.get('nothing')).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });

  it('본문은 앞 1500자만 요약한다', async () => {
    put('long', `---\nname: long\n---\n${'가'.repeat(3000)}`);
    const d = await skills().get('long');
    expect(Array.from(d.bodySummary)).toHaveLength(1500);
    expect(d.bodyTruncated).toBe(true);
  });

  it('응답(목록·상세)에 절대 경로가 없다', async () => {
    put('p', good('p', 'ssr:\n  reads: [notes]\n'));
    const s = skills();
    const json = JSON.stringify([await s.list(), await s.get('p')]);
    expect(json).not.toContain(tmp);
    expect(json).not.toContain(os.tmpdir());
    expect(json).not.toMatch(/[A-Za-z]:[\\/]/);
    expect(json).not.toContain('SKILL.md');
  });
});

describe('skills.openFolder', () => {
  it('목록에 있는 스킬의 폴더만 연다(실제 경로로)', async () => {
    put('openme', good('openme'));
    const s = skills();
    await expect(s.openFolder(U('openme'))).rejects.toMatchObject({ code: 'E_NOT_FOUND' }); // 목록 전
    await s.list();
    await expect(s.openFolder(U('openme'))).resolves.toEqual({ opened: true });
    expect(openPath).toHaveBeenCalledWith(path.join(userDir, 'openme'));
    await expect(s.openFolder(U('unknown'))).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
    openPath.mockResolvedValueOnce('failed');
    await expect(s.openFolder(U('openme'))).resolves.toEqual({ opened: false });
  });

  it('유효하지 않은 스킬 폴더도 열 수 있다(고치기 위해)', async () => {
    put('broken', '# nothing');
    const s = skills();
    await s.list();
    await expect(s.openFolder(U('broken'))).resolves.toEqual({ opened: true });
  });

  it('오류·duplicate_name·shadowed 항목도 이름이 같은 다른 스킬이 아니라 자기 폴더가 열린다', async () => {
    put('a-first', good('dup'));
    put('b-copy', good('dup'));
    put('bad', '# nothing');
    put('same-user', good('same'), userDir);
    put('same-app', good('same'), appDir);
    roots = [
      { root: 'user', dir: userDir },
      { root: 'app', dir: appDir },
    ];
    const s = skills();
    await s.list();
    await s.openFolder(U('b-copy'));
    expect(openPath).toHaveBeenLastCalledWith(path.join(userDir, 'b-copy'));
    await s.openFolder(U('same-user'));
    expect(openPath).toHaveBeenLastCalledWith(path.join(userDir, 'same-user'));
    await s.openFolder({ root: 'app', folder: 'same-app' });
    expect(openPath).toHaveBeenLastCalledWith(path.join(appDir, 'same-app'));
    await s.openFolder(U('bad'));
    expect(openPath).toHaveBeenLastCalledWith(path.join(userDir, 'bad'));
    await expect(s.openFolder({ root: 'app', folder: 'bad' })).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });

  it('열기 직전 폴더가 junction으로 바뀌면 E_OUT_OF_SCOPE', async () => {
    put('swap', good('swap'));
    const outside = path.join(tmp, 'outside');
    mkdirSync(outside);
    const s = skills();
    await s.list();
    renameSync(path.join(userDir, 'swap'), path.join(tmp, 'moved'));
    symlinkSync(outside, path.join(userDir, 'swap'), 'junction');
    await expect(s.openFolder(U('swap'))).rejects.toMatchObject({ code: 'E_OUT_OF_SCOPE' });
    expect(openPath).not.toHaveBeenCalled();
  });

  it('스킬 루트가 다른 곳으로 바뀌었거나 등록에서 빠지면 E_OUT_OF_SCOPE', async () => {
    put('moved', good('moved'));
    const s = skills();
    await s.list();
    // 루트가 다른 위치로 향하게 됨: 저장된 경로의 부모와 현재 루트 실제 경로가 다르다.
    const other = path.join(tmp, 'other-skills');
    mkdirSync(other);
    roots = [{ root: 'user', dir: other }];
    await expect(s.openFolder(U('moved'))).rejects.toMatchObject({ code: 'E_OUT_OF_SCOPE' });
    // 등록된 스킬 폴더가 없음
    roots = [];
    await expect(s.openFolder(U('moved'))).rejects.toMatchObject({ code: 'E_OUT_OF_SCOPE' });
    expect(openPath).not.toHaveBeenCalled();
  });

  it('폴더가 사라졌으면 E_NOT_FOUND', async () => {
    put('gone', good('gone'));
    const s = skills();
    await s.list();
    rmSync(path.join(userDir, 'gone'), { recursive: true });
    await expect(s.openFolder(U('gone'))).rejects.toMatchObject({ code: 'E_NOT_FOUND' });
  });
});

describe('IPC 경유', () => {
  it('입력은 strict, 경로·알 수 없는 키는 E_VALIDATION이고 정상 호출은 ok', async () => {
    put('viaipc', good('viaipc'));
    const handler = createInvokeHandler({
      routes: createRoutes({
        envCheck: async () => ({}) as never,
        setDataDir: async () => ({ status: 'canceled' }),
        sources: {} as never,
        index: {} as never,
        brain: {} as never,
        skills: skills(),
      }),
      isTrustedUrl: createTrustedUrlCheck(),
    });
    const trusted = { senderFrame: { url: 'app://bundle/index.html', parent: null } };
    const bad = { ok: false, error: { code: 'E_VALIDATION' } };
    expect(await handler(trusted, 'skills.openFolder', { name: 'viaipc', path: 'C:\\' })).toEqual(bad);
    expect(await handler(trusted, 'skills.get', { name: '' })).toEqual(bad);
    expect(await handler(trusted, 'skills.list', undefined)).toMatchObject({ ok: true });
    expect(await handler(trusted, 'skills.get', { name: 'viaipc' })).toMatchObject({ ok: true });
    expect(await handler(trusted, 'skills.get', { name: 'zzz' })).toEqual({ ok: false, error: { code: 'E_NOT_FOUND' } });
    expect(await handler(trusted, 'skills.openFolder', { root: 'user', folder: 'viaipc' })).toEqual({ ok: true, data: { opened: true } });
  });
});
