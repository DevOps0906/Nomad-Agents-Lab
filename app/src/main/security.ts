// Electron 하드닝 (docs/02_ARCHITECTURE.md#2 "Electron 하드닝(필수)").
import path from 'node:path';
import type { WebContents } from 'electron';

/** prod 로드용 커스텀 프로토콜. file://은 쓰지 않는다. */
export const APP_SCHEME = 'app';
export const APP_HOST = 'bundle';
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/** 모든 창에 강제하는 webPreferences (preload 경로 제외). */
export const SECURE_WEB_PREFERENCES = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  experimentalFeatures: false,
} as const;

/**
 * 신뢰하는 Renderer 출처. prod는 app://bundle 만, dev는 electron-vite 개발 서버 1곳만.
 * 비특수 스킴은 WHATWG URL의 origin이 "null"이므로 protocol+host로 비교한다.
 */
export function createTrustedUrlCheck(devServerUrl?: string): (url: string) => boolean {
  const trusted = devServerUrl
    ? (() => {
        const u = new URL(devServerUrl);
        return { protocol: u.protocol, host: u.host };
      })()
    : { protocol: `${APP_SCHEME}:`, host: APP_HOST };
  return (url) => {
    try {
      const u = new URL(url);
      return u.protocol === trusted.protocol && u.host === trusted.host;
    } catch {
      return false;
    }
  };
}

/**
 * CSP. style-src는 Fluent v9(Griffel) 실측 결과로 정한다(app/README.md "CSP" 절).
 * dev는 Vite HMR(ws)·React Refresh 인라인 preamble 때문에만 완화한다.
 */
/**
 * Griffel 실측으로 정한 style-src(2026-11-20, Electron 45.4.1 · Fluent 9.75.2).
 * Griffel·FluentProvider는 빈 <style>을 만든 뒤 CSSOM insertRule로 규칙을 넣는다. 'self'만 두면 빈 <style>이 막혀
 * 스타일이 전부 빠지고, 빈 문자열 해시만 허용하면 위반 0건으로 동작한다. 'unsafe-inline'은 쓰지 않는다.
 */
export const STYLE_SRC = "style-src 'self' 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

export function buildCsp(mode: 'prod' | 'dev', devServerUrl?: string): string {
  const common = [
    "default-src 'none'",
    "img-src 'self' data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ];
  if (mode === 'prod') {
    return [...common, STYLE_SRC, "script-src 'self'", "connect-src 'self'"].join('; ');
  }
  // dev 한정: Vite가 CSS를 글자가 든 <style>로 주입하므로 style도 'unsafe-inline'(해시를 같이 두면 unsafe-inline이 무시된다).
  const ws = devServerUrl ? devServerUrl.replace(/^http/, 'ws') : '';
  return [
    ...common,
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline'",
    `connect-src 'self' ${ws}`.trim(),
  ].join('; ');
}

/** app://bundle/<경로> → 렌더러 번들 폴더 안의 실제 파일 경로. 밖이면 null. */
export function resolveAppPath(rendererRoot: string, requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  const relative = pathname === '/' || pathname === '' ? 'index.html' : pathname.replace(/^\/+/, '');
  const root = path.resolve(rendererRoot);
  const resolved = path.resolve(root, relative);
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

/** 모든 페이지 이동·새 창·webview 첨부를 막는다. 앱은 단일 페이지라 이동이 필요 없다. */
export function hardenWebContents(contents: WebContents): void {
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-frame-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
