// task-012 1단계: 로컬 HTTP MCP 권한 브리지(http-host.mjs)로 claude -p를 실행해 ①~⑥을 재검증한다.
// 사용법: node http-run.mjs <scenario>
//   init     (원격 없음) ④ init 도구·mcp_servers, CLI가 보내는 HTTP 요청 모양
//   badtoken (원격 없음) ③ 설정에 틀린 토큰 → 401일 때 CLI가 OAuth 탐색(/.well-known·/register)을 하는지
//   multi    (원격 1) ①allow·deny·updatedInput ⑤병렬 권한 요청 ⑥--tools 허용 목록에서 Write가 브리지 경유
//   delay    (원격 1) ② 응답을 HOLD_MS(기본 310000) 늦춤, MCP_TOOL_TIMEOUT 미설정
//   pread    (원격 1) ⑤ 승인 폴더 밖 Read 3개를 한 메시지에서 병렬로 → 브리지 요청이 겹쳐 오는지(동시성 안전 도구)
//   (env) RUN_MCP_TOOL_TIMEOUT=<ms>: 앱이 의도적으로 MCP_TOOL_TIMEOUT을 넣는 대체안 검증. RUN_SERVER_TIMEOUT=<ms>: mcp-config 서버 항목의 "timeout". RUN_TAG: 로그 파일 이름 접미사
//   badwrite (원격 1) ③ 보강: 틀린 토큰으로 브리지가 failed인 채 Write를 시키면 CLI가 어떻게 하는지
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startBridgeServer } from './http-host.mjs';
import { checkPath, pathFieldOf } from './pathguard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOGDIR = path.join(HERE, '..', '..', '.nomad', 'logs', 'task-012');
const REMOTE_MAX = 10;
const CLAUDE_BIN = process.env.CLAUDE_BIN
  ?? path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
const scenario = process.argv[2];
const OFFLINE = new Set(['init', 'badtoken']);
if (!['init', 'badtoken', 'multi', 'delay', 'pread', 'badwrite'].includes(scenario)) { console.error('usage: node http-run.mjs <init|badtoken|multi|delay|pread|badwrite>'); process.exit(2); }
const HOLD_MS = Number(process.env.HOLD_MS) > 0 ? Number(process.env.HOLD_MS) : 310_000;
fs.mkdirSync(LOGDIR, { recursive: true });

const home = os.homedir();
const mask = (s) => s
  .replaceAll('Users-' + os.userInfo().username + '-', 'Users-<user>-')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
  .replaceAll(JSON.stringify(home).slice(1, -1), '~').replaceAll(home, '~').replaceAll(home.replaceAll('\\', '/'), '~')
  .replace(/("(?:orgId|organization_uuid|organizationUuid|account_uuid|accountUuid|orgName)"\s*:\s*")[^"]*"/g, '$1<masked>"');

// 원격 실행 상한: 슬롯 파일 1..10을 'wx'로 원자적으로 잡아야 실행
function claimRemoteSlot() {
  const dir = path.join(LOGDIR, 'remote-slots'); fs.mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= REMOTE_MAX; n++) try { fs.writeFileSync(path.join(dir, String(n)), String(process.pid), { flag: 'wx' }); return n; } catch {}
  return 0;
}

// ---- 격리 폴더(저장소 밖 %TEMP%) ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), `t012-${scenario}-`));
const ws = path.join(root, 'ws'); const out = path.join(ws, 'output_folder'); const extra = path.join(root, 'extra');
const outside = path.join(root, 'outside');
for (const d of [out, extra, outside]) fs.mkdirSync(d, { recursive: true });
for (const n of [1, 2, 3]) fs.writeFileSync(path.join(outside, `r${n}.txt`), `outside ${n}\n`);
const projDir = path.join(home, '.claude', 'projects');
const projBefore = new Set(fs.existsSync(projDir) ? fs.readdirSync(projDir) : []);

