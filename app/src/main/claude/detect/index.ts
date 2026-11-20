// Claude Code 설치·버전·로그인 점검(A-01, 근거 docs/02_ARCHITECTURE.md §3.1 T-02).
// 셸 없이 고정 인자만 실행한다. CLI 출력 원문(email·orgId 등)은 결과·로그·오류에 넣지 않는다.
import { type ChildProcess, spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import type { ClaudeState, ClaudeStatus } from '../../../shared/ipc';

/** task-004에서 검증한 버전이 하한이다. */
export const MIN_CLAUDE_VERSION = '2.1.323';
export const CHECK_TIMEOUT_MS = 10_000;
const STDOUT_LIMIT = 64 * 1024;

/** 실행 파일 + 고정 앞 인자(Node로 cli.js를 직접 실행할 때만 쓴다). */
export interface Launcher {
  readonly file: string;
  readonly prefixArgs: readonly string[];
}

type Version = readonly [number, number, number];

export function parseVersion(text: string): Version | null {
  const m = /^\s*(\d{1,9})\.(\d{1,9})\.(\d{1,9})(?:\s|$)/.exec(text);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 숫자 단위 비교(문자열 비교 금지: 2.1.4 < 2.1.323). 해석 실패는 호출자가 unsupported로 처리한다. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key];
}

/** PATH 중 절대경로 항목만(상대경로·cwd 탐색 금지, Windows는 드라이브 문자 경로만). */
function pathDirs(env: NodeJS.ProcessEnv): string[] {
  const raw = envValue(env, 'PATH') ?? '';
  return raw
    .split(path.delimiter)
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => (process.platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(d) : path.isAbsolute(d)));
}

export function findOnPath(env: NodeJS.ProcessEnv, name: string): string | null {
  for (const dir of pathDirs(env)) {
    const file = path.join(dir, name);
    if (isFile(file)) return file;
  }
  return null;
}

/**
 * 후보를 절대경로로 확정한다. PATH 각 항목에서
 * 1) `claude.exe` → 직접 실행
 * 2) npm 심(`claude.cmd`) → cmd.exe를 거치지 않고 심이 가리키는 패키지 안 `bin/claude.exe`,
 *    없으면 `cli.js`를 PATH의 `node.exe`로 직접 실행. 둘 다 없으면 그 심은 쓰지 않는다.
 */
export function findClaude(env: NodeJS.ProcessEnv): Launcher | null {
  for (const dir of pathDirs(env)) {
    const exe = path.join(dir, 'claude.exe');
    if (isFile(exe)) return { file: exe, prefixArgs: [] };
    if (!isFile(path.join(dir, 'claude.cmd'))) continue;
    const pkg = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code');
    const native = path.join(pkg, 'bin', 'claude.exe');
    if (isFile(native)) return { file: native, prefixArgs: [] };
    const cli = path.join(pkg, 'cli.js');
    const node = findOnPath(env, 'node.exe');
    if (isFile(cli) && node) return { file: node, prefixArgs: [cli] };
  }
  return null;
}

interface RunResult {
  readonly spawnFailed: boolean;
  readonly timedOut: boolean;
  readonly code: number | null;
  readonly stdout: string;
}

export interface CheckOptions {
  readonly launcher: Launcher | null;
  /** 실행 cwd. 앱 소유 폴더(userData)로 고정한다. */
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs?: number;
}

function killTree(child: ChildProcess, env: NodeJS.ProcessEnv): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // 환경 변수는 형식이 맞을 때만 쓰고, 아니면 고정 경로.
    const fromEnv = envValue(env, 'SystemRoot');
    const systemRoot = fromEnv && /^[A-Za-z]:\\Windows$/i.test(fromEnv) ? fromEnv : 'C:\\Windows';
    const killer = spawn(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => child.kill());
  } else {
    child.kill('SIGKILL');
  }
}

function run(launcher: Launcher, args: readonly string[], options: CheckOptions): Promise<RunResult> {
  const env = { ...options.env, DISABLE_AUTOUPDATER: '1' };
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let stdout = '';
    const finish = (result: Omit<RunResult, 'timedOut' | 'stdout'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, timedOut, stdout });
    };
    const child = spawn(launcher.file, [...launcher.prefixArgs, ...args], {
      cwd: options.cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (stdout.length < STDOUT_LIMIT) stdout += chunk;
    });
    // stderr는 읽어서 버린다(계정 정보가 섞일 수 있어 보관하지 않음).
    child.stderr?.resume();
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, options.env);
      // 종료 이벤트가 오지 않아도 결과는 낸다.
      setTimeout(() => finish({ spawnFailed: false, code: null }), 3_000).unref();
    }, options.timeoutMs ?? CHECK_TIMEOUT_MS);
    child.on('error', () => finish({ spawnFailed: true, code: null }));
    child.on('close', (code) => finish({ spawnFailed: false, code }));
  });
}

const AUTH_METHOD = /^[A-Za-z0-9_.-]{1,40}$/;

/** 미설치·미로그인·지원 범위 밖은 오류가 아니라 상태 값이다. */
export async function checkClaude(options: CheckOptions): Promise<ClaudeStatus> {
  const { launcher } = options;
  if (!launcher) return { claude: 'missing', version: null, authMethod: null };
  const v = await run(launcher, ['--version'], options);
  if (v.spawnFailed) return { claude: 'missing', version: null, authMethod: null };
  const parsed = !v.timedOut && v.code === 0 ? parseVersion(v.stdout) : null;
  if (!parsed) return { claude: 'unsupported', version: null, authMethod: null };
  const version = parsed.join('.');
  const min = parseVersion(MIN_CLAUDE_VERSION) as Version;
  if (compareVersions(parsed, min) < 0) return { claude: 'unsupported', version, authMethod: null };

  const a = await run(launcher, ['auth', 'status', '--json'], options);
  let state: ClaudeState = 'logged_out';
  let authMethod: string | null = null;
  if (!a.timedOut && a.code === 0) {
    try {
      const json: unknown = JSON.parse(a.stdout);
      if (json && typeof json === 'object' && (json as { loggedIn?: unknown }).loggedIn === true) {
        state = 'ok';
        const method = (json as { authMethod?: unknown }).authMethod;
        authMethod = typeof method === 'string' && AUTH_METHOD.test(method) ? method : null;
      }
    } catch {
      // 파싱 실패는 logged_out
    }
  }
  return { claude: state, version, authMethod };
}

/** 진행 중 재요청은 같은 결과를 공유한다. */
export function createClaudeChecker(options: () => CheckOptions): () => Promise<ClaudeStatus> {
  let inFlight: Promise<ClaudeStatus> | null = null;
  return () => {
    inFlight ??= checkClaude(options()).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
