import path from 'node:path';
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import {
  SECURE_WEB_PREFERENCES,
  buildCsp,
  hardenWebContents,
  resolveAppPath,
} from '../src/main/security';

class FakeContents extends EventEmitter {
  openHandler: (() => unknown) | undefined;
  setWindowOpenHandler(handler: () => unknown) {
    this.openHandler = handler;
  }
}

function hardened() {
  const contents = new FakeContents();
  hardenWebContents(contents as unknown as WebContents);
  return contents;
}

describe('webPreferences', () => {
  it('contextIsolation·sandbox 켜짐, nodeIntegration 꺼짐, webSecurity 유지', () => {
    expect(SECURE_WEB_PREFERENCES).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
    });
  });
});

describe('navigation·새 창 차단', () => {
  it.each(['will-navigate', 'will-frame-navigate', 'will-attach-webview'])('%s 는 preventDefault 된다', (name) => {
    const contents = hardened();
    for (const url of ['https://evil.example/', 'file:///C:/Windows/', 'app://bundle/index.html']) {
      const event = { preventDefault: vi.fn() };
      contents.emit(name, event, url);
      expect(event.preventDefault).toHaveBeenCalledOnce();
    }
  });

  it('window.open 은 항상 deny', () => {
    const contents = hardened();
    expect(contents.openHandler?.()).toEqual({ action: 'deny' });
  });
});

describe('CSP', () => {
  const directives = (csp: string) =>
    Object.fromEntries(csp.split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values];
    }));

  it("prod: script-src 'self' 만, 원격·eval·inline 스크립트 없음", () => {
    const d = directives(buildCsp('prod'));
    expect(d['script-src']).toEqual(["'self'"]);
    expect(d['default-src']).toEqual(["'none'"]);
    // 빈 <style> 요소(sha256 of '')만 허용 — Griffel 실측값
    expect(d['style-src']).toEqual(["'self'", "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"]);
    expect(d['connect-src']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(buildCsp('prod')).not.toMatch(/unsafe-eval|unsafe-inline|https?:|\*/);
  });

  it('dev: 개발 서버 ws만 추가로 허용', () => {
    const d = directives(buildCsp('dev', 'http://localhost:5173'));
    expect(d['connect-src']).toEqual(["'self'", 'ws://localhost:5173']);
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(buildCsp('dev', 'http://localhost:5173')).not.toMatch(/unsafe-eval|https:/);
  });
});

describe('app:// 프로토콜 경로 해석', () => {
  const root = path.resolve('/srv/renderer');

  it('번들 안 파일만 돌려준다', () => {
    expect(resolveAppPath(root, 'app://bundle/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, 'app://bundle/index.html')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, 'app://bundle/assets/a.js')).toBe(path.join(root, 'assets', 'a.js'));
  });

  it('URL 정규화된 점 경로(../, %2e%2e/)는 번들 루트 안에 머문다', () => {
    for (const url of ['app://bundle/../secret.txt', 'app://bundle/%2e%2e/secret.txt', 'app://bundle/a/../../../x.js']) {
      expect(resolveAppPath(root, url)?.startsWith(root + path.sep)).toBe(true);
    }
  });

  it.each([
    'app://bundle/..%2fsecret.txt',
    'app://bundle/..%5csecret.txt',
    'app://bundle/%2e%2e%5c%2e%2e%5cWindows%5cwin.ini',
    'app://bundle/a%00.js',
    'app://bundle/%E0%A4%A',
    'app://other/index.html',
    'file:///srv/renderer/index.html',
  ])('%s → null', (url) => {
    expect(resolveAppPath(root, url)).toBeNull();
  });
});
