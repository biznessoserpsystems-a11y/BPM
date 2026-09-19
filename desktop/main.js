// Bizness-Ph-OS desktop shell.
//
// This is deliberately a THIN CLIENT: a branded native window pointing at
// wherever your Bizness-Ph-OS server is running (a LAN server, a hosted
// instance — see docs/offline-deployment.md and docs/deployment-checklist.md
// in the main project). It does NOT bundle the Next.js app, Prisma, or a
// database inside it.
//
// Why: this system is multi-branch and multi-user, with every POS sale,
// transfer, and journal entry sharing one ledger. An installer that bundled
// its own local server+database would give every machine its own isolated
// copy of the data — silently breaking shared inventory, transfers between
// branches, and the accounting books the moment more than one till is in
// use. One shared server, many thin desktop clients, is the correct shape
// for how this system is actually used.

const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(app.getPath('userData'), 'server-config.json');
const APP_TITLE = 'Bizness-Ph-OS';

let mainWindow = null;

function readServerUrl() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return typeof parsed.serverUrl === 'string' ? parsed.serverUrl : null;
  } catch {
    return null;
  }
}

function writeServerUrl(url) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ serverUrl: url }, null, 2));
}

function normalizeUrl(input) {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  // Strip a trailing slash so we don't end up with a double slash later.
  return url.replace(/\/+$/, '');
}

// A tiny local HTML page (not loaded from the server) for the first-run
// setup and for "can't reach the server" — so a connection problem shows a
// branded, helpful screen instead of Electron/Chromium's default network
// error page, and so it still works even when the server truly is
// unreachable.
function buildLocalPage({ heading, message, showRetry, prefillUrl }) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${APP_TITLE}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0F2A20; color: #EAF3EE;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { background: #16362A; border: 1px solid #2F7D5A; border-radius: 12px; padding: 40px; max-width: 440px; text-align: center; }
  h1 { color: #4CAF7D; font-size: 20px; margin: 0 0 8px; }
  p { color: #B9C9C0; font-size: 14px; line-height: 1.5; }
  input { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 6px; border: 1px solid #2F7D5A;
          background: #0F2A20; color: #EAF3EE; font-size: 14px; margin: 16px 0 12px; }
  button { width: 100%; padding: 10px 12px; border-radius: 6px; border: none; background: #2F7D5A; color: white;
           font-size: 14px; font-weight: 600; cursor: pointer; }
  button:hover { background: #368a63; }
  .secondary { background: transparent; border: 1px solid #2F7D5A; margin-top: 8px; }
  .secondary:hover { background: #1d4636; }
</style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${message}</p>
    <input id="url" type="text" placeholder="e.g. 192.168.1.20:3000 or https://your-server" value="${prefillUrl || ''}" />
    <button onclick="connect()">Connect</button>
    ${showRetry ? '<button class="secondary" onclick="window.desktop.retry()">Retry current server</button>' : ''}
  </div>
  <script>
    function connect() {
      const val = document.getElementById('url').value;
      if (val.trim()) window.desktop.setServerUrl(val.trim());
    }
    document.getElementById('url').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  </script>
</body>
</html>`;
}

function showSetupScreen(message) {
  const html = buildLocalPage({
    heading: 'Connect to your Bizness-Ph-OS server',
    message: message || 'Enter the address of the server your pharmacy runs on. Ask whoever set up the system if you\u2019re not sure — it usually looks like a local network address (e.g. 192.168.1.20:3000) or a web address your organization was given.',
    showRetry: false,
  });
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function showOfflineScreen(serverUrl) {
  const html = buildLocalPage({
    heading: 'Can\u2019t reach the server',
    message: `Bizness-Ph-OS couldn\u2019t connect to <strong>${serverUrl}</strong>. Check that the server is running and that this computer is on the same network, then retry — or enter a different address below.`,
    showRetry: true,
    prefillUrl: serverUrl,
  });
  mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function connectToServer(url) {
  const serverUrl = normalizeUrl(url);
  if (!serverUrl) return;
  writeServerUrl(serverUrl);
  mainWindow.loadURL(serverUrl).catch(() => showOfflineScreen(serverUrl));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#0F2A20',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The server itself is what enforces auth/data access (see the main
      // app's own security hardening) — this window is just a browser
      // shell around it, so it gets no special privileges of its own.
    },
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode) => {
    // -3 is Chromium's ERR_ABORTED, which fires on normal navigations
    // (e.g. a client-side redirect) — not a real connection failure.
    if (errorCode === -3) return;
    const current = readServerUrl();
    if (current) showOfflineScreen(current);
  });

  // Open links the app points at an external site (e.g. a "learn more"
  // reference link) in the OS browser instead of inside this window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const existingUrl = readServerUrl();
  if (existingUrl) {
    mainWindow.loadURL(existingUrl).catch(() => showOfflineScreen(existingUrl));
  } else {
    showSetupScreen();
  }

  buildMenu();
}

function buildMenu() {
  const template = [
    {
      label: APP_TITLE,
      submenu: [
        {
          label: 'Change Server\u2026',
          click: () => showSetupScreen('Enter a new server address.'),
        },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => {
          const url = readServerUrl();
          if (url) connectToServer(url); else showSetupScreen();
        } },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Bizness-Ph-OS',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'About Bizness-Ph-OS',
            message: APP_TITLE,
            detail: `Version ${app.getVersion()}\nConnected server: ${readServerUrl() || 'not set'}`,
          }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on('desktop:set-server-url', (_event, url) => connectToServer(url));
ipcMain.on('desktop:retry', () => {
  const url = readServerUrl();
  if (url) connectToServer(url);
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
