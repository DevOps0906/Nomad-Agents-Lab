// T-03 카나리아 MCP 서버: 실행되는 순간 표식 파일을 쓴다. 표식이 생기면 차단 실패.
import fs from 'node:fs';
import readline from 'node:readline';

fs.writeFileSync(process.argv[2], `started ${new Date().toISOString()}\n`, { flag: 'a' });
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let r; try { r = JSON.parse(line); } catch { return; }
  if (r.id === undefined) return;
  if (r.method === 'initialize') return send({ jsonrpc: '2.0', id: r.id, result: { protocolVersion: r.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'canary', version: '0' } } });
  if (r.method === 'tools/list') return send({ jsonrpc: '2.0', id: r.id, result: { tools: [{ name: 'canary_tool', description: 'canary', inputSchema: { type: 'object' } }] } });
  send({ jsonrpc: '2.0', id: r.id, error: { code: -32601, message: 'no' } });
});
