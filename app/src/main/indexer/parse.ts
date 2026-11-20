// Markdown 본문 해석: 인코딩 판정, 제목, 링크·위키링크·태그 추출 (task-019 계획 보완 "링크·태그").
// 원본은 읽기만 한다. 파서 규칙을 바꾸면 PARSER_VERSION을 올려 기존 문서를 다시 처리하게 한다.
// 신뢰하지 않는 입력이므로 역추적 정규식을 쓰지 않고 줄 단위 선형 스캐너로 읽는다(ReDoS 방지).
import path from 'node:path';

/** documents.parser_version과 비교한다. 다르면 내용이 같아도 다시 처리한다. */
export const PARSER_VERSION = 2;

/** 색인 대상 Markdown 확장자 */
export const DOC_EXT = /\.(md|markdown)$/i;

/** 이 길이를 넘는 줄은 링크·태그·제목 추출을 건너뛴다(본문 검색에는 그대로 들어간다). */
export const MAX_LINE_CHARS = 4096;
/** 문서당 저장 상한. 넘는 것은 버리고 truncated로 표시한다. */
export const MAX_LINKS_PER_DOC = 1000;
export const MAX_TAGS_PER_DOC = 100;
/** Markdown 링크 대상 최대 길이(넘으면 링크로 보지 않는다) */
const MAX_DEST_CHARS = 1024;

/** 링크 대상으로 인정하는 확장자. 확장자가 없으면 `.md`로 합친다. `.pdf`는 키만 저장(PDF 색인 후 해석). */
const LINK_EXT = new Set(['.md', '.markdown', '.pdf']);
/** 위키 임베드에 흔한 첨부 파일(문서가 아니므로 관계로 저장하지 않는다) */
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|ico|avif|mp3|wav|ogg|m4a|flac|mp4|webm|mov|mkv|zip|canvas)$/i;

/** 바이너리 판정 범위(앞 8KB에 NUL이 있으면 바이너리) */
const SNIFF_BYTES = 8 * 1024;

export type DecodeResult = { readonly text: string } | { readonly error: 'binary' };

/** UTF-8(BOM 제거), UTF-16 LE/BE(BOM 있을 때). UTF-8은 BOM 유무와 관계없이 앞 8KB NUL이면 바이너리. 잘못된 UTF-8 바이트는 대체 문자. */
export function decodeText(buf: Uint8Array): DecodeResult {
  if (buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le', { ignoreBOM: true }).decode(buf.subarray(2)) };
  }
  if (buf[0] === 0xfe && buf[1] === 0xff) {
    const body = buf.subarray(2, buf.length - ((buf.length - 2) % 2));
    const swapped = new Uint8Array(body.length);
    for (let i = 0; i + 1 < body.length; i += 2) {
      swapped[i] = body[i + 1] as number;
      swapped[i + 1] = body[i] as number;
    }
    return { text: new TextDecoder('utf-16le', { ignoreBOM: true }).decode(swapped) };
  }
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = bom ? buf.subarray(3) : buf;
  if (body.subarray(0, SNIFF_BYTES).includes(0)) return { error: 'binary' };
  return { text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(body) };
}

export interface ParsedLink {
  /** 원래 링크 문자열(괄호·대괄호 안 그대로) */
  readonly raw: string;
  /** 정규화 대상 키: `p:<소스 기준 경로>`(Markdown 링크) · `w:<이름 또는 경로>`(위키링크) · `x:<원문>`(소스 밖, 해석 안 함) */
  readonly key: string;
}

export interface ParsedTag {
  readonly name: string;
  readonly origin: 'frontmatter' | 'inline';
}

