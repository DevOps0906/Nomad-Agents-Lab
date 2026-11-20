import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, app, ipcMain, net, protocol, session } from 'electron';
import { createInvokeHandler, registerIpc } from './ipc/router';
import { routes } from './ipc/routes';
import {
  APP_ENTRY_URL,
  APP_SCHEME,
  SECURE_WEB_PREFERENCES,
  buildCsp,
  createTrustedUrlCheck,
  hardenWebContents,
  resolveAppPath,
} from './security';

const log = (message: string) => console.log(`[ssr] ${message}`);

// dev 서버는 패키지되지 않은 실행에서만 허용한다.
const devServerUrl = !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined;
const csp = buildCsp(devServerUrl ? 'dev' : 'prod', devServerUrl);
const isTrustedUrl = createTrustedUrlCheck(devServerUrl);
const rendererRoot = path.join(__dirname, '../renderer');

let mainWindow: BrowserWindow | null = null;

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function serveAppProtocol(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const filePath = resolveAppPath(rendererRoot, request.url);
    if (!filePath) return new Response(null, { status: 404 });
    const response = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', csp);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
}

function lockDownSession(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  // Renderer의 외부 네트워크 연결 금지(dev 서버만 예외).
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const allowed = devServerUrl !== undefined && isTrustedUrl(details.url.replace(/^ws/, 'http'));
      if (!allowed) log('blocked network request');
      callback({ cancel: !allowed });
    },
  );
  if (devServerUrl) {
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } });
    });
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'SSR+',
    autoHideMenuBar: true,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });
  win.once('ready-to-show', () => {
    win.show();
    log('window ready-to-show');
  });
  win.on('closed', () => {
    mainWindow = null;
  });
  void win.loadURL(devServerUrl ?? APP_ENTRY_URL);
  mainWindow = win;
}

if (!app.requestSingleInstanceLock()) {
  log('second instance: exiting');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('second-instance: focusing existing window');
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  void app.whenReady().then(() => {
    log(`ready mode=${devServerUrl ? 'dev' : 'prod'}`);
    serveAppProtocol();
    lockDownSession();
    registerIpc(ipcMain, createInvokeHandler({ routes, isTrustedUrl, log }));
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
