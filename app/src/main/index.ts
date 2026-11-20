import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BrowserWindow, type WebContents, app, dialog, ipcMain, net, protocol, session } from 'electron';
import { BOOT_CONFIG_FILE_NAME } from './boot/config';
import { devOverrides } from './boot/devOverrides';
import { bootDataStore } from './boot/start';
import { createClaudeChecker, findClaude, findOnPath } from './claude/detect';
import { bundledNativeBindingPath } from './db/open';
import { createBusyLock, createInvokeHandler, registerIpc } from './ipc/router';
import { createRoutes } from './ipc/routes';
import { createEnvCheck } from './onboarding/envCheck';
import type { FolderPolicyContext } from './onboarding/folders';
import { type MainBootState, type PickFolder, createOnboarding } from './onboarding/service';
import { createSources } from './sources/service';
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

/**
 * 시작 때 DB 상태. 실패해도 창은 띄우고 상태만 보관한다(오류 상태는 S-01 대신 원인·다시 시도, 위치 재지정은 task-015).
 * 경로·오류 원문은 Renderer로 보내지 않는다. 첫 실행에서 onboarding.setDataDir가 ready로 바꾼다.
 */
let bootState: MainBootState = null;
const bootOptions = () => ({ nativeBinding: bundledNativeBindingPath(__dirname) });
const configFilePath = () => path.join(app.getPath('userData'), BOOT_CONFIG_FILE_NAME);

async function bootDatabase(): Promise<void> {
  try {
    bootState = await bootDataStore(configFilePath(), bootOptions());
  } catch (error) {
    console.error('[ssr] boot failed', error);
    bootState = { kind: 'error', reason: 'boot_failed' };
  }
  if (bootState.kind === 'ready') {
    const { cleanup, open, warnings, switched } = bootState;
    log(
      `db ready user_version=${open.to} migrated_from=${open.from} cleanup=${JSON.stringify(cleanup)}` +
        ` warnings=${warnings.join(',') || 'none'}${switched ? ` switched=${JSON.stringify(switched)}` : ''}`,
    );
  } else {
    log(`db not opened: ${bootState.kind === 'error' ? bootState.reason : bootState.kind}`);
  }
}

// ---- IPC 서비스(A-01·데이터 위치·A-02) ----
const overrides = devOverrides(app.isPackaged, process.env, findOnPath(process.env, 'node.exe'));
const exclusive = createBusyLock();
const policy = (): FolderPolicyContext => ({ env: process.env, home: os.homedir(), userData: app.getPath('userData') });

const pickFolder: PickFolder = async (sender) => {
  if (overrides.pickDir) return overrides.pickDir;
  const win = BrowserWindow.fromWebContents(sender as WebContents);
  const options: Electron.OpenDialogOptions = { properties: ['openDirectory', 'dontAddToRecent'] };
  const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
};

/** CLI 실행 cwd = 앱 소유 폴더(userData). */
const checkClaude = createClaudeChecker(() => {
  const cwd = app.getPath('userData');
  mkdirSync(cwd, { recursive: true });
  return { launcher: overrides.claude ?? findClaude(process.env), cwd, env: process.env };
});

const envCheck = createEnvCheck({ state: () => bootState, reboot: bootDatabase, checkClaude, log });

const onboarding = createOnboarding({
  state: {
    get: () => bootState,
    set: (next) => {
      bootState = next;
    },
  },
  get configFile() {
    return configFilePath();
  },
  get policy() {
    return policy();
  },
  pickFolder,
  exclusive,
  get bootOptions() {
    return bootOptions();
  },
  log,
});

const sources = createSources({
  store: () => (bootState?.kind === 'ready' ? { db: bootState.open.db, dataDir: bootState.dataDir } : null),
  get policy() {
    return policy();
  },
  pickFolder,
  exclusive,
  log,
});

const routes = createRoutes({ envCheck, setDataDir: onboarding.setDataDir, sources });

function closeDatabase(): void {
  if (bootState?.kind === 'ready' && bootState.open.db.open) {
    bootState.open.db.close();
    log('db closed');
  }
}

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

  app.on('will-quit', closeDatabase);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  void app.whenReady().then(async () => {
    log(`ready mode=${devServerUrl ? 'dev' : 'prod'}`);
    serveAppProtocol();
    lockDownSession();
    registerIpc(ipcMain, createInvokeHandler({ routes, isTrustedUrl, log }));
    await bootDatabase();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