export interface ParsedDoc {
  readonly title: string;
  readonly links: ParsedLink[];
  readonly tags: ParsedTag[];
  /** 링크·태그 상한을 넘겨 일부를 버렸으면 true */
  readonly truncated: boolean;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ASCII_PUNCT = /[!-/:-@[-`{-~]/;
const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

/** 앞 `---` ~ 다음 `---`/`...` 사이 줄. 없으면 null. */
function splitFrontmatter(lines: string[]): { fm: string[]; bodyStart: number } | null {
  if ((lines[0] ?? '').trimEnd() !== '---') return null;
  for (let i = 1; i < lines.length; i += 1) {
    const line = (lines[i] as string).trimEnd();
    if (line === '---' || line === '...') return { fm: lines.slice(1, i), bodyStart: i + 1 };
  }
  return null;
}

function cleanTag(value: string): string {
  let v = value.trim();
  if (v.startsWith('"') || v.startsWith("'")) v = v.slice(1);
  if (v.endsWith('"') || v.endsWith("'")) v = v.slice(0, -1);
  v = v.trim();
  if (v.startsWith('#')) v = v.slice(1);
  return v.toLowerCase();
}

/** frontmatter `tags:`는 `[a, b]`와 `- a` 목록 두 형식만 손으로 읽는다(YAML 라이브러리 없음). */
export function frontmatterTags(fm: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < fm.length; i += 1) {
    const line = fm[i] as string;
    if (line.length > MAX_LINE_CHARS || !/^tags\s*:/i.test(line)) continue;
    const value = line.slice(line.indexOf(':') + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      out.push(...value.slice(1, -1).split(',').map(cleanTag));
    } else if (value === '') {
      for (let j = i + 1; j < fm.length; j += 1) {
        const item = (fm[j] as string).trimStart();
        if (!item.startsWith('- ') || (fm[j] as string).length > MAX_LINE_CHARS) break;
        out.push(cleanTag(item.slice(2)));
      }
    }
  }
  return out.filter(Boolean);
}

const isBlank = (line: string) => line.trim() === '';
const isIndentedCode = (line: string) => line.startsWith('    ') || line.startsWith('\t');

/**
 * 코드 줄은 비운다: 펜스(``` · ~~~, 0~3칸 들여쓰기) 안, 그리고 빈 줄(또는 문서 처음) 뒤에 이어지는
 * 4칸·탭 들여쓰기 줄(들여쓴 코드 블록). 인라인 코드는 공백으로 바꾼다.
 */
function stripCode(lines: string[]): string[] {
  let fence: string | null = null;
  let indented = false;
  let prevBlank = true;
  return lines.map((line) => {
    const blank = isBlank(line);
    const m = line.length <= MAX_LINE_CHARS ? FENCE.exec(line) : null;
    let out: string;
    if (fence) {
      const marker = m?.[1];
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      out = '';
    } else if (m) {
      fence = m[1] as string;
      out = '';
    } else if (!blank && isIndentedCode(line) && (indented || prevBlank)) {
      indented = true;
      out = '';
    } else {
      if (!blank) indented = false;
      out = line.length <= MAX_LINE_CHARS ? blankInlineCode(line) : line;
    }
    prevBlank = blank;
    return out;
  });
}

/** 인라인 코드(같은 길이 백틱 쌍 사이)를 공백으로 바꾼다. 백틱 줄 길이별 대기열로 선형 처리. */
export function blankInlineCode(line: string): string {
  if (!line.includes('`')) return line;
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < line.length; ) {
    if (line[i] !== '`') {
      i += 1;
      continue;
    }
    const start = i;
    while (line[i] === '`') i += 1;
    runs.push({ start, end: i });
  }
  const byLen = new Map<number, number[]>();
  runs.forEach((r, idx) => {
    const len = r.end - r.start;
    const list = byLen.get(len);
    if (list) list.push(idx);
    else byLen.set(len, [idx]);
  });
  const heads = new Map<number, number>();
  const chars = line.split('');
  let i = 0;
  while (i < runs.length) {
    const r = runs[i] as { start: number; end: number };
    const len = r.end - r.start;
    const list = byLen.get(len) as number[];
    let h = heads.get(len) ?? 0;
    while (h < list.length && (list[h] as number) <= i) h += 1;
    heads.set(len, h);
    if (h >= list.length) {
      i += 1;
      continue;
    }
    const j = list[h] as number;
    const close = runs[j] as { start: number; end: number };
    for (let k = r.start; k < close.end; k += 1) chars[k] = ' ';
    i = j + 1;
  }
  return chars.join('');
}

function normalizeKeyPath(p: string): string {
  return path.posix.normalize(p.replace(/\\/g, '/')).replace(/^(\.\/)+/, '').toLowerCase();
}

/** 확장자가 없거나 문서 확장자가 아니면 `.md`를 붙인다. 첨부 파일이면 null. */
function withDocExt(p: string): string | null {
  if (ASSET_EXT.test(p)) return null;
  const ext = path.posix.extname(p).toLowerCase();
  return LINK_EXT.has(ext) ? p : `${p}.md`;
}

function wikiKey(inner: string): string | null {
  // 표 안의 `[[a\|별칭]]`처럼 `|` 앞 역슬래시는 이스케이프로 본다.
  let target = inner.split('|')[0] as string;
  if (target.endsWith('\\')) target = target.slice(0, -1);
  target = (target.split('#')[0] ?? '').trim();
  if (!target) return null;
  const withExt = withDocExt(target.replace(/\\/g, '/').replace(/^\/+/, ''));
  if (!withExt) return null;
  return `w:${normalizeKeyPath(withExt)}`;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** `\(`처럼 ASCII 구두점 앞 역슬래시만 이스케이프로 푼다(`sub\c.md`의 역슬래시는 구분자로 남긴다). */
function unescapePunct(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i] as string;
    const next = s[i + 1];
    if (c === '\\' && next !== undefined && ASCII_PUNCT.test(next)) {
      out += next;
      i += 1;
    } else {
      out += c;
    }
  }
  return out;
}

