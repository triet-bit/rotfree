const {
  app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, screen,
  nativeImage, nativeTheme, shell, protocol, net, Notification,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');

const HOTKEY = 'Control+Alt+N';
const IMG_SCHEME = 'fw-img';

// Let tests / portable setups point at a separate data folder.
if (process.env.FW_USER_DATA) app.setPath('userData', process.env.FW_USER_DATA);
if (process.env.FW_THEME) nativeTheme.themeSource = process.env.FW_THEME;

protocol.registerSchemesAsPrivileged([
  { scheme: IMG_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

const DATA_DIR = app.getPath('userData');
const DATA_FILE = path.join(DATA_DIR, 'workspace.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'window.json');
const IMG_DIR = path.join(DATA_DIR, 'images');

const MODES = {
  split: { w: 820, h: 660, minW: 640 },
  tasks: { w: 400, h: 660, minW: 340 },
  notes: { w: 400, h: 660, minW: 340 },
};
const MIN_H = 440;
const FOCUS_SIZE = { w: 380, h: 520, minW: 300, minH: 380 };

let win = null;
let tray = null;
let quitting = false;
let animating = false;
let animToken = 0;
let focusPrev = null; // window bounds to return to when focus mode ends

// ---------- persistence helpers ----------

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJSONAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, typeof value === 'string' ? value : JSON.stringify(value));
  fs.renameSync(tmp, file);
}

const settings = Object.assign(
  { mode: 'split', x: undefined, y: undefined, sizes: {}, alwaysOnTop: true },
  readJSON(SETTINGS_FILE, {}),
);
for (const m of Object.keys(MODES)) {
  settings.sizes[m] = Object.assign({ w: MODES[m].w, h: MODES[m].h }, settings.sizes[m]);
}
if (!MODES[settings.mode]) settings.mode = 'split';

let settingsTimer = null;
function saveSettings() {
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => writeJSONAtomic(SETTINGS_FILE, settings), 300);
}

// ---------- window geometry ----------

function clampToWorkArea(b) {
  const area = screen.getDisplayMatching(b).workArea;
  const w = Math.min(b.width, area.width);
  const h = Math.min(b.height, area.height);
  return {
    width: w,
    height: h,
    x: Math.round(Math.min(Math.max(b.x, area.x), area.x + area.width - w)),
    y: Math.round(Math.min(Math.max(b.y, area.y), area.y + area.height - h)),
  };
}

function initialBounds() {
  const size = settings.sizes[settings.mode];
  if (settings.x === undefined || settings.y === undefined) {
    const area = screen.getPrimaryDisplay().workArea;
    return clampToWorkArea({
      width: size.w, height: size.h,
      x: area.x + area.width - size.w - 40, y: area.y + 60,
    });
  }
  return clampToWorkArea({ x: settings.x, y: settings.y, width: size.w, height: size.h });
}

function rememberBounds() {
  if (!win || animating || focusPrev || win.isMinimized()) return;
  const b = win.getBounds();
  settings.x = b.x;
  settings.y = b.y;
  settings.sizes[settings.mode] = { w: b.width, h: b.height };
  saveSettings();
}

// Critically damped spring: fast start, settles without overshoot (window overshoot looks janky).
const spring = (t) => 1 - (1 + 9 * t) * Math.exp(-9 * t);

function animateTo(target, duration = 340) {
  return new Promise((resolve) => {
    const from = win.getBounds();
    const start = Date.now();
    const token = ++animToken; // a newer animation (rapid mode clicks) supersedes this one
    animating = true;
    const step = () => {
      if (!win || win.isDestroyed() || token !== animToken) return resolve();
      const t = Math.min(1, (Date.now() - start) / duration);
      const k = t === 1 ? 1 : spring(t);
      win.setBounds({
        x: Math.round(from.x + (target.x - from.x) * k),
        y: Math.round(from.y + (target.y - from.y) * k),
        width: Math.round(from.width + (target.width - from.width) * k),
        height: Math.round(from.height + (target.height - from.height) * k),
      });
      if (t < 1) setTimeout(step, 1000 / 60);
      else {
        animating = false;
        resolve();
      }
    };
    step();
  });
}

async function setMode(mode) {
  if (!MODES[mode] || !win || focusPrev) return settings.mode;
  const prev = settings.mode;
  if (prev === mode) return mode;
  rememberBounds();
  settings.mode = mode;

  const cur = win.getBounds();
  const size = settings.sizes[mode];
  // Keep the panel that stays visible where it is: the task panel lives on the left,
  // the note panel on the right — so anchor that edge while the window grows/shrinks.
  const anchorRight = mode === 'notes' || (mode === 'split' && prev === 'notes');
  const target = clampToWorkArea({
    width: size.w,
    height: cur.height,
    x: anchorRight ? cur.x + cur.width - size.w : cur.x,
    y: cur.y,
  });

  win.setMinimumSize(Math.min(MODES.tasks.minW, MODES[mode].minW, cur.width), MIN_H);
  if (win.isMaximized()) win.unmaximize();
  await animateTo(target);
  if (settings.mode !== mode) return settings.mode; // superseded by a later click
  win.setMinimumSize(MODES[mode].minW, MIN_H);
  rememberBounds();
  return mode;
}

// Focus mode: shrink to a small centred card, then return to exactly where the window was.
async function setFocusMode(on) {
  if (!win) return;
  if (on && !focusPrev) {
    rememberBounds();
    focusPrev = win.getBounds();
    if (win.isMaximized()) win.unmaximize();
    win.setMinimumSize(FOCUS_SIZE.minW, FOCUS_SIZE.minH);
    const b = focusPrev;
    await animateTo(clampToWorkArea({
      width: FOCUS_SIZE.w, height: FOCUS_SIZE.h,
      x: b.x + (b.width - FOCUS_SIZE.w) / 2, y: b.y,
    }));
  } else if (!on && focusPrev) {
    const back = focusPrev;
    focusPrev = null;
    win.setMinimumSize(Math.min(MODES.tasks.minW, MODES[settings.mode].minW, back.width), MIN_H);
    await animateTo(back);
    win.setMinimumSize(MODES[settings.mode].minW, MIN_H);
    rememberBounds();
  }
}

// ---------- window / tray ----------

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && win.isFocused() && !win.isMinimized()) win.hide();
  else showWindow();
}

