// 브리지 fail-closed 단위 검증(원격 없음): node --test spikes/claude-cli/bridge.test.mjs
// 가짜 host(named pipe)가 여러 이상 응답을 돌려줄 때 요청마다 정확히 1개 응답, 이상은 모두 deny인지 본다.
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pipe = `\\\\.\\pipe\\t004-test-${crypto.randomBytes(8).toString('hex')}`;
const deadPipe = `\\\\.\\pipe\\t004-dead-${crypto.randomBytes(8).toString('hex')}`;
const TOKEN = 'tok';

// tool_name이 host의 반응을 고른다
const REPLIES = {
  ok: (args) => JSON.stringify({ behavior: 'allow', updatedInput: args.input }) + '\n',
  garbage: () => 'not json\n',
  nullReply: () => 'null\n',
  allowNoInput: () => JSON.stringify({ behavior: 'allow' }) + '\n',
  weird: () => JSON.stringify({ behavior: 'maybe', message: 'x' }) + '\n',
  silent: () => null, // 연결만 유지하고 무응답
  close: () => '', // 바로 끊기
};
const server = net.createServer((sock) => {
  let buf = '';
  sock.on('data', (d) => {
    buf += d; const i = buf.indexOf('\n'); if (i < 0) return;
    const msg = JSON.parse(buf.slice(0, i));
    const r = REPLIES[msg.args.tool_name](msg.args);
    if (r === null) return;
    sock.end(r);
  });
  sock.on('error', () => {});
});
await new Promise((r) => server.listen(pipe, r));

function startBridge(pipePath) {
  const child = spawn(process.execPath, [path.join(HERE, 'bridge.mjs')], {
    env: { ...process.env, BRIDGE_PIPE: pipePath, BRIDGE_TOKEN: TOKEN, BRIDGE_TIMEOUT_MS: '300' }, stdio: ['pipe', 'pipe', 'inherit'] });
  const replies = [];
  readline.createInterface({ input: child.stdout }).on('line', (l) => replies.push(JSON.parse(l)));
  return { child, replies, send: (line) => child.stdin.write(line + '\n') };
}
const call = (id, args) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'permission_prompt', arguments: args } });
const decisionOf = (r) => JSON.parse(r.result.content[0].text);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('host 이상 응답·무응답·요청 스키마 위반은 모두 deny, 요청당 응답 1개', async () => {
  const b = startBridge(pipe);
  const names = Object.keys(REPLIES);
  names.forEach((n, i) => b.send(call(i + 1, { tool_name: n, input: { file_path: 'x' } })));
  b.send(call(100, null));
  b.send(call(101, { tool_name: 'ok', input: null }));
  b.send(JSON.stringify({ jsonrpc: '2.0', id: 102, method: 'tools/call', params: { name: 'other', arguments: {} } }));
  b.send('null');
  b.send('{bad json');
  await wait(1500);
  b.child.kill();
  const byId = Object.groupBy(b.replies.filter((r) => r.id !== null), (r) => r.id);
  for (const [i, n] of names.entries()) {
    assert.equal(byId[i + 1]?.length, 1, `${n}: exactly one reply`);
    assert.equal(decisionOf(byId[i + 1][0]).behavior, n === 'ok' ? 'allow' : 'deny', n);
  }
  for (const id of [100, 101, 102]) assert.equal(decisionOf(byId[id][0]).behavior, 'deny', `id ${id}`);
  assert.equal(b.replies.filter((r) => r.id === null).length, 2, 'null·파싱 실패 줄은 JSON-RPC 오류');
  assert.match(decisionOf(byId[names.indexOf('silent') + 1][0]).message, /no decision within 300 ms/);
});

test('host 연결 불가 → deny', async () => {
  const b = startBridge(deadPipe);
  b.send(call(1, { tool_name: 'ok', input: {} }));
  await wait(2500);
  b.child.kill();
  assert.equal(b.replies.length, 1);
  assert.equal(decisionOf(b.replies[0]).behavior, 'deny');
});

test.after(() => server.close());