function mdLinkKey(dest: string, srcRel: string): string | null {
  let target = dest;
  if (!target || target.startsWith('#') || target.startsWith('//') || SCHEME.test(target)) return null;
  target = safeDecode((target.split('#')[0] ?? '').split('?')[0] ?? '').replace(/\\/g, '/');
  if (!target) return null;
  const ext = path.posix.extname(target).toLowerCase();
  if (ext && !LINK_EXT.has(ext)) return null;
  if (!ext) target = `${target}.md`;
  const joined = target.startsWith('/')
    ? target.replace(/^\/+/, '')
    : path.posix.join(path.posix.dirname(srcRel), target);
  const norm = normalizeKeyPath(joined);
  if (norm === '..' || norm.startsWith('../')) return `x:${normalizeKeyPath(target)}`;
  return `p:${norm}`;
}

/** 링크 키가 문서 자신을 가리키는지(자기 자신 링크는 저장하지 않는다). */
export function isSelfKey(key: string, srcRel: string): boolean {
  const self = srcRel.toLowerCase();
  if (key.startsWith('p:')) return key.slice(2) === self;
  if (key.startsWith('w:')) {
    const name = key.slice(2);
    // 위키링크는 같은 폴더를 먼저 고른다: 이름(경로 꼬리)이 자신과 같으면 자신으로 해석된다.
    return self === name || self.endsWith(`/${name}`);
  }
  return false;
}

/** `[[...]]` 내용 목록과, 위키링크를 공백으로 바꾼 줄. `]]`가 더 없으면 멈추므로 선형. */
function scanWiki(line: string): { inners: string[]; rest: string } {
  const inners: string[] = [];
  let rest = '';
  let pos = 0;
  for (;;) {
    const open = line.indexOf('[[', pos);
    if (open < 0) break;
    const close = line.indexOf(']]', open + 2);
    if (close < 0) break;
    const inner = line.slice(open + 2, close);
    const nested = inner.lastIndexOf('[[');
    if (nested >= 0) {
      // `[[a [[b]]`: 가장 안쪽 `[[`부터 본다
      rest += line.slice(pos, open + 2 + nested);
      pos = open + 2 + nested;
      continue;
    }
    if (inner && !inner.includes(']')) inners.push(inner);
    rest += line.slice(pos, open) + ' '.repeat(close + 2 - open);
    pos = close + 2;
  }
  return { inners, rest: rest + line.slice(pos) };
}

/** 링크 대상(`(` 다음부터): `<...>` 또는 괄호 균형·역슬래시 이스케이프를 지키며 공백 전까지. 끝 위치와 대상, 실패면 null. */
function scanDest(line: string, from: number): { dest: string; end: number } | null {
  let i = from;
  while (isSpace(line[i])) i += 1;
  let dest: string;
  if (line[i] === '<') {
    const close = line.indexOf('>', i + 1);
    if (close < 0 || close - i > MAX_DEST_CHARS) return null;
    dest = line.slice(i + 1, close);
    i = close + 1;
  } else {
    const start = i;
    let depth = 0;
    for (; i < line.length && i - start <= MAX_DEST_CHARS; i += 1) {
      const c = line[i];
      if (c === '\\' && i + 1 < line.length) {
        i += 1;
      } else if (c === '(') {
        depth += 1;
      } else if (c === ')') {
        if (depth === 0) break;
        depth -= 1;
      } else if (isSpace(c)) {
        break;
      }
    }
    if (i - start > MAX_DEST_CHARS) return null;
    dest = unescapePunct(line.slice(start, i));
  }
  while (isSpace(line[i])) i += 1;
  const q = line[i];
  if (q === '"' || q === "'" || q === '(') {
    const closer = q === '(' ? ')' : q;
    const close = line.indexOf(closer, i + 1);
    if (close < 0 || close - i > MAX_DEST_CHARS) return null;
    i = close + 1;
    while (isSpace(line[i])) i += 1;
  }
  return line[i] === ')' ? { dest, end: i } : null;
}

