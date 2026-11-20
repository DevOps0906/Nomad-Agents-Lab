// stream-json에 --verbose가 필수인지 원격 호출 없이 확인(ANTHROPIC_BASE_URL을 닿지 않는 주소로).
// 사용법: node verbose-check.mjs → .nomad/logs/task-004/verbose-check.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGDIR = path.join(HERE, '..', '..', '.nomad', 'logs', 'task-004');
const BIN = process.env.CLAUDE_BIN
  ?? path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE(CODE|_CODE_|_PID|_EFFORT)/.test(k)));
Object.assign(env, { DISABLE_AUTOUPDATER: '1', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', API_TIMEOUT_MS: '3000', CLAUDE_CODE_MAX_RETRIES: '0' });
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 't004-verbose-'));
const base = ['-p', '--output-format', 'stream-json', '--setting-sources', '', '--strict-mcp-config', '--tools', 'Read',
  '--model', 'haiku', '--max-turns', '1', '--no-session-persistence'];
const run = (extra) => {
  const r = spawnSync(BIN, [...base, ...extra], { cwd, env, input: 'Reply OK.', encoding: 'utf8', timeout: 60_000, windowsHide: true });
  const lines = (r.stdout ?? '').trim().split('\n').filter(Boolean);
  return { args: extra, exit_code: r.status, stderr: (r.stderr ?? '').trim().slice(0, 300),
    first_event: lines[0] ? (() => { try { const e = JSON.parse(lines[0]); return `${e.type}/${e.subtype ?? ''}`; } catch { return lines[0].slice(0, 200); } })() : null,
    api_error_seen: /ECONNREFUSED|Connection refused/.test(r.stdout ?? '') };
};
const out = { cli_version: spawnSync(BIN, ['--version'], { encoding: 'utf8', env }).stdout.trim(), remote_model_call: false,
  without_verbose: run([]), with_verbose: run(['--verbose']) };
fs.rmSync(cwd, { recursive: true, force: true });
fs.writeFileSync(path.join(LOGDIR, 'verbose-check.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
