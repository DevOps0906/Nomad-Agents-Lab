// 스킬 목록·상세·폴더 열기(A-07·A-08, ADR-0002). 원본은 SKILL.md 파일이고 SQLite `skills`는 색인 캐시다.
// 스킬 폴더는 읽기 전용: 링크·junction은 따라가지 않고, 1단계 하위 폴더의 SKILL.md만 읽는다. 응답에 절대 경로를 넣지 않는다.
import { createHash } from 'node:crypto';
import { type Dirent, promises as fsp } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { parse } from 'yaml';
import { z } from 'zod';
import type {
  OpenExternalResult,
  SkillDetail,
  SkillErrorCode,
  SkillGrant,
  SkillItem,
  SkillLastRun,
  SkillRoot,
  SkillRootStatus,
  SkillSsr,
  SkillsListResult,
} from '../../shared/ipc';
import { isExcludedName } from '../indexer/walk';
import { IpcError } from '../ipc/router';

/** SKILL.md 파일 상한(바이트) */
export const SKILL_FILE_MAX_BYTES = 1024 * 1024;
/** frontmatter 상한(바이트) */
export const FRONTMATTER_MAX_BYTES = 64 * 1024;
/** YAML 별칭(anchor 참조) 상한: 넘으면 파서가 중단한다(자원 고갈 방지). */
export const YAML_MAX_ALIAS_COUNT = 10;
export const BODY_SUMMARY_CHARS = 1500;
const DESCRIPTION_MAX_CHARS = 2000;
const NAME_MAX_CHARS = 100;
const SKILL_FILE = 'SKILL.md';

export interface SkillRootDir {
  readonly root: SkillRoot;
  readonly dir: string;
}

export interface SkillsDeps {
  /** ready가 아니면 null(데이터 위치 지정 전) */
  store(): { db: Database.Database } | null;
  /** 등록된 스킬 폴더. 같은 name 충돌은 앱 폴더가 사용자 폴더보다 우선한다(PRD Q12). */
  roots(): readonly SkillRootDir[];
  /** electron `shell.openPath`. 성공이면 빈 문자열. */
  openPath(file: string): Promise<string>;
  now?: () => Date;
  log?: (message: string) => void;
}