/** `[라벨](대상)`의 대상 목록. 대괄호 짝은 스택 한 번으로 맞춘다(중첩 라벨·이스케이프 처리). */
function scanMdLinks(line: string): string[] {
  const opens: number[] = [];
  const pairs: [number, number][] = [];
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '\\') {
      i += 1;
    } else if (c === '[') {
      opens.push(i);
    } else if (c === ']') {
      const open = opens.pop();
      if (open !== undefined) pairs.push([open, i]);
    }
  }
  const dests: string[] = [];
  let consumedTo = -1;
  for (const [open, close] of pairs.sort((a, b) => a[0] - b[0])) {
    if (open < consumedTo || line[close + 1] !== '(') continue;
    const found = scanDest(line, close + 2);
    if (!found) continue;
    dests.push(found.dest);
    consumedTo = found.end;
  }
  return dests;
}

/** 공백·줄 처음 뒤 `#` + 영문·한글로 시작하는 태그 */
function scanInlineTags(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/(?:^|\s)#([A-Za-zㄱ-ㆎ가-힣][\p{L}\p{N}_\-/]*)/gu)) {
    let name = m[1] as string;
    while (name.endsWith('/')) name = name.slice(0, -1);
    if (name) out.push(name.toLowerCase());
  }
  return out;
}

/** `# 제목` → 제목(닫는 `#` 제거). 정규식 없이 앞뒤를 잘라낸다. */
function atxH1(line: string): string | null {
  let i = 0;
  while (i < 3 && line[i] === ' ') i += 1;
  if (line[i] !== '#' || !isSpace(line[i + 1])) return null;
  let text = line.slice(i + 1).trim();
  let end = text.length;
  while (end > 0 && text[end - 1] === '#') end -= 1;
  if (end < text.length && (end === 0 || isSpace(text[end - 1]))) text = text.slice(0, end).trim();
  return text || null;
}

/** 본문에서 제목·링크·태그를 뽑는다. srcRel은 `/` 구분 소스 기준 경로. */
export function parseMarkdown(text: string, srcRel: string): ParsedDoc {
  const lines = text.split(/\r\n|\n|\r/);
  const front = splitFrontmatter(lines);
  const body = stripCode(front ? lines.slice(front.bodyStart) : lines);
  let truncated = false;

  const tags = new Map<string, ParsedTag>();
  const addTag = (name: string, origin: ParsedTag['origin']) => {
    if (tags.has(name)) return;
    if (tags.size >= MAX_TAGS_PER_DOC) truncated = true;
    else tags.set(name, { name, origin });
  };
  for (const name of front ? frontmatterTags(front.fm) : []) addTag(name, 'frontmatter');

  const links = new Map<string, ParsedLink>();
  const addLink = (raw: string, key: string | null) => {
    if (!key || links.has(key) || isSelfKey(key, srcRel)) return;
    if (links.size >= MAX_LINKS_PER_DOC) truncated = true;
    else links.set(key, { raw, key });
  };

  let title: string | null = null;
  for (const line of body) {
    if (line.length > MAX_LINE_CHARS) continue;
    if (title === null) title = atxH1(line);
    const { inners, rest } = scanWiki(line);
    for (const inner of inners) addLink(inner, wikiKey(inner));
    for (const dest of scanMdLinks(rest)) addLink(dest, mdLinkKey(dest, srcRel));
    for (const name of scanInlineTags(rest)) addTag(name, 'inline');
  }

  const stem = path.posix.basename(srcRel).replace(DOC_EXT, '');
  return { title: title || stem, links: [...links.values()], tags: [...tags.values()], truncated };
}