// ---- 결정(앱 Main 대역) ----
const t0 = Date.now();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function decide(args) {
  if (scenario === 'pread') { await wait(4000); return { behavior: 'deny', message: 'outside approved folders' }; }
  const field = pathFieldOf(args.tool_name);
  if (!field) return { behavior: 'deny', message: `tool ${args.tool_name} not allowed` };
  const g = checkPath(out, args.input[field], ws);
  if (!g.ok) return { behavior: 'deny', message: `path ${g.reason}` };
  if (scenario === 'delay') { await wait(HOLD_MS); return { behavior: 'allow', updatedInput: args.input }; }
  await wait(4000); // 병렬 판정용: 요청이 겹쳐 들어오는지 본다
  const name = path.basename(args.input[field]);
  if (name === 'a-deny.txt') return { behavior: 'deny', message: 'denied by host' };
  if (name === 'c-orig.txt') return { behavior: 'allow', updatedInput: { ...args.input, [field]: path.join(out, 'c-rewritten.txt') } };
  return { behavior: 'allow', updatedInput: args.input };
}
const httpLog = [];
const srv = await startBridgeServer({ decide, timeoutMs: scenario === 'delay' ? HOLD_MS + 90_000 : 300_000,
  log: (r) => httpLog.push({ ...r, t_ms: r.t_ms, wall_ms: Date.now() - t0 }) });

// ---- mcp-config: 실행 폴더의 파일(토큰은 argv에 없음), 실행 후 폴더째 삭제 ----
const mcpConfig = path.join(root, 'mcp-config.json');
const sentToken = scenario === 'badtoken' || scenario === 'badwrite' ? '0'.repeat(64) : srv.token;
fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { ssrbridge: { type: 'http', url: srv.url,
  headers: { Authorization: `Bearer ${sentToken}` },
  ...(process.env.RUN_SERVER_TIMEOUT ? { timeout: Number(process.env.RUN_SERVER_TIMEOUT) } : {}) } } }), { mode: 0o600 });

const PROMPTS = {
  multi: [
    'In ONE single assistant message, issue THREE Write tool calls in parallel (all three tool_use blocks in the same message), each with content "x":',
    path.join(out, 'a-deny.txt'), path.join(out, 'b-allow.txt'), path.join(out, 'c-orig.txt'),
    'Some may be denied; do not retry and use no other tool. Then reply DONE.',
  ].join('\n'),
  pread: [
    'In ONE single assistant message, issue THREE Read tool calls in parallel (all three tool_use blocks in the same message):',
    ...[1, 2, 3].map((n) => path.join(outside, `r${n}.txt`)),
    'Some may be denied; do not retry and use no other tool. Then reply DONE.',
  ].join('\n'),
  badwrite: `Use the Write tool to create the file ${path.join(out, 'bad.txt')} with the content "x". Use no other tool. If denied, do not retry. Then reply DONE.`,
  delay: `Use the Write tool to create the file ${path.join(out, 'delay.txt')} with the content "x". Use no other tool. If denied, do not retry. Then reply DONE.`,
};
const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--max-turns', '4',
  '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', mcpConfig,
  '--permission-prompt-tool', 'mcp__ssrbridge__permission_prompt', '--tools', 'Read,Grep,Glob,Write,Edit', '--add-dir', extra];

