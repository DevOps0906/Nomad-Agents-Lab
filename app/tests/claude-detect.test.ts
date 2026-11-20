// A-01 Claude Code 점검. 실제 CLI 대신 가짜 CLI(Node 스크립트)를 셸 없이 실행한다. 임시 폴더만 쓴다.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { devOverrides } from '../src/main/boot/devOverrides';
import {
  type CheckOptions,
  type Launcher,
  checkClaude,
  compareVersions,
  createClaudeChecker,
  findClaude,
  parseVersion,
} from '../src/main/claude/detect';
import { createInvokeHandler } from '../src/main/ipc/router';
import { createRoutes } from '../src/main/ipc/routes';
import { createTrustedUrlCheck } from '../src/main/security';

const SECRETS = ['secret.user@example.com', 'org-SECRET-4242', 'Secret Org'];

const FAKE_CLI = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const mode = process.env.FAKE_MODE || 'ok';
const args = process.argv.slice(2).join(' ');
const SECRET = { email: '${SECRETS[0]}', orgId: '${SECRETS[1]}', orgName: '${SECRETS[2]}' };
if (process.env.FAKE_CWD_FILE) fs.writeFileSync(process.env.FAKE_CWD_FILE, process.cwd());
if (args === '--version') {
  if (mode === 'hang') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(process.env.FAKE_PID_FILE, JSON.stringify([process.pid, child.pid]));
    setInterval(() => {}, 1000);
  } else {
    const v = { old: '2.1.4 (Claude Code)', garbage: 'Claude Code dev', newer: '2.10.0 (Claude Code)' }[mode];
    process.stdout.write((v || '2.1.323 (Claude Code)') + '\\n');
  }
} else if (args === 'auth status --json') {
  process.stderr.write('debug ' + SECRET.email + ' ' + SECRET.orgId + '\\n');
  if (mode === 'logged_out') {
    process.stdout.write(JSON.stringify({ loggedIn: false }));
    process.exitCode = 1;
  } else if (mode === 'exit1') {
    process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', ...SECRET }));
    process.exitCode = 1;
  } else if (mode === 'badjson') {
    process.stdout.write('{"loggedIn": true, ' + SECRET.email);
  } else {
    process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', ...SECRET }));
  }
} else {
  process.exitCode = 2;
}
`;

let root: string;
let cwd: string;
let fake: Launcher;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'ssr-claude-'));
  cwd = path.join(root, 'userData');
  mkdirSync(cwd);
  const script = path.join(root, 'fake-claude.cjs');
  writeFileSync(script, FAKE_CLI);
  fake = { file: process.execPath, prefixArgs: [script] };
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

const options = (mode: string, extra: Partial<CheckOptions> = {}): CheckOptions => ({
  launcher: fake,
  cwd,
  env: { ...process.env, FAKE_MODE: mode },
  ...extra,
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('버전 비교', () => {
  it('숫자 단위로 비교한다(2.1.4 < 2.1.323 < 2.10.0)', () => {
    const v = (s: string) => parseVersion(s) as NonNullable<ReturnType<typeof parseVersion>>;
    expect(compareVersions(v('2.1.4'), v('2.1.323'))).toBeLessThan(0);
    expect(compareVersions(v('2.1.323'), v('2.1.323'))).toBe(0);
    expect(compareVersions(v('2.10.0'), v('2.1.323'))).toBeGreaterThan(0);
    expect(compareVersions(v('3.0.0'), v('2.99.999'))).toBeGreaterThan(0);
  });

  it('해석 실패는 null', () => {
    expect(parseVersion('2.1.323 (Claude Code)')).toEqual([2, 1, 323]);
    for (const s of ['', 'Claude Code dev', 'v2.1.3', '2.1', '2.1.x', '2.1.323beta']) expect(parseVersion(s)).toBeNull();
  });
});

describe('env.check 상태 4종(가짜 CLI)', () => {
  it('정상: ok + 버전 + 인증 방식 종류만', async () => {
    await expect(checkClaude(options('ok'))).resolves.toEqual({ claude: 'ok', version: '2.1.323', authMethod: 'claude.ai' });
    await expect(checkClaude(options('newer'))).resolves.toMatchObject({ claude: 'ok', version: '2.10.0' });
  });

  it('미설치: 후보 없음·실행 파일 없음 → missing', async () => {
    await expect(checkClaude({ ...options('ok'), launcher: null })).resolves.toEqual({
      claude: 'missing',
      version: null,
      authMethod: null,
    });
    const gone = { file: path.join(root, 'nope', 'claude.exe'), prefixArgs: [] };
    await expect(checkClaude({ ...options('ok'), launcher: gone })).resolves.toMatchObject({ claude: 'missing' });
  });

  it('미로그인: loggedIn=false·종료 코드≠0·파싱 실패 → logged_out', async () => {
    for (const mode of ['logged_out', 'exit1', 'badjson']) {
      await expect(checkClaude(options(mode))).resolves.toEqual({
        claude: 'logged_out',
        version: '2.1.323',
        authMethod: null,
      });
    }
  });

  it('지원 범위 밖: 하한 미만·버전 해석 실패 → unsupported', async () => {
    await expect(checkClaude(options('old'))).resolves.toEqual({ claude: 'unsupported', version: '2.1.4', authMethod: null });
    await expect(checkClaude(options('garbage'))).resolves.toEqual({
      claude: 'unsupported',
      version: null,
      authMethod: null,
    });
  });

  it('실행 cwd는 지정한 앱 소유 폴더다', async () => {
    const cwdFile = path.join(root, 'cwd.txt');
    await checkClaude(options('ok', { env: { ...process.env, FAKE_MODE: 'ok', FAKE_CWD_FILE: cwdFile } }));
    expect(readFileSync(cwdFile, 'utf8').toLowerCase()).toBe(cwd.toLowerCase());
  });
});

describe('시간 초과·동시 요청', () => {
  it('시간 초과면 프로세스 트리를 종료하고 unsupported', async () => {
    const pidFile = path.join(root, 'pids.json');
    const started = Date.now();
    const result = await checkClaude(
      options('hang', { env: { ...process.env, FAKE_MODE: 'hang', FAKE_PID_FILE: pidFile }, timeoutMs: 1_000 }),
    );
    expect(result).toEqual({ claude: 'unsupported', version: null, authMethod: null });
    expect(Date.now() - started).toBeLessThan(5_000);
    const pids = JSON.parse(readFileSync(pidFile, 'utf8')) as number[];
    for (let i = 0; i < 40 && pids.some(alive); i += 1) await new Promise((r) => setTimeout(r, 50));
    expect(pids.map(alive)).toEqual([false, false]);
  }, 15_000);

  it('진행 중 재요청은 같은 결과를 공유한다', async () => {
    const check = createClaudeChecker(() => options('ok'));
    const a = check();
    const b = check();
    expect(a).toBe(b);
    await a;
    const c = check();
    expect(c).not.toBe(a);
    await c;
  });
});

describe('계정 정보 비노출', () => {
  it('응답·오류·로그에 email·orgId·stdout·stderr가 없다', async () => {
    const consoleCalls: unknown[] = [];
    for (const m of ['log', 'error', 'warn', 'info'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => consoleCalls.push(args));
    }
    const log = vi.fn();
    const handler = createInvokeHandler({
      routes: createRoutes({
        envCheck: async () => ({
          ...(await checkClaude(options('ok'))),
          minVersion: '2.1.323',
          dataDir: 'unset',
          bootError: null,
        }),
        setDataDir: async () => ({ status: 'canceled' }),
        sources: { list: () => [], add: async () => ({ source: null }), remove: () => ({}) },
        index: {
          preview: async () => ({ targets: 0, excluded: 0, tooLarge: 0, reason: null }),
          start: () => ({ jobIds: [] }),
          status: () => ({ running: false, jobs: [], failures: [] }),
        },
        brain: {} as never,
      }),
      isTrustedUrl: createTrustedUrlCheck(),
      log,
    });
    const trusted = { senderFrame: { url: 'app://bundle/index.html', parent: null } };
    const outputs = [
      await handler(trusted, 'env.check', undefined),
      await checkClaude(options('exit1')),
      await checkClaude(options('badjson')),
    ];
    const text = JSON.stringify([outputs, log.mock.calls, consoleCalls]);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toContain('debug');
    expect(outputs[0]).toEqual({
      ok: true,
      data: { claude: 'ok', version: '2.1.323', authMethod: 'claude.ai', minVersion: '2.1.323', dataDir: 'unset', bootError: null },
    });
  });
});

describe('후보 탐색(절대경로만, 셸 없음)', () => {
  const touch = (file: string) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
  };

  it('PATH 항목의 claude.exe를 그대로 쓴다', () => {
    const empty = path.join(root, 'empty');
    const bin = path.join(root, 'bin');
    mkdirSync(empty);
    touch(path.join(bin, 'claude.exe'));
    expect(findClaude({ PATH: [empty, bin].join(path.delimiter) })).toEqual({
      file: path.join(bin, 'claude.exe'),
      prefixArgs: [],
    });
  });

  it('npm 심(claude.cmd)은 cmd.exe 없이 패키지 안 실행 파일 또는 cli.js+node.exe로 푼다', () => {
    const npm = path.join(root, 'npm');
    touch(path.join(npm, 'claude.cmd'));
    expect(findClaude({ PATH: npm })).toBeNull();
    const cli = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    touch(cli);
    const nodeDir = path.join(root, 'nodejs');
    touch(path.join(nodeDir, 'node.exe'));
    expect(findClaude({ Path: [npm, nodeDir].join(path.delimiter) })).toEqual({
      file: path.join(nodeDir, 'node.exe'),
      prefixArgs: [cli],
    });
    const native = path.join(npm, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    touch(native);
    expect(findClaude({ PATH: npm })).toEqual({ file: native, prefixArgs: [] });
  });

  it('상대경로·빈 PATH 항목은 탐색하지 않는다(cwd 탐색 금지)', () => {
    expect(findClaude({ PATH: ['.', 'bin', '', '\\rooted'].join(path.delimiter) })).toBeNull();
    expect(findClaude({})).toBeNull();
  });
});

describe('개발용 대체(가짜 CLI·대화상자)', () => {
  const env = { SSR_FAKE_CLAUDE: 'C:\\fake\\claude.cjs', SSR_FAKE_PICK_DIR: 'C:\\fake\\dir' };

  it('패키지 모드에서는 무시된다', () => {
    expect(devOverrides(true, env, 'C:\\node\\node.exe')).toEqual({});
  });

  it('패키지 안 된 실행에서만 켜지고, 상대경로는 무시한다', () => {
    expect(devOverrides(false, env, 'C:\\node\\node.exe')).toEqual({
      claude: { file: 'C:\\node\\node.exe', prefixArgs: ['C:\\fake\\claude.cjs'] },
      pickDir: 'C:\\fake\\dir',
    });
    expect(devOverrides(false, { SSR_FAKE_CLAUDE: 'claude.exe', SSR_FAKE_PICK_DIR: 'dir' }, null)).toEqual({});
  });
});
