// 원격 호출 없는 단위 검증(계획 3-③): node --test spikes/claude-cli/pathguard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkPath } from './pathguard.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 't004-guard-'));
const ws = path.join(root, 'ws');
const out = path.join(ws, 'output_folder');
const outside = path.join(root, 'outside_target');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(outside);
fs.symlinkSync(outside, path.join(out, 'jx'), 'junction');

const shortOf = (p) => execFileSync('cmd', ['/d', '/s', '/c', `"for %I in ("${p}") do @echo %~sI"`], { encoding: 'utf8', windowsVerbatimArguments: true }).trim();
const shortOut = shortOf(out);
const shortOutside = shortOf(outside);
const has83 = shortOut !== out && /~\d/.test(shortOut);

const cases = [
  ['상대경로 안', 'output_folder/a.txt', true],
  ['절대경로 안', path.join(out, 'b.txt'), true],
  ['대문자', path.join(ws, 'OUTPUT_FOLDER', 'c.txt'), true],
  ['슬래시 혼용', out.replaceAll('\\', '/') + '/d.txt', true],
  ['.. 탈출', path.join(out, '..', 'escape.txt'), false],
  ['.. 탈출(슬래시)', 'output_folder/../../outside_target/e.txt', false],
  ['출력 폴더 자체', out, false],
  ['접두사 위장', out + '_evil\\f.txt', false],
  ['junction 탈출', path.join(out, 'jx', 'g.txt'), false],
  ['UNC', '\\\\localhost\\c$\\x.txt', false],
  ['장치 경로', '\\\\?\\' + path.join(out, 'h.txt'), false],
  ['ADS', path.join(out, 'i.txt:evil'), false],
];
// 대상 없는 링크: 밖의 아직 없는 폴더를 가리키는 junction, 밖의 없는 파일을 가리키는 파일 심볼릭 링크(권한 없으면 생략)
fs.symlinkSync(path.join(outside, 'not-yet'), path.join(out, 'dangling_jx'), 'junction');
let fileLink = false;
try { fs.symlinkSync(path.join(outside, 'later.txt'), path.join(out, 'dangling.txt'), 'file'); fileLink = true; } catch {}
cases.push(['대상 없는 junction 아래', path.join(out, 'dangling_jx', 'l.txt'), false]);
cases.push(['대상 없는 junction 자체', path.join(out, 'dangling_jx'), false]);
if (fileLink) cases.push(['대상 없는 파일 심볼릭 링크', path.join(out, 'dangling.txt'), false]);
cases.push(['미생성 하위 폴더 안', path.join(out, 'new', 'deep', 'm.txt'), true]);
cases.push(['밖의 미생성 폴더', path.join(root, 'nope', 'n.txt'), false]);
test(`파일 심볼릭 링크 생성 가능 여부 기록`, () => { console.log(`# file symlink creatable: ${fileLink}`); });

if (has83) {
  cases.push(['8.3 이름 안', path.join(shortOut, 'j.txt'), true]);
  cases.push(['8.3 이름 밖', path.join(shortOutside, 'k.txt'), false]);
}

for (const [name, p, want] of cases) {
  test(`${name}: ${want ? '허용' : '거부'}`, () => {
    assert.equal(checkPath(out, p, ws).ok, want, `${p} → ${JSON.stringify(checkPath(out, p, ws))}`);
  });
}
test('8.3 이름 사용 가능 여부 기록', () => { console.log(`# 8.3 short name available: ${has83} (${shortOut})`); });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