// ---- ssr 스키마(ADR-0002: 앱 전용 확장은 frontmatter `ssr:` 아래에만) ----
const InputSchema = z.object({
  name: z.string().min(1).max(64),
  label: z.string().max(100).optional(),
  required: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

const SsrSchema = z.object({
  inputs: z
    .array(InputSchema)
    .max(20)
    .refine((list) => new Set(list.map((i) => i.name)).size === list.length)
    .default([]),
  reads: z.array(z.string().min(1).max(260)).max(20).default([]),
  tools: z.array(z.string().min(1).max(64)).max(30).default([]),
});

interface Parsed {
  name: string | null;
  description: string;
  ssr: SkillSsr | null;
  body: string;
  error: SkillErrorCode | null;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 첫 줄 `---` ~ 다음 `---` 줄 사이를 frontmatter로, 그 뒤를 본문으로 나눈다. 없으면 null. */
function splitFrontmatter(text: string): { front: string; body: string } | null {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lineEnd = (from: number) => {
    const i = src.indexOf('\n', from);
    return i === -1 ? src.length : i;
  };
  const isFence = (line: string) => line.replace(/\r$/, '').trimEnd() === '---';
  if (!isFence(src.slice(0, lineEnd(0)))) return null;
  let pos = lineEnd(0) + 1;
  while (pos <= src.length) {
    const end = lineEnd(pos);
    if (isFence(src.slice(pos, end))) {
      return { front: src.slice(lineEnd(0) + 1, pos), body: src.slice(Math.min(end + 1, src.length)) };
    }
    if (end >= src.length) break;
    pos = end + 1;
  }
  return null;
}

/** 순수 파싱. 실패는 사유 코드만 돌려준다(원문 오류·경로 없음). */
export function parseSkillMarkdown(text: string): Parsed {
  const fail = (error: SkillErrorCode, name: string | null = null): Parsed => ({
    name,
    description: '',
    ssr: null,
    body: '',
    error,
  });
  const parts = splitFrontmatter(text);
  if (!parts) return fail('no_frontmatter');
  if (Buffer.byteLength(parts.front, 'utf8') > FRONTMATTER_MAX_BYTES) return fail('frontmatter_too_large');
  let data: unknown;
  try {
    // 커스텀 태그 없음(core 스키마), 별칭 수 제한, 중복 키 거부. 경고는 끄되 오류는 던지게 한다.
    data = parse(parts.front, { schema: 'core', maxAliasCount: YAML_MAX_ALIAS_COUNT, uniqueKeys: true, logLevel: 'error' });
  } catch (error) {
    return fail(/excessive alias count/i.test((error as Error).message) ? 'alias_limit' : 'yaml_error');
  }
  if (!isPlainObject(data)) return fail('frontmatter_not_object');
  const rawName = data['name'];
  if (rawName === undefined || rawName === null || rawName === '') return fail('name_missing');
  // eslint-disable-next-line no-control-regex
  if (typeof rawName !== 'string' || rawName.trim() === '' || rawName.length > NAME_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(rawName)) {
    return fail('name_invalid');
  }
  const name = rawName.trim();
  const description = typeof data['description'] === 'string' ? data['description'].trim().slice(0, DESCRIPTION_MAX_CHARS) : '';
  let ssr: SkillSsr | null = null;
  const rawSsr = data['ssr'];
  if (rawSsr !== undefined && rawSsr !== null) {
    const checked = SsrSchema.safeParse(rawSsr);
    if (!checked.success) return { name, description, ssr: null, body: '', error: 'ssr_invalid' };
    ssr = checked.data;
  }
  return { name, description, ssr, body: parts.body, error: null };
}

interface Entry {
  readonly name: string;
  readonly folder: string;
  readonly root: SkillRoot;
  /** 내부 전용(응답 금지) */
  readonly abs: string;
  description: string;
  ssr: SkillSsr | null;
  bodySummary: string;
  bodyTruncated: boolean;
  hash: string;
  mtime: number;
  valid: boolean;
  error: SkillErrorCode | null;
}

interface RootScan {
  readonly root: SkillRoot;
  readonly status: SkillRootStatus;
  readonly entries: Entry[];
}

const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
const realpathOf = async (p: string) => (await fsp.realpath(p)).replace(/(?<!^[A-Za-z]:)[\\/]+$/, '');
const isGone = (error: unknown) => (error as { code?: string }).code === 'ENOENT';
const byFolder = (a: Dirent, b: Dirent) => {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** 연 핸들에서 일반 파일인지 다시 확인하고 상한까지만 읽는다(루프). */
async function readLimited(file: string): Promise<Buffer | 'too_large' | 'not_file'> {
  const handle = await fsp.open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) return 'not_file';
    const buf = Buffer.alloc(SKILL_FILE_MAX_BYTES + 1);
    let total = 0;
    while (total < buf.length) {
      const { bytesRead } = await handle.read(buf, total, buf.length - total, total);
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    return total > SKILL_FILE_MAX_BYTES ? 'too_large' : buf.subarray(0, total);
  } finally {
    await handle.close();
  }
}

function summarize(body: string): { text: string; truncated: boolean } {
  const trimmed = body.trim();
  const chars = Array.from(trimmed.slice(0, BODY_SUMMARY_CHARS * 2));
  return { text: chars.slice(0, BODY_SUMMARY_CHARS).join(''), truncated: chars.length > BODY_SUMMARY_CHARS };
}

async function readEntry(root: SkillRoot, realRoot: string, dirent: Dirent): Promise<Entry | null> {
  const folder = dirent.name;
  const abs = path.join(realRoot, folder);
  const broken = (error: SkillErrorCode, mtime = 0): Entry => ({
    name: folder,
    folder,
    root,
    abs,
    description: '',
    ssr: null,
    bodySummary: '',
    bodyTruncated: false,
    hash: '',
    mtime,
    valid: false,
    error,
  });
  try {
    // 폴더 자체가 링크·junction이면 따라가지 않는다(목록에서 제외).
    const dirStat = await fsp.lstat(abs);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return null;
    const file = path.join(abs, SKILL_FILE);
    let st;
    try {
      st = await fsp.lstat(file);
    } catch (error) {
      if (isGone(error)) return null; // SKILL.md가 없으면 스킬이 아니다
      throw error;
    }
    const mtime = Math.floor(st.mtimeMs);
    if (st.isSymbolicLink() || !st.isFile()) return broken('not_file', mtime);
    if (st.size > SKILL_FILE_MAX_BYTES) return broken('too_large', mtime);
    const bytes = await readLimited(file);
    if (bytes === 'too_large' || bytes === 'not_file') return broken(bytes, mtime);
    const parsed = parseSkillMarkdown(bytes.toString('utf8'));
    const summary = summarize(parsed.body);
    return {
      name: parsed.name ?? folder,
      folder,
      root,
      abs,
      description: parsed.description,
      ssr: parsed.ssr,
      bodySummary: summary.text,
      bodyTruncated: summary.truncated,
      hash: createHash('sha256').update(bytes).digest('hex'),
      mtime,
      valid: parsed.error === null,
      error: parsed.error,
    };
  } catch {
    return broken('read_failed');
  }
}

async function scanRoot(spec: SkillRootDir): Promise<{ scan: RootScan; real: string | null }> {
  let real: string;
  let dirents: Dirent[];
  try {
    real = await realpathOf(spec.dir);
    dirents = await fsp.readdir(real, { withFileTypes: true });
  } catch (error) {
    return { scan: { root: spec.root, status: isGone(error) ? 'missing' : 'unreadable', entries: [] }, real: null };
  }
  const entries: Entry[] = [];
  for (const dirent of dirents.filter((d) => !isExcludedName(d.name) && !d.isSymbolicLink() && d.isDirectory()).sort(byFolder)) {
    const entry = await readEntry(spec.root, real, dirent);
    if (entry) entries.push(entry);
  }
  return { scan: { root: spec.root, status: 'ok', entries }, real };
}

/** 이름 충돌(Q12): 앱 > 사용자(roots 순서), 같은 폴더 안은 폴더 이름순 첫 번째만 유효. 유효한 항목만 이름을 차지한다. */
function resolveNames(scans: RootScan[]): void {
  const taken = new Map<string, SkillRoot>();
  for (const scan of scans) {
    for (const entry of scan.entries) {
      if (!entry.valid) continue;
      const owner = taken.get(entry.name);
      if (owner === undefined) {
        taken.set(entry.name, entry.root);
        continue;
      }
      entry.valid = false;
      entry.error = owner === entry.root ? 'duplicate_name' : 'shadowed';
    }
  }
}

interface Row {
  root: SkillRoot;
  path: string;
  valid: number;
}

const safeJson = <T>(text: string, pick: (v: unknown) => T[]): T[] => {
  try {
    return pick(JSON.parse(text));
  } catch {
    return [];
  }
};

export function createSkills(deps: SkillsDeps) {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const requireDb = () => {
    const store = deps.store();
    if (!store) throw new IpcError('E_OUT_OF_SCOPE');
    return store.db;
  };
  const orderedRoots = () => [...deps.roots()].sort((a, b) => (a.root === b.root ? 0 : a.root === 'app' ? -1 : 1));

  /** 스킬 폴더를 읽고 SQLite 캐시를 맞춘다(없어진 폴더 행 삭제). 읽지 못한 루트의 기존 행은 유지한다. */
  async function scan(db: Database.Database): Promise<RootScan[]> {
    const specs = orderedRoots();
    const scans: RootScan[] = [];
    for (const spec of specs) scans.push((await scanRoot(spec)).scan);
    resolveNames(scans);
    const stamp = now().toISOString();
    const upsert = db.prepare(
      `INSERT INTO skills (name, root, path, description, ssr_json, content_hash, mtime, valid, error, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET name = excluded.name, root = excluded.root, description = excluded.description,
         ssr_json = excluded.ssr_json, content_hash = excluded.content_hash, mtime = excluded.mtime,
         valid = excluded.valid, error = excluded.error, scanned_at = excluded.scanned_at`,
    );
    db.transaction(() => {
      for (const s of scans) {
        if (s.status === 'unreadable') continue;
        const keep = new Set(s.entries.map((e) => key(e.abs)));
        const existing = db.prepare('SELECT id, path FROM skills WHERE root = ?').all(s.root) as { id: number; path: string }[];
        for (const row of existing) if (!keep.has(key(row.path))) db.prepare('DELETE FROM skills WHERE id = ?').run(row.id);
        for (const e of s.entries) {
          upsert.run(
            e.name,
            e.root,
            e.abs,
            e.description,
            e.ssr ? JSON.stringify(e.ssr) : null,
            e.hash,
            e.mtime,
            e.valid ? 1 : 0,
            e.error,
            stamp,
          );
        }
      }
    })();
    return scans;
  }

  function lastRunOf(db: Database.Database, name: string): SkillLastRun | null {
    const row = db
      .prepare('SELECT status, started_at FROM runs WHERE skill_name = ? ORDER BY started_at DESC, id DESC LIMIT 1')
      .get(name) as { status: string; started_at: string } | undefined;
    return row ? { status: row.status, startedAt: row.started_at } : null;
  }

  function toItem(db: Database.Database, e: Entry): SkillItem {
    return {
      name: e.name,
      folder: e.folder,
      description: e.description,
      root: e.root,
      valid: e.valid,
      error: e.error,
      mtime: e.mtime,
      lastRun: e.valid ? lastRunOf(db, e.name) : null,
    };
  }

  async function list(input?: { query?: string | undefined }): Promise<SkillsListResult> {
    const db = requireDb();
    const scans = await scan(db);
    const needle = input?.query?.trim().toLowerCase() ?? '';
    const items = scans
      .flatMap((s) => s.entries)
      .filter(
        (e) =>
          needle === '' ||
          e.name.toLowerCase().includes(needle) ||
          e.folder.toLowerCase().includes(needle) ||
          e.description.toLowerCase().includes(needle),
      )
      .map((e) => toItem(db, e));
    log(`skills.list items=${items.length}`);
    return { items, roots: scans.map((s) => ({ root: s.root, status: s.status })) };
  }

  /** 이름이 같으면 유효한 항목을 우선한다. 유효하지 않은 항목은 E_VALIDATION(사유는 목록의 error). */
  async function get(name: string): Promise<SkillDetail> {
    const db = requireDb();
    const entries = (await scan(db)).flatMap((s) => s.entries).filter((e) => e.name === name);
    const entry = entries.find((e) => e.valid) ?? entries[0];
    if (!entry) throw new IpcError('E_NOT_FOUND');
    if (!entry.valid) throw new IpcError('E_VALIDATION');
    const grants = (
      db
        .prepare('SELECT id, folders_json, tools_json, last_used_at FROM grants WHERE skill_name = ? AND revoked_at IS NULL ORDER BY id')
        .all(name) as { id: number; folders_json: string; tools_json: string; last_used_at: string | null }[]
    ).map(
      (g): SkillGrant => ({
        grantId: g.id,
        folderIds: safeJson(g.folders_json, (v) => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [])),
        tools: safeJson(g.tools_json, (v) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])),
        lastUsedAt: g.last_used_at,
      }),
    );
    return {
      ...toItem(db, entry),
      bodySummary: entry.bodySummary,
      bodyTruncated: entry.bodyTruncated,
      ssr: entry.ssr,
      grants,
    };
  }

  /**
   * 마지막 목록이 색인한 항목(root+folder)의 폴더만, 열기 직전 realpath·lstat을 다시 확인해 등록된 스킬 폴더의 직접 하위일 때만 연다.
   * 이 확인과 shell.openPath 사이의 짧은 교체 창(TOCTOU)은 남는다.
   */
  async function openFolder(input: { root: SkillRoot; folder: string }): Promise<OpenExternalResult> {
    const db = requireDb();
    const rows = db.prepare('SELECT root, path, valid FROM skills WHERE root = ?').all(input.root) as Row[];
    const row = rows.find((r) => key(path.basename(r.path)) === key(input.folder));
    if (!row) throw new IpcError('E_NOT_FOUND');
    const spec = deps.roots().find((r) => r.root === row.root);
    if (!spec) throw new IpcError('E_OUT_OF_SCOPE');
    let realRoot: string;
    let realDir: string;
    try {
      realRoot = await realpathOf(spec.dir);
      realDir = await realpathOf(row.path);
      const st = await fsp.lstat(realDir);
      if (st.isSymbolicLink() || !st.isDirectory()) throw new IpcError('E_OUT_OF_SCOPE');
    } catch (error) {
      if (error instanceof IpcError) throw error;
      throw new IpcError(isGone(error) ? 'E_NOT_FOUND' : 'E_OUT_OF_SCOPE');
    }
    // 저장 경로가 realpath와 같고(폴더 자체가 링크로 바뀌지 않음), 부모가 등록된 스킬 폴더의 실제 경로와 같을 때만.
    if (key(realDir) !== key(row.path) || key(path.dirname(realDir)) !== key(realRoot)) {
      throw new IpcError('E_OUT_OF_SCOPE');
    }
    const failure = await deps.openPath(realDir);
    log(`skills.openFolder ${failure === '' ? 'opened' : 'failed'}`);
    return { opened: failure === '' };
  }

  return { list, get, openFolder };
}
