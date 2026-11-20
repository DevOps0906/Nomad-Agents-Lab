// 연결 폴더 읽기 전용 순회. 심볼릭 링크·junction은 따라가지 않고 제외한다(밖 이탈·순환 방지).
// 하드링크는 일반 파일과 구별할 수 없어 잔여 위험으로 남긴다(docs/04_API.md A-03).
import { type Dirent, promises as fsp } from 'node:fs';
import path from 'node:path';
import { DOC_EXT } from './parse';

export interface WalkFile {
  /** `/` 구분 소스 기준 경로 */
  readonly rel: string;
  readonly abs: string;
  readonly size: number;
  /** epoch 밀리초 정수 */
  readonly mtime: number;
}

export interface WalkResult {
  readonly files: WalkFile[];
  /** 기본 제외 규칙으로 뺀 항목 수(폴더·파일·링크) */
  readonly excluded: number;
  /** 읽지 못한 폴더·파일(사라짐 ENOENT 제외)의 소스 기준 경로. 하나라도 있으면 불완전 순회(삭제 처리 금지). */
  readonly unreadable: string[];
  /** 중단 요청으로 멈췄으면 true */
  readonly aborted: boolean;
}

/**
 * 기본 제외: 점으로 시작(민감 폴더 `.ssh`·`.gnupg`·`.claude`·`.aws`·`.azure`·`.kube`·`.docker`·`.config` 포함,
 * 위치 무관), `$`로 시작, `System Volume Information`, `node_modules`. Windows 숨김·시스템 속성은 보지 않는다.
 */
export function isExcludedName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    name.startsWith('.') || name.startsWith('$') || lower === 'system volume information' || lower === 'node_modules'
  );
}

const isGone = (error: unknown) => (error as { code?: string }).code === 'ENOENT';

export interface WalkOptions {
  /** 데이터 위치 폴더의 실제 경로(realpath). 같은 폴더를 만나면 제외. */
  readonly dataDirReal?: string;
  /** 중단 요청이면 true. 폴더 사이마다 확인한다. */
  readonly aborted?: () => boolean;
  /** 테스트용 fs 대체(오류 주입) */
  readonly fs?: Pick<typeof fsp, 'readdir' | 'lstat'>;
}

/** root는 realpath로 확정된 소스 루트. root 자체를 읽지 못하면 예외. */
export async function walkSource(root: string, options: WalkOptions = {}): Promise<WalkResult> {
  const fs = options.fs ?? fsp;
  const dataKey = options.dataDirReal?.toLowerCase();
  const files: WalkFile[] = [];
  const unreadable: string[] = [];
  let excluded = 0;
  const stack: string[] = [''];
  while (stack.length > 0) {
    if (options.aborted?.()) return { files, excluded, unreadable, aborted: true };
    const relDir = stack.pop() as string;
    const absDir = relDir ? path.join(root, ...relDir.split('/')) : root;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch (error) {
      if (!relDir) throw error;
      if (!isGone(error)) unreadable.push(relDir);
      continue;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      if (isExcludedName(entry.name) || entry.isSymbolicLink()) {
        excluded += 1;
        continue;
      }
      if (!entry.isDirectory() && !(entry.isFile() && DOC_EXT.test(entry.name))) continue;
      let st;
      try {
        st = await fs.lstat(abs);
      } catch (error) {
        // 순회 중 사라진 항목만 "보지 못한 것"으로 둔다. 권한 오류 등은 불완전 순회로 기록한다.
        if (!isGone(error)) unreadable.push(rel);
        continue;
      }
      if (st.isSymbolicLink()) {
        excluded += 1;
      } else if (st.isDirectory()) {
        if (dataKey && abs.toLowerCase() === dataKey) excluded += 1;
        else stack.push(rel);
      } else if (st.isFile()) {
        files.push({ rel, abs, size: st.size, mtime: Math.floor(st.mtimeMs) });
      }
    }
  }
  return { files, excluded, unreadable, aborted: false };
}