function setAlwaysOnTop(on) {
  settings.alwaysOnTop = on;
  win?.setAlwaysOnTop(on, 'floating');
  win?.webContents.send('win:onTop', on);
  saveSettings();
  refreshTrayMenu();
}

function setLaunchAtLogin(on) {
  app.setLoginItemSettings({ openAtLogin: on });
  refreshTrayMenu();
  return app.getLoginItemSettings().openAtLogin;
}

function refreshTrayMenu() {
  if (!tray) return;
  const openAtLogin = app.getLoginItemSettings().openAtLogin;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show / Hide', accelerator: HOTKEY, click: toggleWindow },
    { type: 'separator' },
    { label: 'Always on Top', type: 'checkbox', checked: settings.alwaysOnTop, click: (i) => setAlwaysOnTop(i.checked) },
    { label: 'Launch at Login', type: 'checkbox', checked: openAtLogin, click: (i) => setLaunchAtLogin(i.checked) },
    { label: 'Open Data Folder', click: () => shell.openPath(DATA_DIR) },
    { type: 'separator' },
    { label: 'Quit', click: () => quitApp() },
  ]));
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(`Floating Workspace (${HOTKEY.replace('Control', 'Ctrl')})`);
  tray.on('click', toggleWindow);
  refreshTrayMenu();
}

