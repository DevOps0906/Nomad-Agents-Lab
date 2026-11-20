// 데이터 위치·연결 폴더 공통 경로 검사(task-018 계획 보완 "경로 검사").
// 판정은 realpath.native로 확정한 실제 경로로 한다(junction·8.3 이름 우회 차단).
// 장치·UNC 경로는 realpath가 일반 경로로 바꿔 버리므로(`\\?\D:\x` → `D:\x`) 원본 입력도 따로 검사한다.
import { realpathSync, statSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';

export type FolderRejection =
  | 'unresolvable'
  | 'network'
  | 'drive_root'
  | 'system'
  | 'too_broad'
  | 'sensitive'
  | 'overlap';

export interface FolderPolicyContext {
  readonly env: NodeJS.ProcessEnv;
  /** 사용자 홈 폴더(os.homedir()) */
  readonly home: string;
  /** 앱 userData 폴더 */
  readonly userData: string;
}

/** 환경 변수가 없거나 바뀌어도 항상 거부하는 시스템 폴더 기본값. */
const DEFAULT_SYSTEM_ROOTS = ['C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\ProgramData'];

/** 홈 아래 비밀·설정 폴더(연결 폴더 기준). 그 폴더 자체와 하위는 거부, 품는 상위 선택은 허용(색인 제외는 task-019). */
export const SENSITIVE_HOME_DIRS = ['.ssh', '.gnupg', '.claude', '.aws', '.azure', '.kube', '.docker', '.config'];

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

function stripTrailing(p: string): string {
  return /^[A-Za-z]:\\$/.test(p) ? p : p.replace(/[\\/]+$/, '');
}

/** 기준 폴더도 실제 경로로 맞춘다(없으면 정규화만). */
function canonical(p: string): string {
  try {
    return stripTrailing(realpathSync.native(p));
  } catch {
    return stripTrailing(path.resolve(p));
  }
}

const key = (p: string) => p.toLowerCase();

/** a가 b와 같거나 b 안에 있다(대소문자 무시). */
export function isSameOrInside(a: string, b: string): boolean {
  const ka = key(stripTrailing(a));
  const kb = key(stripTrailing(b));
  return ka === kb || ka.startsWith(kb.endsWith(path.sep) ? kb : kb + path.sep);
}

/** 어느 방향으로든 겹친다(같음·부모·자식). */
export function overlaps(a: string, b: string): boolean {
  return isSameOrInside(a, b) || isSameOrInside(b, a);
}

/** UNC·장치 경로: `\\server`, `\\?\`, `\\.\`, `//`, `\??\`(구분자 섞임 포함). */
export function isDeviceOrUncPath(p: string): boolean {
  return /^[\\/]{2}/.test(p) || /^[\\/]\?\?[\\/]/.test(p);
}

/** 실제 경로를 확정한다(fs.promises.realpath = realpath.native와 같은 OS 해석). 폴더가 아니거나 해석할 수 없으면 null. */
export async function resolveFolder(p: string): Promise<string | null> {
  try {
    const real = stripTrailing(await realpath(p));
    return statSync(real).isDirectory() ? real : null;
  } catch {
    return null;
  }
}

export interface BroadPathOptions {
  /** 연결 폴더 검사면 true: 홈 아래 비밀·설정 폴더도 거부 */
  readonly sensitive?: boolean;
}

/**
 * 광범위·시스템 경로 거부. real은 resolveFolder 결과여야 한다(원본 입력 검사는 checkFolder).
 * 거부: UNC·장치 경로, 드라이브 루트, %WINDIR%·Program Files 두 곳·%PROGRAMDATA%(환경 변수 + 고정 기본값)·
 * AppData 전체·userData(안쪽 포함), 홈 폴더 자체와 그 상위, userData의 상위, (연결 폴더) 홈 아래 비밀·설정 폴더.
 */
export function rejectBroadPath(real: string, ctx: FolderPolicyContext, options: BroadPathOptions = {}): FolderRejection | null {
  if (isDeviceOrUncPath(real)) return 'network';
  if (/^[A-Za-z]:[\\/]?$/.test(real)) return 'drive_root';
  const home = canonical(ctx.home);
  const userData = canonical(ctx.userData);
  const systemRoots = [
    ...DEFAULT_SYSTEM_ROOTS,
    envValue(ctx.env, 'WINDIR'),
    envValue(ctx.env, 'SystemRoot'),
    envValue(ctx.env, 'ProgramFiles'),
    envValue(ctx.env, 'ProgramFiles(x86)'),
    envValue(ctx.env, 'ProgramW6432'),
    envValue(ctx.env, 'ProgramData'),
    path.join(home, 'AppData'),
    userData,
  ].filter((r): r is string => typeof r === 'string' && r.length > 0);
  if (systemRoots.some((root) => isSameOrInside(real, canonical(root)))) return 'system';
  if (isSameOrInside(home, real) || isSameOrInside(userData, real)) return 'too_broad';
  if (options.sensitive && SENSITIVE_HOME_DIRS.some((d) => isSameOrInside(real, canonical(path.join(home, d))))) {
    return 'sensitive';
  }
  return null;
}

/** 원본 입력 검사 → 실제 경로 확정 → 광범위 경로 검사. 통과하면 실제 경로. */
export async function checkFolder(
  input: string,
  ctx: FolderPolicyContext,
  options: BroadPathOptions = {},
): Promise<{ readonly real: string } | { readonly rejected: FolderRejection }> {
  if (isDeviceOrUncPath(input)) return { rejected: 'network' };
  const real = await resolveFolder(input);
  if (!real) return { rejected: 'unresolvable' };
  const rejected = rejectBroadPath(real, ctx, options);
  return rejected ? { rejected } : { real };
}