// env 허용 목록(task-012 계획 보완) + NO_PROXY 덮어쓰기. MCP_TOOL_TIMEOUT·MCP_TIMEOUT·NODE_OPTIONS·기타 CLAUDE_CODE_* 제외
const ALLOW = /^(HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SystemRoot|WINDIR|TEMP|TMP|PATH|PATHEXT|ComSpec|CLAUDE_CONFIG_DIR|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|AWS_.*|GOOGLE_.*|CLOUD_ML_REGION|HTTPS?_PROXY|NODE_EXTRA_CA_CERTS)$/i;
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ALLOW.test(k)));
Object.assign(env, { NO_PROXY: '127.0.0.1,localhost', DISABLE_AUTOUPDATER: '1' });
if (process.env.RUN_MCP_TOOL_TIMEOUT) env.MCP_TOOL_TIMEOUT = process.env.RUN_MCP_TOOL_TIMEOUT;
const tag = process.env.RUN_TAG ? `${scenario}-${process.env.RUN_TAG}` : scenario;
if (OFFLINE.has(scenario)) Object.assign(env, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', API_TIMEOUT_MS: '3000', CLAUDE_CODE_MAX_RETRIES: '0' });
else {
  const slot = claimRemoteSlot();
  if (!slot) { console.error('remote cap reached'); await srv.close(); fs.rmSync(root, { recursive: true, force: true }); process.exit(3); }
  fs.appendFileSync(path.join(LOGDIR, 'remote-count.log'), `${new Date().toISOString()} ${tag} slot=${slot}\n`);
}

const streamOut = fs.createWriteStream(path.join(LOGDIR, `${tag}.stream.jsonl`));
const child = spawn(CLAUDE_BIN, args, { cwd: ws, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
child.stdin.end(PROMPTS[scenario] ?? 'Reply OK.');
let init = null, result = null, stderr = '', lineBuf = '';
const toolUses = [];
child.stdout.on('data', (d) => {
  lineBuf += d; let i;
  while ((i = lineBuf.indexOf('\n')) >= 0) {
    const line = lineBuf.slice(0, i); lineBuf = lineBuf.slice(i + 1);
    if (!line.trim()) continue;
    streamOut.write(mask(line) + '\n');
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') init = ev;
    if (ev.type === 'result') result = ev;
    for (const c of Array.isArray(ev.message?.content) ? ev.message.content : []) {
      if (c.type === 'tool_use') toolUses.push({ t_ms: Date.now() - t0, msg_id: ev.message.id, id: c.id, name: c.name, input: c.input });
      if (c.type === 'tool_result') { const u = toolUses.find((t) => t.id === c.tool_use_id);
        if (u) Object.assign(u, { t_result_ms: Date.now() - t0, is_error: !!c.is_error, result_head: (typeof c.content === 'string' ? c.content : JSON.stringify(c.content)).slice(0, 200) }); }
    }
  }
});
child.stderr.on('data', (d) => { stderr += d; });
const killer = setTimeout(() => child.kill(), scenario === 'delay' ? HOLD_MS + 120_000 : 180_000);
const code = await new Promise((r) => child.on('close', r));
clearTimeout(killer); streamOut.end();
await srv.close();

// 병렬 판정: tools/call 요청 구간이 겹치는지
const calls = httpLog.filter((r) => r.rpc === 'tools/call' && !r.event);
const overlap = calls.some((a) => calls.some((b) => a !== b && a.t_ms < b.t_ms && b.t_ms < a.t_res_ms));
const projAfter = fs.existsSync(projDir) ? fs.readdirSync(projDir) : [];
const summary = {
  scenario, cli: '2.1.323(DISABLE_AUTOUPDATER)', exit_code: code, duration_ms: Date.now() - t0,
  server_timeout: process.env.RUN_SERVER_TIMEOUT ?? null,
  argv: args.map((a) => (a === mcpConfig ? '<mcp-config file: ssrbridge http only, token redacted>' : a)),
  env_keys: Object.keys(env).sort(),
  init: init && { model: init.model, permissionMode: init.permissionMode, apiKeySource: init.apiKeySource,
    claude_code_version: init.claude_code_version, mcp_servers: init.mcp_servers, tools: init.tools },
  http_requests: httpLog.map(({ request, ...r }) => ({ ...r, request_input: request?.input })),
  tools_call_overlap: overlap,
  tool_uses: toolUses,
  fs: { output_folder: fs.readdirSync(out), extra: fs.readdirSync(extra) },
  result: result && { subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns,
    total_cost_usd: result.total_cost_usd, result: String(result.result ?? '').slice(0, 500), permission_denials: result.permission_denials },
  claude_projects_new: projAfter.filter((p) => !projBefore.has(p)),
  stderr: stderr.slice(0, 2000),
};
fs.writeFileSync(path.join(LOGDIR, `${tag}.summary.json`), mask(JSON.stringify(summary, null, 2)));
console.log(mask(JSON.stringify({ scenario, exit: code, ms: summary.duration_ms, mcp: summary.init?.mcp_servers, tools: summary.init?.tools,
  http: httpLog.map((r) => [r.t_ms, r.method, r.url, r.status, r.rpc ?? r.reject ?? r.event ?? '', r.decision?.behavior ?? '']),
  overlap, fs: summary.fs.output_folder, result: summary.result?.subtype, cost: summary.result?.total_cost_usd, newProj: summary.claude_projects_new })));
fs.rmSync(root, { recursive: true, force: true });
