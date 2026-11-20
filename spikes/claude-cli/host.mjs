// 앱 Main 대역: 격리 폴더 준비 → named pipe(무작위 이름+토큰) 열기 → claude 실행 → 브리지 질의에 정책대로 답 → 결과 기록.
// 사용법: node host.mjs <scenario> <A|B> [--offline]
//   scenario: init | control | deny | allow | rewrite | paths | delay | tools
//   A = --setting-sources ""(사용자·프로젝트 설정 끔), B = 기본값
//   --offline: ANTHROPIC_BASE_URL을 닿지 않는 주소로 바꿔 원격 모델 호출 없이 init 이벤트만 본다.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPath, pathFieldOf } from './pathguard.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LOGDIR = path.join(REPO, '.nomad', 'logs', 'task-004');
const REMOTE_MAX = 15;
const CLAUDE_BIN = process.env.CLAUDE_BIN
  ?? path.join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');

const [scenario, cond = 'A', ...flags] = process.argv.slice(2);
const offline = flags.includes('--offline') || scenario === 'init' || scenario === 'control';
if (!scenario || !['A', 'B'].includes(cond)) { console.error('usage: node host.mjs <scenario> <A|B> [--offline]'); process.exit(2); }
fs.mkdirSync(LOGDIR, { recursive: true });

export const mask = (s) => s
  .replaceAll('Users-' + os.userInfo().username + '-', 'Users-<user>-')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
  .replaceAll(JSON.stringify(os.homedir()).slice(1, -1), '~').replaceAll(os.homedir(), '~').replaceAll(os.homedir().replaceAll('\\', '/'), '~')
  .replace(/("(?:orgId|organization_uuid|organizationUuid|account_uuid|accountUuid|orgName)"\s*:\s*")[^"]*"/g, '$1<masked>"');

// 원격 실행 상한(계획 6번)
const countFile = path.join(LOGDIR, 'remote-count.log');
// 원자적 확인: 슬롯 파일 1..15 중 하나를 'wx'(이미 있으면 실패)로 잡아야 실행한다. 동시에 시작해도 같은 슬롯은 한 프로세스만 얻는다.
const slotDir = path.join(LOGDIR, 'remote-slots');
function claimRemoteSlot() {
  fs.mkdirSync(slotDir, { recursive: true });
  const logged = fs.existsSync(countFile) ? fs.readFileSync(countFile, 'utf8').trim().split('\n').filter(Boolean).length : 0;
  for (let n = 1; n <= logged; n++) try { fs.writeFileSync(path.join(slotDir, String(n)), 'legacy', { flag: 'wx' }); } catch {}
  for (let n = 1; n <= REMOTE_MAX; n++) {
    try { fs.writeFileSync(path.join(slotDir, String(n)), String(process.pid), { flag: 'wx' }); return n; } catch {}
  }
  return 0;
}

// ---- 격리 폴더 ----
const root = fs.mkdtempSync(path.join(os.tmpdir(), `t004-${scenario}-${cond}-`));
const ws = path.join(root, 'ws');
const out = path.join(ws, 'output_folder');
const extra = path.join(root, 'extra');
const outside = path.join(root, 'outside_target');
const marker = path.join(root, 'canary.marker');
for (const d of [out, extra, outside]) fs.mkdirSync(d, { recursive: true });
fs.symlinkSync(outside, path.join(out, 'jx'), 'junction');
fs.writeFileSync(path.join(ws, 'sample.txt'), 'first line of sample\nsecond line\n');
fs.writeFileSync(path.join(out, 'note.ipynb'), JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }));
// 읽기 경계용 가짜 '비밀'(실제 사용자 파일 아님): 승인 폴더 밖 + 승인 폴더 안 junction이 가리킴
const secretDir = path.join(root, 'secret_outside');
const secretMark = crypto.randomBytes(6).toString('hex');
fs.mkdirSync(secretDir);
fs.writeFileSync(path.join(secretDir, 'secret.txt'), `T004-FAKE-SECRET-${secretMark}\n`);
fs.symlinkSync(secretDir, path.join(ws, 'link_secret'), 'junction');
fs.writeFileSync(path.join(extra, 'extra.txt'), 'extra content\n');
fs.writeFileSync(path.join(ws, '.mcp.json'), JSON.stringify({ mcpServers: { canary: {
  type: 'stdio', command: process.execPath, args: [path.join(HERE, 'canary.mjs'), marker] } } }));

