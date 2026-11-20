// T-02 로그인 상태 확인(원격 호출 없음 확인용으로 프록시를 닿지 않는 주소로 둔다). 계정 식별자는 기록 전에 마스킹.
// 사용법: node t02-auth.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGDIR = path.join(HERE, '..', '..', '.nomad', 'logs', 'task-004');
const BIN = process.env.CLAUDE_BIN
  ?? path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const env = { ...process.env, DISABLE_AUTOUPDATER: '1', HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9' };

const t0 = Date.now();
const r = spawnSync(BIN, ['auth', 'status', '--json'], { env, encoding: 'utf8', timeout: 30_000, windowsHide: true });
let parsed = null; try { parsed = JSON.parse(r.stdout); } catch {}
const KEEP = ['loggedIn', 'authMethod', 'apiProvider', 'subscriptionType', 'loginExpiresAt'];
const out = {
  command: 'claude auth status --json', exit_code: r.status, duration_ms: Date.now() - t0, proxy_unreachable: true,
  keys_present: parsed ? Object.keys(parsed) : null,
  kept: parsed ? Object.fromEntries(KEEP.map((k) => [k, parsed[k]])) : null,
  masked: ['email', 'orgId', 'orgName'],
  stderr: (r.stderr ?? '').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>').slice(0, 500),
};
fs.mkdirSync(LOGDIR, { recursive: true });
fs.writeFileSync(path.join(LOGDIR, 't02-auth.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out));
