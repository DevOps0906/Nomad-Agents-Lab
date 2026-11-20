// 권한 브리지 MCP stdio 서버 (MCP SDK 없이 손으로 쓴 JSON-RPC, 의존성 0).
// Claude Code가 --permission-prompt-tool로 이 도구를 부르면, 앱 Main 대역(host.mjs)에
// 무작위 이름 named pipe로 질의하고 그 결정을 돌려준다.
// fail-closed: 시간 초과·연결 오류·응답 스키마 위반·파싱 실패·예외는 모두 deny. 요청마다 응답은 정확히 1개.
import fs from 'node:fs';
import net from 'node:net';
import readline from 'node:readline';

const PIPE = process.env.BRIDGE_PIPE;
const TOKEN = process.env.BRIDGE_TOKEN;
const TIMEOUT_MS = Number(process.env.BRIDGE_TIMEOUT_MS) > 0 ? Number(process.env.BRIDGE_TIMEOUT_MS) : 300_000; // 5분
const LOG = process.env.BRIDGE_LOG; // 요청·결정 1:1 기록(선택)
const MAX_REPLY = 1 << 20;
const TOOL = 'permission_prompt';

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const deny = (message) => ({ behavior: 'deny', message });
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const log = (rec) => { if (LOG) try { fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...rec }) + '\n'); } catch {} };

// host 응답 스키마: {behavior:'allow', updatedInput:object} | {behavior:'deny', message:string}
export function validateDecision(d) {
  if (!isObj(d)) return deny('bridge: reply not an object');
  if (d.behavior === 'allow' && isObj(d.updatedInput)) return { behavior: 'allow', updatedInput: d.updatedInput };
  if (d.behavior === 'deny' && typeof d.message === 'string') return { behavior: 'deny', message: d.message };
  return deny('bridge: reply schema invalid');
}

function askHost(args) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (d) => { if (done) return; done = true; clearTimeout(timer); sock?.destroy(); resolve(d); };
    const timer = setTimeout(() => finish(deny(`bridge: no decision within ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    if (!PIPE || !TOKEN) return finish(deny('bridge: pipe/token missing'));
    let sock, buf = '';
    try { sock = net.connect(PIPE); } catch (e) { return finish(deny('bridge: connect failed')); }
    sock.on('connect', () => sock.write(JSON.stringify({ token: TOKEN, args }) + '\n'));
    sock.on('data', (d) => {
      buf += d;
      if (buf.length > MAX_REPLY) return finish(deny('bridge: reply too large'));
      const i = buf.indexOf('\n');
      if (i < 0) return;
      let parsed; try { parsed = JSON.parse(buf.slice(0, i)); } catch { return finish(deny('bridge: bad host reply')); }
      finish(validateDecision(parsed));
    });
    sock.on('error', (e) => finish(deny('bridge: host unreachable ' + (e.code ?? ''))));
    sock.on('close', () => finish(deny('bridge: host closed')));
  });
}

async function handle(line) {
  let req;
  try { req = JSON.parse(line); } catch { return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
  if (!isObj(req)) return send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } });
  const { id, method, params } = req;
  if (id === undefined || id === null) return; // notification
  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'ssr-bridge', version: '0.0.2' },
    } });
  }
  if (method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: [{
      name: TOOL,
      description: 'Permission bridge to the host app',
      inputSchema: { type: 'object', properties: {
        tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' },
      }, required: ['tool_name', 'input'] },
    }] } });
  }
  if (method === 'tools/call') {
    let decision;
    try {
      const args = params?.arguments;
      if (params?.name !== TOOL) decision = deny('bridge: unknown tool');
      else if (!isObj(args) || typeof args.tool_name !== 'string' || !isObj(args.input)) decision = deny('bridge: request schema invalid');
      else decision = await askHost(args);
    } catch { decision = deny('bridge: internal error'); }
    log({ id, tool: params?.arguments?.tool_name, tool_use_id: params?.arguments?.tool_use_id, decision });
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } });
}

if (import.meta.main) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    handle(line).catch(() => {}); // handle 내부에서 tools/call은 이미 deny로 응답
  });
}
