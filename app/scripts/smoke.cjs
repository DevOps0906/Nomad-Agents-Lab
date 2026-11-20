// 개발용 스모크: 빌드된 out/main을 그대로 띄워 CSP 위반·Fluent(Griffel) 스타일 적용을 측정하고 화면을 저장한다.
// 사용: npm run build && npx electron scripts/smoke.cjs <출력폴더>
// 패키지된 앱에는 포함되지 않는다(electron-builder files 는 out/** 만).
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outDir = path.resolve(process.argv[2] ?? 'smoke-out');
fs.mkdirSync(outDir, { recursive: true });
const violations = [];

app.on('browser-window-created', (_event, win) => {
  const contents = win.webContents;
  contents.on('console-message', (event) => {
    if (/Content Security Policy|Refused/i.test(event.message)) violations.push(event.message);
  });
  contents.once('did-finish-load', async () => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const probe = await contents.executeJavaScript(`(() => {
      const tab = document.querySelector('[role="tab"]');
      const provider = document.querySelector('.fui-FluentProvider');
      const nav = document.querySelector('nav');
      const styleTags = [...document.querySelectorAll('style')];
      return {
        styleTagCount: styleTags.length,
        styleTagRules: styleTags.map((s) => { try { return s.sheet ? s.sheet.cssRules.length : -1; } catch { return -2; } }),
        styleTagTextLength: styleTags.map((s) => s.textContent.length),
        providerVar: provider ? getComputedStyle(provider).getPropertyValue('--colorNeutralBackground1').trim() : null,
        navBackground: nav ? getComputedStyle(nav).backgroundColor : null,
        navDisplay: nav && nav.parentElement ? getComputedStyle(nav.parentElement).display : null,
        tabDisplay: tab ? getComputedStyle(tab).display : null,
        tabPadding: tab ? getComputedStyle(tab).padding : null,
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        rootTextBody: getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim(),
        hasSsrApi: typeof window.ssr === 'object' && typeof window.ssr.invoke === 'function',
        hasRequire: typeof window.require,
        hasProcess: typeof window.process,
      };
    })()`);
    probe.unknownPathResult = await contents.executeJavaScript(`window.ssr.invoke('env.check')`);
    probe.directIpcResult = await contents.executeJavaScript(`typeof window.ipcRenderer`);
    probe.windowOpen = await contents.executeJavaScript(`String(window.open('https://example.com'))`);
    probe.violations = violations;
    probe.url = contents.getURL();
    fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(probe, null, 2));
    const image = await contents.capturePage();
    fs.writeFileSync(path.join(outDir, 'window.png'), image.toPNG());
    console.log(JSON.stringify(probe, null, 2));
    app.quit();
  });
});

require(path.join(__dirname, '../out/main/index.js'));