function createWindow() {
  const b = initialBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: MODES[settings.mode].minW,
    minHeight: MIN_H,
    frame: false,
    show: false,
    resizable: true,
    alwaysOnTop: settings.alwaysOnTop,
    title: 'Floating Workspace',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C1E' : '#F5F5F8',
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (settings.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });

  // Links never navigate the app window: they open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
    }
  });

  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  for (const ev of ['moved', 'resized']) win.on(ev, rememberBounds);
  let resizeTimer = null;
  win.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rememberBounds, 400);
  });

  if (process.env.FW_AUTOTEST) runAutotest(process.env.FW_AUTOTEST);
}

// Dev-only hook: runs a script in the renderer, captures a screenshot, then quits.
function runAutotest(file) {
  win.webContents.on('console-message', (e) => console.log(`[renderer:${e.level}] ${e.message}`));
  win.webContents.once('did-finish-load', async () => {
    await new Promise((r) => setTimeout(r, 900));
    try {
      const result = await win.webContents.executeJavaScript(fs.readFileSync(file, 'utf8'));
      console.log('AUTOTEST RESULT:', JSON.stringify(result, null, 2));
    } catch (err) {
      console.log('AUTOTEST ERROR:', err.message);
    }
    await new Promise((r) => setTimeout(r, 600));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(`${file}.png`, img.toPNG());
    quitApp();
  });
}

let flushResolve = null;
async function quitApp() {
  if (win && !win.isDestroyed()) {
    // Give the renderer a moment to write any debounced edits.
    await new Promise((resolve) => {
      flushResolve = resolve;
      win.webContents.send('app:flush');
      setTimeout(resolve, 1500);
    });
  }
  quitting = true;
  app.quit();
}

// ---------- IPC ----------

ipcMain.handle('data:load', () => ({
  data: readJSON(DATA_FILE, null),
  mode: settings.mode,
  alwaysOnTop: settings.alwaysOnTop,
  launchAtLogin: app.getLoginItemSettings().openAtLogin,
  hotkey: HOTKEY,
}));

ipcMain.handle('data:save', (_e, json) => {
  writeJSONAtomic(DATA_FILE, json);
  return true;
});

ipcMain.handle('img:save', (_e, bytes, ext) => {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const safeExt = /^(png|jpe?g|gif|webp|bmp|svg)$/i.test(ext) ? ext.toLowerCase() : 'png';
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${safeExt}`;
  fs.writeFileSync(path.join(IMG_DIR, name), Buffer.from(bytes));
  return `${IMG_SCHEME}://local/${name}`;
});

ipcMain.handle('win:setMode', (_e, mode) => setMode(mode));
ipcMain.handle('win:toggleOnTop', () => {
  setAlwaysOnTop(!settings.alwaysOnTop);
  return settings.alwaysOnTop;
});
ipcMain.handle('win:setFocus', (_e, on) => setFocusMode(!!on));
ipcMain.handle('app:setLaunchAtLogin', (_e, on) => setLaunchAtLogin(!!on));
ipcMain.on('win:show', showWindow);
ipcMain.on('app:notify', (_e, title, body) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: String(title), body: String(body), silent: false });
  n.on('click', showWindow);
  n.show();
});
ipcMain.on('win:hide', () => win?.hide());
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('app:openExternal', (_e, url) => {
  if (/^https?:|^mailto:/i.test(url)) shell.openExternal(url);
});
ipcMain.on('app:flushed', () => flushResolve?.());

// ---------- lifecycle ----------

app.on('second-instance', showWindow);

app.whenReady().then(() => {
  if (process.platform === 'win32') app.setAppUserModelId('com.floatingworkspace.app');

  protocol.handle(IMG_SCHEME, (req) => {
    const name = path.basename(decodeURIComponent(new URL(req.url).pathname));
    return net.fetch(pathToFileURL(path.join(IMG_DIR, name)).toString());
  });

  createWindow();
  createTray();
  globalShortcut.register(HOTKEY, toggleWindow);
});

app.on('before-quit', () => {
  quitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {});
