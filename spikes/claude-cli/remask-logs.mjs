// 이미 쓴 로그에 사용자 홈 경로·이메일·조직 ID 마스킹을 다시 적용한다(host.mjs의 mask와 같은 규칙).
// 사용법: node remask-logs.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.nomad', 'logs', 'task-004');
const home = os.homedir();
const mask = (s) => s
  .replaceAll(JSON.stringify(home).slice(1, -1), '~').replaceAll(home, '~').replaceAll(home.replaceAll('\\', '/'), '~')
  .replaceAll(JSON.stringify(home).slice(1, -1).toLowerCase(), '~').replaceAll(home.toLowerCase(), '~')
  .replaceAll('Users-' + os.userInfo().username + '-', 'Users-<user>-')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
  .replace(/("(?:orgId|organization_uuid|organizationUuid|account_uuid|accountUuid|orgName)"\s*:\s*")[^"]*"/g, '$1<masked>"');
let n = 0;
for (const f of fs.readdirSync(LOGDIR)) {
  const p = path.join(LOGDIR, f);
  if (!fs.statSync(p).isFile()) continue;
  const s = fs.readFileSync(p, 'utf8'); const m = mask(s);
  if (m !== s) { fs.writeFileSync(p, m); n++; }
}
console.log(`remasked ${n} files`);