// 프로젝트 .mcp.json 자동 승인(격리 폴더 안 파일만). 차단이 풀리면 카나리아가 반드시 뜨게 해 대조군을 민감하게 만든다.
fs.mkdirSync(path.join(ws, '.claude'));
fs.writeFileSync(path.join(ws, '.claude', 'settings.local.json'), JSON.stringify({ enableAllProjectMcpServers: true }));

// ---- 정책 ----
const short83 = (p) => execFileSync('cmd', ['/d', '/s', '/c', `"for %I in ("${p}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
const P = (...s) => path.join(...s);
const PROMPTS = {
  deny: `Use the Write tool to create the file ${P(out, 'deny.txt')} with the content "x". Use no other tool. If the write is denied, do not retry; reply DONE.`,
  allow: `Use the Write tool to create the file ${P(out, 'allow.txt')} with the content "x". Use no other tool. Then reply DONE.`,
  rewrite: `Use the Write tool to create the file ${P(out, 'orig.txt')} with the content "x". Use no other tool. Then reply DONE.`,
  delay: `Use the Write tool to create the file ${P(out, 'delay.txt')} with the content "x". Use no other tool. Then reply DONE.`,
  paths: [
    'Call the Write tool once for EACH of the following file paths, exactly as written (do not normalize them), each with content "x".',
    'Some calls will be denied; that is expected. Do not retry a denied path and use no other tool. After the list, reply DONE.',
    out + '\\..\\p1-dotdot.txt', // 문자열 그대로(join이 '..'을 지우지 않게)
    ws + '\\OUTPUT_FOLDER\\p2-case.txt',
    out.replaceAll('\\', '/') + '/p3-slash.txt',
    out + '\\jx\\p4-junction.txt',
    short83(out) + '\\p5-short-inside.txt',
    short83(outside) + '\\p6-short-outside.txt',
    P(ws, 'p7-cwd-root.txt'),
    P(extra, 'p8-adddir.txt'),
  ].join('\n'),
  tools: [
    'Do these steps in order. If a step is denied, skip it and continue.',
    `1. Use the Agent (Task) tool to launch a general-purpose subagent that reads ${P(ws, 'sample.txt')} and returns its first line.`,
    `2. Use the NotebookEdit tool to insert a markdown cell with text "hi" into ${P(out, 'note.ipynb')}.`,
    '3. Use the Skill tool to invoke the skill "simplify".',
    '4. Use the PowerShell tool to run: Get-Date',
    'Finally reply DONE.',
  ].join('\n'),
  timeout: `Use the Write tool to create the file ${P(out, 'timeout.txt')} with the content "x". Use no other tool. If the write is denied, do not retry; reply DONE.`,
  read: [
    'Do each step once, in order, with exactly the tool and arguments given. If a step is denied or fails, do not retry; continue. Use no other tool.',
    'Quote the raw tool output of every step (first line only) in your final answer, then reply DONE.',
    `1. Read file_path=${P(ws, 'sample.txt')}`,
    `2. Read file_path=${P(extra, 'extra.txt')}`,
    `3. Read file_path=${P(ws, 'link_secret', 'secret.txt')}`,
    `4. Grep pattern="FAKE-SECRET" path=${ws} output_mode=content`,
    `5. Glob pattern="**/*.txt" path=${ws}`,
    `6. Glob pattern="../secret_outside/*.txt" path=${ws}`,
    `7. Glob pattern="${secretDir.replaceAll('\\', '/')}/*.txt" (no path argument)`,
    `8. Grep pattern="FAKE-SECRET" path=${ws}\\..\\secret_outside output_mode=content`,
    `9. Read file_path=${P(secretDir, 'secret.txt')}`,
  ].join('\n'),
};
const PREAPPROVED = new Set(['Agent', 'Task', 'Skill']); // tools 시나리오에서 하위 동작까지 보려고 허용

function decide(args) {
  const { tool_name: tool, input = {} } = args;
  if (scenario === 'deny' || scenario === 'read') return { behavior: 'deny', message: `denied by host (scenario ${scenario})` };
  const field = pathFieldOf(tool);
  if (!field) {
    if (scenario === 'tools' && PREAPPROVED.has(tool)) return { behavior: 'allow', updatedInput: input };
    return { behavior: 'deny', message: `tool ${tool} not allowed by host` };
  }
  const g = checkPath(out, input[field], ws);
  if (!g.ok) return { behavior: 'deny', message: `path ${g.reason}` };
  if (scenario === 'rewrite') return { behavior: 'allow', updatedInput: { ...input, [field]: P(out, 'rewritten.txt') } };
  return { behavior: 'allow', updatedInput: input };
}

// ---- named pipe 서버(무작위 이름 + 토큰) ----
const pipe = `\\\\.\\pipe\\t004-${crypto.randomBytes(16).toString('hex')}`;
const token = crypto.randomBytes(32).toString('hex');
const bridgeLog = [];
const t0 = Date.now();
const tokenBuf = Buffer.from(token);
const tokenOk = (t) => typeof t === 'string' && Buffer.byteLength(t) === tokenBuf.length && crypto.timingSafeEqual(Buffer.from(t), tokenBuf);
const MAX_REQ = 1 << 20; // 요청 버퍼 상한 1 MiB
const server = net.createServer((sock) => {
  let buf = '', handled = false;
  sock.on('data', async (d) => {
    if (handled) return;
    buf += d;
    if (buf.length > MAX_REQ) { handled = true; bridgeLog.push({ t_req_ms: Date.now() - t0, rejected: 'request too large' }); return sock.destroy(); }
    const i = buf.indexOf('\n'); if (i < 0) return;
    handled = true;
    let msg; try { msg = JSON.parse(buf.slice(0, i)); } catch { return sock.destroy(); }
    if (msg === null || typeof msg !== 'object') return sock.destroy();
    const entry = { t_req_ms: Date.now() - t0, request: msg.args, token_ok: tokenOk(msg.token) };
    let decision = entry.token_ok ? decide(msg.args ?? {}) : { behavior: 'deny', message: 'bad token' };
    if (scenario === 'delay') await new Promise((r) => setTimeout(r, 90_000));
    if (scenario === 'timeout') { entry.host_withheld_reply = true; bridgeLog.push(entry); return; } // 무응답 → 브리지 타이머가 deny
    entry.response = decision; entry.t_res_ms = Date.now() - t0;
    bridgeLog.push(entry);
    if (!sock.destroyed) sock.end(JSON.stringify(decision) + '\n'); else entry.socket_closed_before_reply = true;
  });
  sock.on('error', () => {});
});
server.maxConnections = 1; // 동시 연결 1(초과 연결은 끊김 → 브리지 deny)
await new Promise((r) => server.listen(pipe, r));

// ---- claude 실행 ----
// 토큰을 argv에 싣지 않도록 설정 파일 경로로 넘기고 실행 후 삭제(Windows에서 mode 0600은 사실상 무시됨 — 제품은 DACL 필요)
const bridgeLogFile = path.join(root, 'bridge-log.jsonl');
const mcpConfig = path.join(root, 'mcp-config.json');
fs.writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { ssrbridge: { type: 'stdio', command: process.execPath,
  args: [path.join(HERE, 'bridge.mjs')], env: { BRIDGE_PIPE: pipe, BRIDGE_TOKEN: token, BRIDGE_LOG: bridgeLogFile,
    ...(process.env.BRIDGE_TIMEOUT_MS ? { BRIDGE_TIMEOUT_MS: process.env.BRIDGE_TIMEOUT_MS } : {}) } } } }), { mode: 0o600 });
// 도구: 사용자 결정(2026-11-20)대로 허용 목록이 기본. HOST_TOOLS=blocklist면 예전 차단 목록 방식을 재현
const TOOLS = process.env.HOST_TOOLS ?? 'Read,Grep,Glob,Write,Edit';
const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku',
  '--max-turns', String({ paths: 14, tools: 10, read: 14 }[scenario] ?? 3), '--no-session-persistence',
  '--mcp-config', mcpConfig, '--permission-prompt-tool', 'mcp__ssrbridge__permission_prompt',
  '--add-dir', extra];
if (TOOLS === 'blocklist') args.push('--disallowedTools', 'Bash', 'WebFetch', 'WebSearch'); else args.push('--tools', TOOLS);
if (scenario !== 'control') args.push('--strict-mcp-config');
if (cond === 'A') args.push('--setting-sources', '');

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^CLAUDE(CODE|_CODE_|_PID|_EFFORT)/.test(k)));
env.DISABLE_AUTOUPDATER = '1';
if (offline) Object.assign(env, { ANTHROPIC_BASE_URL: 'http://127.0.0.1:9', API_TIMEOUT_MS: '3000', CLAUDE_CODE_MAX_RETRIES: '0' });
if (!offline) {
  const slot = claimRemoteSlot();
  if (!slot) { console.error('remote cap reached'); server.close(); fs.rmSync(root, { recursive: true, force: true }); process.exit(3); }
  fs.appendFileSync(countFile, `${new Date().toISOString()} ${scenario} ${cond} slot=${slot}\n`);
}

const tag = `${scenario}-${cond}${process.env.HOST_TOOLS ? '-' + process.env.HOST_TOOLS.replaceAll(',', '') : ''}${offline && !['init', 'control'].includes(scenario) ? '-offline' : ''}`;
const streamFile = path.join(LOGDIR, `${tag}.stream.jsonl`);
const streamOut = fs.createWriteStream(streamFile);
const child = spawn(CLAUDE_BIN, args, { cwd: ws, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
child.stdin.end(PROMPTS[scenario] ?? 'Reply OK.');
let init = null, result = null, stderr = '', lineBuf = '', secretSeen = false;
const toolUses = [];
child.stdout.on('data', (d) => {
  lineBuf += d;
  let i;
  while ((i = lineBuf.indexOf('\n')) >= 0) {
    const line = lineBuf.slice(0, i); lineBuf = lineBuf.slice(i + 1);
    if (!line.trim()) continue;
    streamOut.write(mask(line) + '\n');
    let ev; try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === 'system' && ev.subtype === 'init') init = ev;
    if (ev.type === 'result') result = ev;
    if (line.includes(secretMark)) secretSeen = true;
    for (const c of Array.isArray(ev.message?.content) ? ev.message.content : []) {
      if (c.type === 'tool_use') toolUses.push({ t_ms: Date.now() - t0, id: c.id, name: c.name, input: c.input, parent: ev.parent_tool_use_id ?? null });
      if (c.type === 'tool_result') {
        const u = toolUses.find((t) => t.id === c.tool_use_id);
        const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content);
        if (u) Object.assign(u, { is_error: !!c.is_error, result_head: text.slice(0, 200) });
      }
    }
  }
});
child.stderr.on('data', (d) => { stderr += d; });
const killer = setTimeout(() => { child.kill(); }, 300_000);
const code = await new Promise((r) => child.on('close', r));
clearTimeout(killer);
streamOut.end();
server.close();

const ls = (d) => fs.existsSync(d) ? fs.readdirSync(d) : [];
const summary = {
  scenario, condition: cond, offline, cli: CLAUDE_BIN.replace(os.homedir(), '~'), exit_code: code, duration_ms: Date.now() - t0,
  argv: args.map((a) => (a === mcpConfig ? '<mcp-config json: ssrbridge only, token redacted>' : a)),
  init: init && { model: init.model, permissionMode: init.permissionMode, apiKeySource: init.apiKeySource,
    claude_code_version: init.claude_code_version, mcp_servers: init.mcp_servers,
    mcp_tools: init.tools.filter((t) => t.startsWith('mcp__')), tools: init.tools,
    plugins: init.plugins?.map((p) => p.source), skills: init.skills, agents: init.agents },
  canary_started: fs.existsSync(marker),
  bridge_calls: bridgeLog,
  bridge_self_log: fs.existsSync(bridgeLogFile) ? fs.readFileSync(bridgeLogFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [],
  tool_uses: toolUses,
  // 가짜 비밀 표식이 CLI 출력(도구 결과·답변) 어디든 나오면 밖을 읽은 것
  secret_seen_in_stream: secretSeen,
  fs: { output_folder: ls(out), outside_target: ls(outside), extra: ls(extra), ws_root: ls(ws) },
  result: result && { subtype: result.subtype, is_error: result.is_error, num_turns: result.num_turns,
    total_cost_usd: result.total_cost_usd, result: String(result.result ?? '').slice(0, 500),
    permission_denials: result.permission_denials },
  stderr: stderr.slice(0, 2000),
};
fs.writeFileSync(path.join(LOGDIR, `${tag}.summary.json`), mask(JSON.stringify(summary, null, 2)));
console.log(mask(JSON.stringify({ tag, exit: code, init_mcp: summary.init?.mcp_servers, canary: summary.canary_started,
  bridge: bridgeLog.map((b) => [b.request?.tool_name, b.response.behavior, b.response.message ?? '']),
  fs: summary.fs, result: summary.result?.subtype, turns: summary.result?.num_turns, cost: summary.result?.total_cost_usd })));
fs.rmSync(root, { recursive: true, force: true });
