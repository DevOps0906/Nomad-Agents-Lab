// 권한 브리지 — 로컬 HTTP MCP 서버(Streamable HTTP 최소 구현, MCP SDK 없이 node:http만, 의존성 0).
// 앱 Main 안에 두는 방식(task-012 사용자 결정)의 대역. stdio 브리지(bridge.mjs)와 named pipe가 하던 일을 한 곳에서 한다.
// 노출 면 방어: 127.0.0.1 무작위 포트(0 바인딩) · 실행마다 무작위 토큰(timingSafeEqual) · Host는 127.0.0.1:<port>만 ·
// Origin 헤더가 있으면 거부 · 본문 상한 · close() 시 토큰 폐기. 401에 WWW-Authenticate를 붙이지 않는다(OAuth 탐색 유도 금지).
// fail-closed: 결정 함수 예외·스키마 위반·요청별 타이머 만료는 모두 deny, tool_use_id(없으면 JSON-RPC id)마다 결정 1개.
import http from 'node:http';
import crypto from 'node:crypto';
import { validateDecision } from './bridge.mjs';

export const TOOL = 'permission_prompt';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deny = (message) => ({ behavior: 'deny', message });

/**
 * @param {object} o
 * @param {(args:object)=>Promise<object>|object} o.decide  권한 결정(앱 Main 대역)
 * @param {number} [o.timeoutMs=300000]  요청별 무응답 거부 시각(5분)
 * @param {number} [o.maxBody=1048576]   요청 본문 상한(바이트)
 * @param {(rec:object)=>void} [o.log]   요청·응답 기록(본문 원문은 넣지 않는다)
 */
export async function startBridgeServer({ decide, timeoutMs = 300_000, maxBody = 1 << 20, log = () => {} }) {
  let token = crypto.randomBytes(32).toString('hex');
  let tokenBuf = Buffer.from(`Bearer ${token}`);
  const t0 = Date.now();
  const decided = new Map(); // tool_use_id → 결정(1회용)
  let port = 0;

  const authOk = (h) => tokenBuf !== null && typeof h === 'string'
    && Buffer.byteLength(h) === tokenBuf.length && crypto.timingSafeEqual(Buffer.from(h), tokenBuf);
  const reply = (res, status, body, extra = {}) => {
    if (res.writableEnded || res.destroyed) return false;
    const data = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
    res.end(data);
    return true;
  };

  async function callTool(id, params, rec) {
    const args = params?.arguments;
    if (params?.name !== TOOL) return deny('bridge: unknown tool');
    if (!isObj(args) || typeof args.tool_name !== 'string' || !isObj(args.input)) return deny('bridge: request schema invalid');
    const key = typeof args.tool_use_id === 'string' ? args.tool_use_id : `rpc:${id}`;
    rec.tool = args.tool_name; rec.tool_use_id = key; rec.request = args;
    if (decided.has(key)) return deny('bridge: duplicate tool_use_id'); // 요청당 결정 1개
    decided.set(key, null);
    let timer;
    const timeout = new Promise((r) => { timer = setTimeout(() => r(deny(`bridge: no decision within ${timeoutMs} ms`)), timeoutMs); });
    let d;
    try { d = await Promise.race([Promise.resolve().then(() => decide(args)), timeout]); } catch { d = deny('bridge: decide failed'); }
    clearTimeout(timer);
    d = validateDecision(d);
    decided.set(key, d);
    return d;
  }

  async function rpc(msg, rec) {
    const { id, method, params } = msg;
    if (method === 'initialize') return { protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
      capabilities: { tools: {} }, serverInfo: { name: 'ssr-bridge-http', version: '0.1.0' } };
    if (method === 'tools/list') return { tools: [{ name: TOOL, description: 'Permission bridge to the host app',
      inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
        required: ['tool_name', 'input'] } }] };
    if (method === 'tools/call') {
      const decision = await callTool(id, params, rec);
      rec.decision = decision;
      return { content: [{ type: 'text', text: JSON.stringify(decision) }] };
    }
    if (method === 'ping') return {};
    return null;
  }

  const server = http.createServer((req, res) => {
    const rec = { t_ms: Date.now() - t0, method: req.method, url: req.url };
    const done = (status, extra = {}) => { Object.assign(rec, { status, t_res_ms: Date.now() - t0 }, extra); log(rec); };
    // 1) Host: 정확히 127.0.0.1:<port>(DNS 리바인딩·다른 이름 차단)
    if (req.headers.host !== `127.0.0.1:${port}`) { reply(res, 403, { error: 'bad host' }); return done(403, { reject: 'host', host: req.headers.host }); }
    // 2) Origin이 있으면 브라우저발 → 거부
    if (req.headers.origin !== undefined) { reply(res, 403, { error: 'origin not allowed' }); return done(403, { reject: 'origin' }); }
    // 3) 토큰(WWW-Authenticate 없음)
    if (!authOk(req.headers.authorization)) { reply(res, 401, { error: 'unauthorized' }); return done(401, { reject: 'token' }); }
    if (req.url !== '/mcp') { reply(res, 404, { error: 'not found' }); return done(404); }
    if (req.method !== 'POST') { reply(res, 405, { error: 'method not allowed' }, { Allow: 'POST' }); return done(405); }
    // 4) 본문 상한
    if (Number(req.headers['content-length']) > maxBody) { reply(res, 413, { error: 'too large' }, { Connection: 'close' }); req.destroy(); return done(413, { reject: 'size' }); }
    const chunks = []; let size = 0, aborted = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBody && !aborted) { aborted = true; reply(res, 413, { error: 'too large' }, { Connection: 'close' }); req.destroy(); done(413, { reject: 'size' }); }
      else if (!aborted) chunks.push(c);
    });
    res.on('close', () => { if (!res.writableFinished) { rec.client_closed_before_reply_ms = Date.now() - t0; log({ ...rec, event: 'client_closed' }); } });
    req.on('end', async () => {
      if (aborted) return;
      let msg; try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return done(400); }
      if (!isObj(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') { reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } }); return done(400); }
      rec.rpc = msg.method;
      if (msg.id === undefined || msg.id === null) { reply(res, 202); return done(202); } // notification
      let result;
      try { result = await rpc(msg, rec); } catch { result = msg.method === 'tools/call' ? { content: [{ type: 'text', text: JSON.stringify(deny('bridge: internal error')) }] } : null; }
      const sent = result === null
        ? reply(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })
        : reply(res, 200, { jsonrpc: '2.0', id: msg.id, result });
      done(200, sent ? {} : { reply_dropped: true });
    });
  });
  server.requestTimeout = 30_000; // 요청 본문 수신 상한(응답 대기와 무관)
  server.headersTimeout = 10_000;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  return {
    port, token, url: `http://127.0.0.1:${port}/mcp`,
    close: () => { tokenBuf = null; token = null; server.closeAllConnections?.(); return new Promise((r) => server.close(r)); }, // 토큰 폐기
  };
}
