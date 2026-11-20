// 로컬 Chrome을 DevTools 프로토콜로 띄워 벤치 URL을 차례로 측정한다(추가 의존성 없음, Node 22+).
// 사용: node scripts/run-bench.mjs --base http://127.0.0.1:5182 [--counts 100,500] [--renderers prototype,single-buffer]
//       [--headed] [--dpr 1] [--size 1920,1080] [--cpu-throttle 4] [--chrome <chrome.exe 경로>] [--out bench-results/run.json] [--extra-flags "--a --b"]
// 안전장치: 디버깅 포트는 OS가 고른 빈 포트(0)이고, 이 스크립트가 만든 임시 프로필의 DevToolsActivePort로만 접속한다.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const base = option('base', 'http://127.0.0.1:5182');
const counts = option('counts', '100,500,1000,2000,5000').split(',').map(Number);
const renderers = option('renderers', 'single-buffer,prototype').split(',');
const headed = args.includes('--headed');
const dpr = option('dpr', '1');
const size = option('size', '1920,1080');
const chromePath = option('chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const query = option('query', '');
const cpuThrottle = Number(option('cpu-throttle', '1'));
const out = option('out', `bench-results/${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
const commandTimeoutMs = 30000;
const pageTimeoutMs = 300000;

const urlFor = (renderer, count) => `${base}/${renderer === 'prototype' ? '' : 'bench.html'}?bench=${count}${query ? `&${query}` : ''}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let profile = null;
let chrome = null;
let socket = null;
const results = [];

const launchChrome = () => {
  profile = mkdtempSync(join(tmpdir(), 'brain-bench-'));
  chrome = spawn(chromePath, [
    ...(headed ? [] : ['--headless=new']),
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${size}`,
    `--force-device-scale-factor=${dpr}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-precise-memory-info',
    ...option('extra-flags', '').split(' ').filter(Boolean),
    'about:blank',
  ], { stdio: 'ignore' });
  chrome.on('error', () => { /* 실행 후 오류는 cleanup에서 정리 */ });
  return new Promise((resolve, reject) => {
    chrome.once('error', (error) => reject(new Error(`Chrome 실행 실패: ${error.message}`)));
    chrome.once('exit', (code) => reject(new Error(`Chrome이 바로 종료됨(코드 ${code})`)));
    chrome.once('spawn', resolve);
  });
};

// 이 프로필로 띄운 Chrome이 쓴 포트만 사용한다.
const connectEndpoint = async () => {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (chrome.exitCode !== null) throw new Error('Chrome이 종료되어 연결할 수 없음');
    if (existsSync(portFile)) {
      const [port] = readFileSync(portFile, 'utf8').split(/\r?\n/);
      try {
        const pages = await (await fetch(`http://127.0.0.1:${Number(port)}/json/list`, { signal: AbortSignal.timeout(2000) })).json();
        const page = pages.find(({ type }) => type === 'page');
        if (page) return page.webSocketDebuggerUrl;
      } catch { /* 엔드포인트 준비 대기 */ }
    }
    await sleep(200);
  }
  throw new Error('Chrome DevTools 연결 실패(20초)');
};

const openSession = async (url) => {
  socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = () => reject(new Error('DevTools WebSocket 연결 실패'));
  });
  let nextId = 0;
  const pending = new Map();
  const rejectAll = (reason) => {
    for (const { reject } of pending.values()) reject(reason);
    pending.clear();
  };
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(new Error(`${message.error.message} (${entry.method})`));
    else entry.resolve(message);
  };
  socket.onclose = () => rejectAll(new Error('DevTools 연결이 닫힘'));
  socket.onerror = () => rejectAll(new Error('DevTools 연결 오류'));
  return (method, params = {}) => new Promise((resolve, reject) => {
    if (socket.readyState !== WebSocket.OPEN) {
      reject(new Error(`연결이 열려 있지 않음 (${method})`));
      return;
    }
    nextId += 1;
    const id = nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`명령 시간 초과 ${commandTimeoutMs}ms (${method})`));
    }, commandTimeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    socket.send(JSON.stringify({ id, method, params }));
  });
};

const cleanup = async () => {
  try { socket?.close(); } catch { /* 이미 닫힘 */ }
  if (chrome && chrome.exitCode === null && chrome.pid) {
    const exited = new Promise((resolve) => chrome.once('exit', resolve));
    chrome.kill();
    await Promise.race([exited, sleep(5000)]);
  }
  if (profile) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(profile, { recursive: true, force: true });
        break;
      } catch {
        await sleep(500);
      }
    }
  }
};

let failed = false;
try {
  await launchChrome();
  const send = await openSession(await connectEndpoint());
  await send('Page.enable');
  await send('Page.bringToFront');
  if (cpuThrottle > 1) await send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });

  for (const renderer of renderers) {
    for (const count of counts) {
      const url = urlFor(renderer, count);
      await send('Page.navigate', { url });
      const startedAt = Date.now();
      let result = null;
      while (!result && Date.now() - startedAt < pageTimeoutMs) {
        await sleep(1000);
        try {
          const response = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__BENCH_RESULT__ ?? null)', returnByValue: true });
          result = JSON.parse(response.result?.result?.value ?? 'null');
        } catch (error) {
          // 페이지가 오래 막혀 평가가 늦으면 다음 반복에서 다시 묻는다. 연결이 끊기면 중단한다.
          if (socket.readyState !== WebSocket.OPEN) throw error;
        }
      }
      const entry = result ?? { renderer, nodes: count, error: `시간 초과(${pageTimeoutMs / 1000}초)` };
      entry.url = url;
      results.push(entry);
      const f = entry.frameIntervalMs;
      const s = entry.selectedFrameIntervalMs;
      console.log(`${renderer}\t${count}\tfirst=${entry.firstRenderMs}ms\tframe mean=${f?.mean} p95=${f?.p95}\tselected frame mean=${s?.mean} p95=${s?.p95}\tcpu p95=${entry.cpuFrameMs?.p95}\tselect mean=${entry.selectionMs?.mean} p95=${entry.selectionMs?.p95}\t${entry.gpu?.renderer ?? entry.error}`);
    }
  }
} catch (error) {
  failed = true;
  console.error(`벤치 실패: ${error.message}`);
} finally {
  await cleanup();
}

if (results.length) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ headed, dpr: Number(dpr), size, cpuThrottle, results }, null, 2)}\n`);
  console.log(`저장: ${out}`);
}
process.exit(failed ? 1 : 0);
