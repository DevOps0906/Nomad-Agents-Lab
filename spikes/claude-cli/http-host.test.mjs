// HTTP 권한 브리지 노출 면·fail-closed 단위 검증(원격 없음): node --test spikes/claude-cli/http-host.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startBridgeServer, TOOL } from './http-host.mjs';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const logs = [];
const srv = await startBridgeServer({
  timeoutMs: 300,
  maxBody: 4096,
  log: (r) => logs.push(r),
  decide: async ({ tool_name, input }) => {
    if (tool_name === 'slow') { await wait(150); return { behavior: 'allow', updatedInput: input }; }
    if (tool_name === 'hang') return new Promise(() => {});
    if (tool_name === 'throw') throw new Error('x');
    if (tool_name === 'bad') return { behavior: 'allow' };
    return { behavior: 'deny', message: 'no' };
  },
});
test.after(() => srv.close());

function send({ method = 'POST', path = '/mcp', headers = {}, body } = {}) {
  const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, method, path, agent: false, headers: {
      Host: `127.0.0.1:${srv.port}`, Authorization: `Bearer ${srv.token}`, 'Content-Type': 'application/json', ...headers,
    } }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b ? JSON.parse(b) : null })); });
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}
const call = (tool_name, extra = {}) => ({ jsonrpc: '2.0', id: Math.random(), method: 'tools/call',
  params: { name: TOOL, arguments: { tool_name, input: { file_path: 'x' }, ...extra } } });
const decisionOf = (r) => JSON.parse(r.body.result.content[0].text);

test('127.0.0.1에만 바인딩', () => assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/));

test('Host 위조는 403', async () => {
  for (const host of ['localhost:' + srv.port, 'evil.example', `127.0.0.1:${srv.port + 1}`, '127.0.0.1', `evil.example:${srv.port}`]) {
    const r = await send({ headers: { Host: host }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(r.status, 403, host);
  }
});

test('Origin 헤더가 있으면 403(정상 토큰이어도)', async () => {
  for (const origin of ['http://evil.example', `http://127.0.0.1:${srv.port}`, 'null']) {
    const r = await send({ headers: { Origin: origin }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(r.status, 403, origin);
  }
});

test('토큰 틀림·없음·형식 다름은 401이고 WWW-Authenticate가 없다', async () => {
  for (const auth of [`Bearer ${'0'.repeat(64)}`, '', srv.token, `Bearer ${srv.token}x`, `bearer ${srv.token}`]) {
    const r = await send({ headers: { Authorization: auth }, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    assert.equal(r.status, 401, auth);
    assert.equal(r.headers['www-authenticate'], undefined);
  }
});

test('거부된 요청은 결정 함수를 부르지 않는다', async () => {
  const before = logs.filter((l) => l.decision).length;
  await send({ headers: { Authorization: 'Bearer nope' }, body: call('slow') });
  await send({ headers: { Origin: 'http://x' }, body: call('slow') });
  assert.equal(logs.filter((l) => l.decision).length, before);
});

test('본문 상한 초과는 413', async () => {
  const r = await send({ body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', pad: 'x'.repeat(5000) }) });
  assert.equal(r.status, 413);
});

test('GET·다른 경로는 405·404, 파싱 실패 400, 알림 202', async () => {
  assert.equal((await send({ method: 'GET' })).status, 405);
  assert.equal((await send({ path: '/.well-known/oauth-protected-resource', method: 'GET' })).status, 404);
  assert.equal((await send({ body: '{not json' })).status, 400);
  assert.equal((await send({ body: { jsonrpc: '2.0', method: 'notifications/initialized' } })).status, 202);
});

test('initialize·tools/list', async () => {
  const i = await send({ body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } } });
  assert.equal(i.body.result.protocolVersion, '2025-06-18');
  const l = await send({ body: { jsonrpc: '2.0', id: 2, method: 'tools/list' } });
  assert.deepEqual(l.body.result.tools.map((t) => t.name), [TOOL]);
});

test('tools/call fail-closed: 예외·스키마 위반·무응답 시간 초과·모르는 도구는 deny', async () => {
  assert.equal(decisionOf(await send({ body: call('throw') })).behavior, 'deny');
  assert.equal(decisionOf(await send({ body: call('bad') })).behavior, 'deny');
  const t = Date.now(); const h = decisionOf(await send({ body: call('hang') }));
  assert.equal(h.behavior, 'deny'); assert.match(h.message, /no decision within 300/); assert.ok(Date.now() - t < 2000);
  const u = await send({ body: { ...call('slow'), params: { name: 'other', arguments: {} } } });
  assert.equal(decisionOf(u).behavior, 'deny');
});

test('같은 tool_use_id 두 번째 요청은 deny(결정 1회)', async () => {
  assert.equal(decisionOf(await send({ body: call('slow', { tool_use_id: 'tu-1' }) })).behavior, 'allow');
  assert.equal(decisionOf(await send({ body: call('slow', { tool_use_id: 'tu-1' }) })).message, 'bridge: duplicate tool_use_id');
});

test('동시 요청은 요청별로 처리(다중화)', async () => {
  const t = Date.now();
  const rs = await Promise.all([1, 2, 3].map((n) => send({ body: call('slow', { tool_use_id: `p-${n}` }) })));
  assert.deepEqual(rs.map((r) => decisionOf(r).behavior), ['allow', 'allow', 'allow']);
  assert.ok(Date.now() - t < 400, '직렬이면 450ms 이상');
});

test('close() 뒤에는 접속 불가(토큰 폐기)', async () => {
  const s2 = await startBridgeServer({ decide: () => ({ behavior: 'deny', message: 'x' }) });
  const port = s2.port; await s2.close();
  await assert.rejects(new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: '/mcp' }, res).on('error', rej)));
});
