// 출력 폴더 강제: 요청 경로를 정규화한 뒤 실제 경로(junction·8.3 이름 해소)로 출력 폴더 안인지 판정한다.
import fs from 'node:fs';
import path from 'node:path';

const PATH_FIELDS = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
export const pathFieldOf = (toolName) => PATH_FIELDS[toolName];

function realOf(abs) {
  // 존재하는(lstat 기준 — 대상 없는 링크도 '존재') 가장 가까운 조상까지 실제 경로로 바꾸고, 없는 꼬리는 그대로 붙인다.
  // 대상 없는 심볼릭 링크·junction은 realpath가 실패하므로 null(=거부).
  let cur = abs; const rest = [];
  for (;;) {
    let exists = true;
    try { fs.lstatSync(cur); } catch { exists = false; }
    if (exists) {
      try { return path.win32.join(fs.realpathSync.native(cur), ...rest); } catch { return null; }
    }
    const up = path.win32.dirname(cur);
    if (up === cur) return null;
    rest.unshift(path.win32.basename(cur)); cur = up;
  }
}

export function checkPath(outDir, p, cwd) {
  if (typeof p !== 'string' || p === '') return { ok: false, reason: 'empty' };
  if (p.startsWith('\\\\') || p.startsWith('//')) return { ok: false, reason: 'unc-or-device' };
  const abs = path.win32.resolve(cwd, p); // '/'·'\\' 통일, '..' 해소
  if (abs.indexOf(':', 2) !== -1) return { ok: false, reason: 'ads-colon' };
  const resolved = realOf(abs);
  if (resolved === null) return { ok: false, reason: 'unresolvable-link' };
  const real = resolved.toLowerCase();
  const root = fs.realpathSync.native(outDir).toLowerCase();
  const ok = real.startsWith(root + '\\');
  return { ok, reason: ok ? 'inside' : 'outside', resolved: real };
}
