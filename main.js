'use strict';
const {
  app, BrowserWindow, ipcMain, Tray, Menu, globalShortcut, nativeImage,
  protocol, screen, shell, dialog, session
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { Store } = require('./core/store');
const providers = require('./core/providers');
const wallpaper = require('./core/wallpaper');
const { createDesktop } = require('./core/desktop');
const { createMotion } = require('./core/motion');
const aiSearch = require('./core/ai-search');
const { download } = require('./core/fetch');

const ROOT = __dirname;
const APP_ICON = path.join(ROOT, 'assets', 'wallscape.ico');
const IN_ASAR = ROOT.includes('app.asar');
// Portable build: app.asar is read-only, so all writable state lives beside
// the runtime, not inside the archive. WSP_BASE is set by 启动.cmd.
const BASE = process.env.WSP_BASE
  ? path.resolve(process.env.WSP_BASE)
  : (IN_ASAR ? path.resolve(ROOT, '..', '..', '..') : ROOT);
const DATA = path.join(BASE, 'data');
const CACHE = path.join(BASE, 'cache');

const SELFTEST = Boolean(
  process.env.WS_SHOT === '1' || process.env.WS_SELFTEST === '1' ||
  process.env.WS_SEARCH || process.env.WS_MODE
);
// Self-check runs coexist with a user-launched instance: isolate BOTH the
// Electron userData (single-instance lock / Chromium cache) AND the app state,
// so a probe never reads or overwrites the user's filters and window bounds.
if (SELFTEST) app.setPath('userData', path.join(DATA, 'selftest-profile'));
const STATE_DIR = SELFTEST ? path.join(DATA, 'selftest-state') : DATA;
fs.mkdirSync(STATE_DIR, { recursive: true });
const store = new Store(STATE_DIR);
fs.mkdirSync(CACHE, { recursive: true });
app.isQuitting = false;

protocol.registerSchemesAsPrivileged([
  { scheme: 'wsp', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

let win = null;
let tray = null;
let items = [];
let sourcesState = [];
let wallhavenWarmupTimer = null, wallhavenPending = null;
let sourcesRevision = 0;
const WALLHAVEN_WARM_TARGET = 360;
const WALLHAVEN_WARM_MAX_PAGE = 18;
let lastAppliedId = null;
let applying = false;
let displayTimer;
let displayStatus = null;
let displayRead = null;
let displayRevision = 0;
let rebuilding = false;
let windowMode = store.state.settings.windowMode === 'window' ? 'window' : 'immersive';
// Self-check override: WS_MODE=window proves a standard framed window renders.
if (process.env.WS_MODE === 'window' || process.env.WS_MODE === 'immersive') {
  windowMode = process.env.WS_MODE;
}

/* ---------- current wallpaper as an in-memory data URL for the paper layer ---------- */
function currentWallpaperDataUrl(preferred) {
  const transcoded = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
  const candidates = [preferred, store.state.settings.lastWallpaperPath, transcoded].filter(Boolean);
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      let img = nativeImage.createFromPath(p);
      if (img.isEmpty()) {
        const hinted = path.join(CACHE, 'paper-hint.jpg');
        fs.copyFileSync(p, hinted);
        img = nativeImage.createFromPath(hinted);
      }
      if (img.isEmpty()) continue;
      const w = img.getSize().width;
      return (w > 1400 ? img.resize({ width: 1400 }) : img).toDataURL();
    } catch (e) { /* try next candidate */ }
  }
  return null;
}

/* ---------- window: immersive (frameless fullscreen) or standard window ---------- */
function saveBounds() {
  if (!win || win.isDestroyed() || windowMode !== 'window') return;
  try { store.setSettings({ windowBounds: win.getBounds() }); } catch (e) { /* ignore */ }
}

function primaryDisplayMetrics() {
  const display = screen.getPrimaryDisplay();
  const b = display.bounds;
  const wa = display.workArea;
  const sf = display.scaleFactor || 1;
  const rawAspect = b.height > 0 ? b.width / b.height : 16 / 9;
  const aspect = Math.max(0.5, Math.min(3.6, rawAspect));
  const maxW = Math.max(900, Math.round(wa.width * 0.78));
  const maxH = Math.max(600, Math.round(wa.height * 0.78));
  let width = maxW;
  let height = Math.round(width / aspect);
  if (height > maxH) {
    height = maxH;
    width = Math.round(height * aspect);
  }
  return {
    display,
    bounds: b,
    workArea: wa,
    scaleFactor: sf,
    aspect,
    physicalWidth: Math.round(b.width * sf),
    physicalHeight: Math.round(b.height * sf),
    defaultWidth: width,
    defaultHeight: height
  };
}

function createWindow() {
  const immersive = windowMode !== 'window';
  const metrics = primaryDisplayMetrics();
  const { display, bounds: b, workArea: wa, aspect } = metrics;
  const saved = store.state.settings.windowBounds;
  const opts = {
    // Both modes stay frameless: the integrated editorial surface must not
    // grow a Windows title bar / menu strip when switching to window mode.
    frame: false,
    fullscreen: immersive,
    resizable: !immersive,
    backgroundColor: '#000000',
    show: false,
    title: 'WALL／SCAPE',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  };
  if (immersive) {
    // FULLSCREEN must use the entire display bounds. A hard 1600x1000 cap
    // left the window at ~70% of a high-DPI screen even with fullscreen:true.
    opts.x = b.x; opts.y = b.y;
    opts.width = b.width; opts.height = b.height;
  } else {
    const savedValid = saved && Number.isFinite(saved.width) && Number.isFinite(saved.height) &&
      saved.width >= 900 && saved.height >= 560;
    const savedRatio = savedValid ? saved.width / saved.height : 0;
    const ratioMatches = savedValid && Math.abs(savedRatio - aspect) <= 0.03;
    opts.width = ratioMatches ? saved.width : metrics.defaultWidth;
    opts.height = ratioMatches ? saved.height : metrics.defaultHeight;
    opts.minWidth = Math.min(960, Math.round(600 * aspect));
    opts.minHeight = Math.min(640, Math.round(opts.minWidth / aspect));
    // Never restore a stale position that pins the frameless window to a
    // corner or off-screen; centre it instead.
    const inBounds = ratioMatches && Number.isFinite(saved.x) && Number.isFinite(saved.y) &&
      saved.x >= wa.x - 40 && saved.y >= wa.y - 40 &&
      saved.x + opts.width <= wa.x + wa.width + 80 &&
      saved.y + opts.height <= wa.y + wa.height + 80;
    if (inBounds) {
      opts.x = saved.x; opts.y = saved.y;
    } else {
      opts.center = true;
    }
  }
  win = new BrowserWindow(opts);
  win.on('focus', () => refreshDisplayStatus(true));
  // WINDOW is a uniformly scaled copy matching the primary display's real aspect ratio.
  if (!immersive) {
    try { win.setAspectRatio(aspect); } catch (e) { /* unsupported */ }
  }
  if (SELFTEST) {
    fs.writeFileSync(path.join(DATA, 'selfcheck-window.json'), JSON.stringify({
      mode: windowMode, frame: opts.frame, fullscreen: opts.fullscreen,
      resizable: opts.resizable, width: opts.width, height: opts.height
    }, null, 2));
  }
  win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (windowMode !== 'window') {
      // Second guard: some Windows/DPI combinations ignore the constructor
      // flag when an explicit size was supplied.
      try {
        const b = screen.getPrimaryDisplay().bounds;
        win.setFullScreen(true);
        win.setBounds(b);
      } catch (e) { /* unsupported */ }
    }
    win.show(); win.focus();
  });
  win.on('close', e => {
    if (windowMode === 'window') saveBounds();
    if (!app.isQuitting && !rebuilding) { e.preventDefault(); win.hide(); }
  });
  win.on('moved', saveBounds);
  // Dragging a frameless edge does not always dispatch a DOM resize event;
  // push an explicit signal so the 16:9 stage always re-scales in sync.
  const notifyResize = () => {
    if (win && !win.isDestroyed()) win.webContents.send('window:resized');
  };
  win.on('resized', () => { saveBounds(); notifyResize(); });
  win.on('maximize', notifyResize);
  win.on('unmaximize', notifyResize);
  win.on('restore', notifyResize);
  win.on('enter-full-screen', notifyResize);
  win.on('leave-full-screen', notifyResize);
}

// Electron cannot toggle `frame` on a live BrowserWindow, so switching modes
// rebuilds the window. Tray, shortcuts and IPC all reference `win` lazily.
function setWindowMode(mode) {
  const next = mode === 'window' ? 'window' : 'immersive';
  if (next === windowMode) return { ok: true, mode: windowMode };
  saveBounds();
  windowMode = next;
  // The renderer is destroyed by the rebuild; park the receipt so the new
  // window can show it on bootstrap.
  store.setSettings({
    windowMode: next,
    pendingFeedback: next === 'window' ? 'modeWindow' : 'modeFullscreen'
  });
  rebuilding = true;
  const old = win;
  win = null;
  try { if (old && !old.isDestroyed()) old.destroy(); } catch (e) { /* ignore */ }
  createWindow();
  rebuilding = false;
  return { ok: true, mode: next };
}

function showWindow() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  try { win.moveTop(); } catch (e) { /* ignore */ }
  win.focus();
}

/* ---------- tray + shortcuts ---------- */
function buildTray() {
  tray = new Tray(APP_ICON);
  tray.setToolTip('WALL／SCAPE — 双击显示');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => win && (win.isVisible() ? win.hide() : showWindow()) },
    { label: '窗口模式 / 沉浸模式', click: () => setWindowMode(windowMode === 'window' ? 'immersive' : 'window') },
    { type: 'separator' },
    { label: '下一张', click: () => step(1) },
    { label: '上一张', click: () => step(-1) },
    { label: '收藏当前', click: () => favoriteCurrent() },
    { type: 'separator' },
    { label: '退出', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => showWindow());
}

function registerShortcuts() {
  const pairs = [
    ['CommandOrControl+Alt+W', () => win && (win.isVisible() ? win.hide() : showWindow())],
    ['CommandOrControl+Alt+M', () => setWindowMode(windowMode === 'window' ? 'immersive' : 'window')],
    ['CommandOrControl+Alt+Right', () => step(1)],
    ['CommandOrControl+Alt+Left', () => step(-1)],
    ['CommandOrControl+Alt+S', () => favoriteCurrent()]
  ];
  for (const [acc, fn] of pairs) {
    try { globalShortcut.register(acc, fn); } catch (e) { /* occupied */ }
  }
}

/* ---------- image materialisation ---------- */
const imageDownloads = new Map();

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_GC_INTERVAL_MS = 12 * 60 * 60 * 1000;
let cacheGcStartupTimer = null;
let cacheGcInterval = null;

function touchFile(file) {
  try {
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch (e) { /* ignore */ }
}

function downloadImage(url, dest) {
  if (!imageDownloads.has(dest)) {
    const browserSession = win?.webContents.session || session.defaultSession;
    const pending = download(url, dest, (input, options) => browserSession.fetch(input, options))
      .finally(() => imageDownloads.delete(dest));
    imageDownloads.set(dest, pending);
  }
  return imageDownloads.get(dest);
}

function extFor(url) {
  const m = String(url).split('?')[0].match(/\.(jpe?g|png|webp|bmp)$/i);
  return m ? (m[1].toLowerCase() === 'jpeg' ? '.jpg' : '.' + m[1].toLowerCase()) : '.jpg';
}

async function findImageSource(item, progress) {
  let source = null;
  let cachedDownload = false;
  if (item.localPath && fs.existsSync(item.localPath)) {
    source = item.localPath;
  } else {
    const url = item.fullUrl;
    if (url.startsWith('wsp://local/')) {
      const p = decodeURIComponent(new URL(url).pathname).replace(/^\//, '');
      if (!fs.existsSync(p)) throw new Error('local file missing: ' + p);
      source = p;
    } else {
      const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 18);
      const ext = item.ext || extFor(url);
      const dest = path.join(CACHE, hash + ext);
      if (!fs.existsSync(dest)) {
        progress?.('download');
        await downloadImage(url, dest);
      } else {
        touchFile(dest);
      }
      source = dest;
      cachedDownload = true;
    }
  }
  return { source, cachedDownload };
}

async function normalizeImage({ source, cachedDownload }) {
  // Content/extension mismatches (WebP or PNG bytes saved as .jpg) and a
  // partially downloaded file are the main causes of a failing first apply.
  // Validate the bytes really decode, then hand Windows ONE canonical PNG.
  let img = null;
  try { img = nativeImage.createFromPath(source); } catch (e) { /* invalid */ }
  if ((!img || img.isEmpty()) && win && !win.isDestroyed()) {
    // Chromium also supports the local-library formats that nativeImage
    // cannot decode directly, including BMP and WebP.
    try {
      const bytes = fs.readFileSync(source).toString('base64');
      const png = await win.webContents.executeJavaScript(`(async () => {
        const image = new Image();
        image.src = "data:application/octet-stream;base64," + ${JSON.stringify(bytes)};
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        return canvas.toDataURL("image/png");
      })()`);
      img = nativeImage.createFromDataURL(png);
    } catch (e) { /* Handle undecodable input below. */ }
  }
  if (!img || img.isEmpty()) {
    if (cachedDownload) { try { fs.unlinkSync(source); } catch (e) { /* ignore */ } }
    throw new Error('image is not decodable (incomplete download or unsupported format)');
  }
  const normalizedBytes = img.toPNG();
  const key = crypto.createHash('sha1').update(normalizedBytes).digest('hex').slice(0, 18);
  const normalized = path.join(CACHE, 'applied-' + key + '.png');
  if (!fs.existsSync(normalized)) fs.writeFileSync(normalized, normalizedBytes);
  else touchFile(normalized);
  return { source: normalized, ...img.getSize() };
}

async function prepareDesktopImage(item, progress) {
  const local = await findImageSource(item, progress);
  progress?.('prepare');
  // JPEG, PNG and BMP can go directly to the background compositor. A
  // full-resolution intermediate PNG is only needed for other formats.
  const measured = await wallpaper.run('measure', { image: local.source });
  if (measured.ok) return { source: local.source, width: measured.width, height: measured.height };
  return normalizeImage(local);
}

const desktop = createDesktop({
  directory: path.join(STATE_DIR, 'desktop'), store, engine: wallpaper, prepareImage: prepareDesktopImage,
  async decode(file) {
    const size = await wallpaper.run('measure', { image: file });
    if (!size.ok) throw new Error(size.error || 'Unable to decode desktop image');
    return { width: size.width, height: size.height };
  }
});

const motion = createMotion({
  BrowserWindow, dialog, root: ROOT, store, readDesktop: desktop.read,
  notify(active) {
    if (win && !win.isDestroyed()) win.webContents.send('motion:active', active);
  }
});

function cacheStats(activeDesktop = null) {
  let bytes = 0, count = 0;
  const pinned = desktop.pinnedFiles(activeDesktop);
  if (fs.existsSync(CACHE)) {
    for (const f of fs.readdirSync(CACHE)) {
      const p = path.join(CACHE, f);
      if (pinned.has(path.resolve(p).toLowerCase())) continue;
      try {
        const st = fs.statSync(p);
        if (st.isFile()) { bytes += st.size; count++; }
      } catch (e) { /* file vanished */ }
    }
  }
  const composed = desktop.reclaimableImageStats(activeDesktop);
  return { bytes: bytes + composed.bytes, count: count + composed.count };
}

async function pruneCaches(maxAgeMs = CACHE_TTL_MS) {
  const activeDesktop = await desktop.read().catch(() => null);
  const pinned = desktop.pinnedFiles(activeDesktop);
  const now = Date.now();
  let removed = 0;
  if (fs.existsSync(CACHE)) {
    for (const f of fs.readdirSync(CACHE)) {
      const p = path.join(CACHE, f);
      if (pinned.has(path.resolve(p).toLowerCase())) continue;
      try {
        const st = fs.statSync(p);
        if (!st.isFile()) continue;
        if (maxAgeMs > 0 && now - st.mtimeMs < maxAgeMs) continue;
        fs.unlinkSync(p);
        removed++;
      } catch (e) { /* in use or vanished */ }
    }
  }
  // Only prune data/desktop/images when we have confirmed active monitor wallpapers
  // (or on explicit manual clear where pinned still protects lastWallpaper/undo/profiles).
  if (activeDesktop || maxAgeMs === 0) {
    removed += desktop.pruneImages({ maxAgeMs, activeDesktop }).removed;
  }
  return Object.assign({ ok: true, removed }, cacheStats(activeDesktop));
}

/* ---------- apply ---------- */
function notifyDesktopChanged(result) {
  if (!result?.desktop) return;
  const primary = result.desktop.monitors.find(m => m.x === 0 && m.y === 0) || result.desktop.monitors[0];
  const primaryChanged = primary.wallpaper !== store.state.settings.lastWallpaperPath;
  if (primaryChanged) store.setSettings({ lastWallpaperPath: primary.wallpaper });
  if (win && !win.isDestroyed()) {
    win.webContents.send('wallpaper:changed', {
      ...(primaryChanged ? { background: primary.wallpaper ? currentWallpaperDataUrl(primary.wallpaper) : null } : {}),
      history: store.state.history,
      undoAvailable: Boolean(store.state.desktop.undo)
    });
  }
}

async function applyItem(item, opts = {}) {
  const style = opts.style || store.state.settings.style || 'fill';
  let result;
  try { result = await desktop.apply(item, { ...opts, style }); }
  catch (error) { return { ok: false, code: error.code, error: error.message }; }
  if (!result.ok) return result;
  motion.stop(style === 'span' ? null : opts.monitorId);
  let lock = null;
  if (opts.syncLock) lock = await wallpaper.run('lock', { image: result.source });

  store.pushHistory(item);
  store.setSettings({ style, lastWallpaper: item.id });
  lastAppliedId = item.id;
  notifyDesktopChanged(result);
  return { ok: true, item, style, lock, targetCount: result.targetCount };
}

async function runDesktopAction(action) {
  if (applying) return { ok: false, error: 'A wallpaper operation is already in progress' };
  applying = true;
  try {
    const result = await action();
    if (result?.ok) notifyDesktopChanged(result);
    return result && { ok: result.ok, error: result.error, undoAvailable: Boolean(store.state.desktop.undo) };
  } catch (error) {
    return { ok: false, error: error.message, undoAvailable: Boolean(store.state.desktop.undo) };
  } finally { applying = false; }
}

function refreshDisplayStatus(force = false) {
  if (displayRead && !force) return displayRead;
  const revision = ++displayRevision;
  displayRead = wallpaper.run('status').then(status => {
    if (revision !== displayRevision) return null;
    displayStatus = status;
    if (win && !win.isDestroyed()) win.webContents.send('displays:changed', status);
    if (status.ok && status.monitors?.some(m => m.active)) motion.displaysChanged(status.monitors);
    return status;
  }).finally(() => {
    if (revision === displayRevision) displayRead = null;
  });
  return displayRead;
}

function onDisplaysChanged() {
  clearTimeout(displayTimer);
  displayTimer = setTimeout(async () => {
    if (win && !win.isDestroyed() && windowMode === 'window') {
      try { win.setAspectRatio(primaryDisplayMetrics().aspect); } catch (e) { /* ignore */ }
    }
    const status = await refreshDisplayStatus(true);
    if (status?.ok && !SELFTEST && Object.keys(store.state.desktop.profiles).length) {
      if (applying) { onDisplaysChanged(); return; }
      await runDesktopAction(() => desktop.restoreProfile(true));
    }
  }, 250);
}

async function step(delta) {
  if (applying || !items.length) return;
  const at = items.findIndex(i => i.id === lastAppliedId);
  const next = ((at < 0 ? 0 : at + delta) + items.length) % items.length;
  applying = true;
  try { await applyItem(items[next]); } finally { applying = false; }
}

async function favoriteCurrent() {
  const item = items.find(entry => entry.id === lastAppliedId) ||
    store.state.history.find(entry => entry.id === lastAppliedId) || items[0];
  if (!item) return;
  const r = store.toggleFavorite(item);
  if (win) win.webContents.send('tray:command', { type: 'favorite', id: item.id, favorited: r.favorited, favorites: r.favorites });
}

/* ---------- data ---------- */
async function loadSources() {
  const revision = ++sourcesRevision;
  const r = await providers.loadAll({
    cacheDir: DATA,
    credentials: store.state.credentials,
    folders: store.state.customFolders,
    onWallhaven: ({ items: fresh, status }) => {
      if (revision !== sourcesRevision) return;
      items = withWallhavenItems(items, fresh);
      sourcesState = sourcesState.some(source => source.id === 'wallhaven')
        ? sourcesState.map(source => source.id === 'wallhaven' ? status : source)
        : sourcesState.concat(status);
      if (win && !win.isDestroyed()) win.webContents.send('wallhaven:updated', { added: fresh, status, replace: true });
      scheduleWallhavenWarmup();
    }
  });
  if (revision !== sourcesRevision) return { items, sources: sourcesState };
  const current = wallhavenSource();
  items = withWallhavenItems(r.items, items.filter(item => item.source === 'wallhaven'));
  sourcesState = r.sources.map(source => source.id === 'wallhaven' ? current : source);
  scheduleWallhavenWarmup();
  return { items, sources: sourcesState };
}

function withWallhavenItems(catalog, wallhavenItems) {
  return catalog.filter(item => item.source === 'bing').concat(wallhavenItems,
    catalog.filter(item => item.source !== 'bing' && item.source !== 'wallhaven'));
}

function wallhavenSource() {
  return sourcesState.find(entry => entry.id === 'wallhaven');
}

function appendWallhavenPage(source) {
  if (wallhavenPending?.source === source) return wallhavenPending.promise;
  const promise = providers.wallhavenPage({ page: source.nextPage }).then(result => {
    if (!sourcesState.includes(source)) return null;
    const ids = new Set(items.map(item => item.id));
    const added = result.items.filter(item => !ids.has(item.id) && ids.add(item.id));
    items = items.concat(added);
    const status = { ...source, nextPage: result.nextPage, total: result.total || source.total,
      count: source.count + added.length, ok: true, error: null, stale: false };
    sourcesState = sourcesState.map(entry => entry === source ? status : entry);
    providers.saveWallhavenIndex(DATA, items.filter(item => item.source === 'wallhaven'), status);
    return { added, status };
  }).finally(() => { if (wallhavenPending?.promise === promise) wallhavenPending = null; });
  wallhavenPending = { source, promise };
  return promise;
}

function scheduleWallhavenWarmup(attempt = 0, delay = 1800) {
  const source = wallhavenSource();
  if (wallhavenWarmupTimer || !source?.ok || !source.nextPage ||
      source.count >= WALLHAVEN_WARM_TARGET || source.nextPage > WALLHAVEN_WARM_MAX_PAGE) return;
  wallhavenWarmupTimer = setTimeout(async () => {
    wallhavenWarmupTimer = null;
    if (app.isQuitting) return;
    if (wallhavenSource() !== source) { scheduleWallhavenWarmup(); return; }
    try {
      const update = await appendWallhavenPage(source);
      if (update && win && !win.isDestroyed()) win.webContents.send('wallhaven:updated', update);
      scheduleWallhavenWarmup();
    } catch (error) {
      if (attempt < 2 && (error.code === 'ECONNRESET' || /^timeout|^HTTP 5/.test(error.message))) {
        scheduleWallhavenWarmup(attempt + 1, (attempt + 1) * 6000);
      } else console.log('[wallhaven] background paging paused: ' + (error.message || error));
    }
  }, delay);
}

function publicCredentials() {
  const c = store.state.credentials || {};
  return {
    unsplash: Boolean(c.unsplash),
    pexels: Boolean(c.pexels),
    wallhaven: Boolean(c.wallhaven),
    proxy: Boolean(c.proxy),
    aiProvider: c.aiProvider === 'gemini' ? 'gemini' : 'openai',
    aiBaseUrl: String(c.aiBaseUrl || ''),
    aiModel: String(c.aiModel || ''),
    aiApiKey: Boolean(c.aiApiKey),
    serperKey: Boolean(c.serperKey),
    braveKey: Boolean(c.braveKey)
  };
}

function bootstrapPayload() {
  const settings = Object.assign({}, store.state.settings, { windowMode });
  try { settings.autoStart = app.getLoginItemSettings().openAtLogin; } catch (e) { /* unsupported */ }
  const metrics = primaryDisplayMetrics();
  return {
    items, sources: sourcesState,
    settings,
    display: {
      width: metrics.physicalWidth,
      height: metrics.physicalHeight,
      logicalWidth: metrics.bounds.width,
      logicalHeight: metrics.bounds.height,
      aspect: metrics.aspect
    },
    favorites: store.state.favorites,
    history: store.state.history,
    credentials: publicCredentials(),
    folders: store.state.customFolders,
    undoAvailable: Boolean(store.state.desktop.undo),
    background: currentWallpaperDataUrl(),
    runtime: { electron: process.versions.electron || 'unknown', node: process.versions.node }
  };
}

/* ---------- IPC ---------- */
ipcMain.handle('app:bootstrap', async () => {
  // Instant first paint from the local index. Network work is pushed later,
  // so a slow or offline source can no longer leave the window blank.
  const cached = providers.loadCached(DATA, store.state.credentials, store.state.customFolders);
  items = cached.items;
  sourcesState = cached.sources;
  const payload = { ...bootstrapPayload(), status: displayStatus };
  payload.loading = true;

  (async () => {
    const loaded = loadSources();
    const push = extra => {
      if (win && !win.isDestroyed()) win.webContents.send('bootstrap:ready', extra);
    };
    try {
      await loaded;
      push(bootstrapPayload());
    } catch (e) {
      console.log('[bootstrap] online refresh failed: ' + (e.message || e));
      push(bootstrapPayload());
    }
  })();

  return payload;
});

ipcMain.handle('sources:refresh', () => loadSources());
ipcMain.handle('sources:search', (_e, { query, genre, filters } = {}) =>
  providers.searchOnline(store.state.credentials, query, 'all', genre, filters));

ipcMain.handle('sources:wallhavenMore', async (_e, { query, page, genre, filters } = {}) => {
  const term = typeof query === 'string' ? query.trim().slice(0, 120) : '';
  if (term || (genre && genre !== 'all') || (filters?.ratio && filters.ratio !== 'any') ||
      (filters?.resolution && filters.resolution !== 'any')) {
    return providers.wallhavenPage({ ...filters, query: term, page, genre });
  }
  const source = wallhavenSource();
  if (!source?.nextPage || source.nextPage !== page) return { items, sources: sourcesState };
  await appendWallhavenPage(source);
  scheduleWallhavenWarmup();
  return { items, sources: sourcesState };
});

ipcMain.handle('item:apply', async (event, payload) => {
  if (applying) return { ok: false, error: '另一个应用操作正在进行' };
  applying = true;
  const progress = stage => {
    if (!event.sender.isDestroyed()) event.sender.send('wallpaper:applyProgress', stage);
  };
  try { return await applyItem(payload.item, { ...payload, progress }); } finally { applying = false; }
});
ipcMain.handle('desktop:undo', () => runDesktopAction(desktop.undo));
ipcMain.handle('desktop:saveProfile', () => runDesktopAction(desktop.saveProfile));
ipcMain.handle('desktop:restoreProfile', () => runDesktopAction(desktop.restoreProfile));

ipcMain.handle('item:saveAs', async (_e, item) => {
  let src;
  try { ({ source: src } = await normalizeImage(await findImageSource(item))); }
  catch (e) { return { ok: false, error: String(e.message || e) }; }
  const ext = path.extname(src) || '.jpg';
  const safe = String(item.title || 'wallpaper').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
  let defaultPath = safe + ext;
  try { defaultPath = path.join(app.getPath('pictures'), safe + ext); } catch (e) { /* fallback */ }
  const r = await dialog.showSaveDialog(win, {
    defaultPath,
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.copyFileSync(src, r.filePath);
  return { ok: true, path: r.filePath, bytes: fs.statSync(r.filePath).size };
});

ipcMain.handle('item:favorite', (_e, item) => store.toggleFavorite(item));
ipcMain.handle('item:renameFavorite', (_e, { id, name }) => store.renameFavorite(id, name));
ipcMain.handle('motion:library', () => ({ items: motion.library(), active: motion.active() }));
ipcMain.handle('motion:import', () => motion.importFiles(win));
ipcMain.handle('motion:search', (_e, query, language) => motion.browse(query, language));
ipcMain.handle('motion:preview', (_e, id) => motion.preview(id));
ipcMain.handle('motion:play', async (_e, { id, monitorId }) => {
  if (applying) throw new Error('Another wallpaper operation is already in progress');
  applying = true;
  try { return await motion.play(id, monitorId); }
  finally { applying = false; }
});
ipcMain.handle('motion:stop', (_e, monitorId) => {
  if (!monitorId || applying) return motion.active();
  return motion.stop(monitorId);
});
ipcMain.handle('settings:set', (_e, patch) => store.setSettings(patch));
ipcMain.handle('window:setMode', (_e, { mode } = {}) => setWindowMode(mode));
ipcMain.handle('window:toggleMode', () => setWindowMode(windowMode === 'window' ? 'immersive' : 'window'));
ipcMain.handle('window:mode', () => ({ mode: windowMode }));

ipcMain.handle('settings:autostart', (_e, { enabled } = {}) => {
  const on = Boolean(enabled);
  try {
    app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: IN_ASAR ? [] : [ROOT] });
  } catch (e) {
    return { ok: false, enabled: on, actual: false, error: e.message };
  }
  store.setSettings({ autoStart: on });
  let actual = false;
  try { actual = app.getLoginItemSettings().openAtLogin; } catch (e) { /* unsupported */ }
  return { ok: true, enabled: on, actual };
});

ipcMain.handle('cache:info', async () => {
  const activeDesktop = await desktop.read().catch(() => null);
  return Object.assign({ ok: true }, cacheStats(activeDesktop));
});
ipcMain.handle('cache:clear', () => pruneCaches(0));

ipcMain.handle('engine:lockProbe', () => wallpaper.run('probe'));

ipcMain.handle('credentials:set', async (_e, patch) => {
  const safe = patch && typeof patch === 'object' ? patch : {};
  store.setCredentials(safe);
  const reloadCatalog = ['unsplash', 'pexels', 'wallhaven', 'proxy'].some(k => Object.hasOwn(safe, k));
  if (reloadCatalog) {
    const r = await loadSources();
    return { ok: true, sources: r.sources, items: r.items, credentials: publicCredentials() };
  }
  return { ok: true, credentials: publicCredentials() };
});

ipcMain.handle('ai:search', async (_e, { prompt, context } = {}) => {
  const browserSession = win?.webContents.session || session.defaultSession;
  const fetchFn = (input, options) => browserSession.fetch(input, options);
  return aiSearch.search({
    prompt,
    credentials: store.state.credentials,
    context: context || {},
    providers,
    fetchFn
  });
});

ipcMain.handle('ai:test', async (_e, draft = {}) => {
  const browserSession = win?.webContents.session || session.defaultSession;
  const fetchFn = (input, options) => browserSession.fetch(input, options);
  const merged = Object.assign({}, store.state.credentials);
  if (draft && typeof draft === 'object') {
    if (draft.aiProvider) merged.aiProvider = draft.aiProvider;
    if (typeof draft.aiBaseUrl === 'string') merged.aiBaseUrl = draft.aiBaseUrl.trim();
    if (typeof draft.aiModel === 'string') merged.aiModel = draft.aiModel.trim();
    if (typeof draft.aiApiKey === 'string' && draft.aiApiKey.trim()) merged.aiApiKey = draft.aiApiKey.trim();
  }
  return aiSearch.testConnection(merged, fetchFn);
});

ipcMain.handle('folders:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  if (r.canceled) return { ok: false, folders: store.state.customFolders };
  const next = [...new Set([...store.state.customFolders, ...r.filePaths])];
  store.setFolders(next);
  const loaded = await loadSources();
  return { ok: true, folders: next, items: loaded.items, sources: loaded.sources };
});

ipcMain.handle('status:read', (_event, force) => refreshDisplayStatus(force === true));
ipcMain.handle('shell:open', (_e, url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
  return true;
});
/* Native drag fallback. app-region hit-testing inside a transformed stage is
   unreliable, so the masthead drives the frameless window from the main
   process using real screen coordinates. */
let dragOrigin = null;
ipcMain.on('window:dragStart', () => {
  if (!win || win.isDestroyed() || windowMode !== 'window') return;
  const b = win.getBounds();
  const p = screen.getCursorScreenPoint();
  dragOrigin = { px: p.x, py: p.y, bx: b.x, by: b.y, w: b.width, h: b.height };
});
ipcMain.on('window:dragMove', () => {
  if (!dragOrigin || !win || win.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  try {
    win.setBounds({
      x: dragOrigin.bx + (p.x - dragOrigin.px),
      y: dragOrigin.by + (p.y - dragOrigin.py),
      width: dragOrigin.w, height: dragOrigin.h
    });
  } catch (e) { dragOrigin = null; }
});
ipcMain.on('window:dragEnd', () => { dragOrigin = null; });

ipcMain.handle('window:hide', () => { if (win) win.hide(); return true; });
ipcMain.handle('window:fullscreen', () => setWindowMode(windowMode === 'window' ? 'immersive' : 'window'));
ipcMain.handle('window:quit', () => { app.isQuitting = true; app.quit(); return true; });

/* ---------- lifecycle ---------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(() => {
    protocol.handle('wsp', async req => {
      const url = new URL(req.url);
      if (url.hostname === 'motion') return motion.serve(req);
      const p = decodeURIComponent(url.pathname).replace(/^\//, '');
      try {
        const st = await fs.promises.stat(p);
        if (!st.isFile()) return new Response('not found', { status: 404 });
        const ext = path.extname(p).toLowerCase();
        const ct = ext === '.png' ? 'image/png'
          : ext === '.webp' ? 'image/webp'
            : ext === '.bmp' ? 'image/bmp' : 'image/jpeg';
        return new Response(Readable.toWeb(fs.createReadStream(p)), {
          headers: { 'content-type': ct, 'content-length': String(st.size) }
        });
      } catch (e) {
        return new Response('not found', { status: 404 });
      }
    });
    wallpaper.warmup();
    if (!SELFTEST) {
      cacheGcStartupTimer = setTimeout(() => {
        cacheGcStartupTimer = null;
        pruneCaches(CACHE_TTL_MS).catch(() => {});
      }, 5000);
      cacheGcStartupTimer.unref();
      cacheGcInterval = setInterval(() => {
        pruneCaches(CACHE_TTL_MS).catch(() => {});
      }, CACHE_GC_INTERVAL_MS);
      cacheGcInterval.unref();
    }
    createWindow();
    buildTray();
    registerShortcuts();
    screen.on('display-added', onDisplaysChanged);
    screen.on('display-removed', onDisplaysChanged);
    screen.on('display-metrics-changed', (_event, _display, metrics) => {
      if (metrics.some(metric => ['bounds', 'rotation', 'scaleFactor'].includes(metric))) onDisplaysChanged();
    });

    // Opt-in self-check hooks. Normal launches never run them.
    if (process.env.WS_SHOT === '1' || process.env.WS_SELFTEST === '1' ||
        process.env.WS_SEARCH || process.env.WS_DRAG === '1') {
      win.webContents.once('did-finish-load', () => {
        const dp = screen.getPrimaryDisplay();
        console.log('[selfcheck] display=' + JSON.stringify({
          bounds: dp.bounds, workArea: dp.workArea, scaleFactor: dp.scaleFactor
        }));
        console.log('[selfcheck] windowMode=' + windowMode +
          ' fullscreen=' + win.isFullScreen() +
          ' bounds=' + JSON.stringify(win.getBounds()));
        if (process.env.WS_DRAG === '1') {
          setTimeout(() => {
            // The probe must actually receive the OS mouse events.
            win.show(); win.focus(); win.moveTop();
            try { win.setAlwaysOnTop(true); } catch (e) { /* ignore */ }
            const before = win.getBounds();
            const nh = win.getNativeWindowHandle();
            before.hwnd = nh ? Number(nh.length >= 8 ? nh.readBigUInt64LE(0) : nh.readUInt32LE(0)) : null;
            fs.writeFileSync(path.join(DATA, 'selfcheck-drag-before.json'), JSON.stringify(before));
            console.log('[selfcheck] drag before=' + JSON.stringify(before));
          }, 4500);
          setTimeout(() => {
            const after = win.getBounds();
            fs.writeFileSync(path.join(DATA, 'selfcheck-drag-after.json'), JSON.stringify(after));
            console.log('[selfcheck] drag after=' + JSON.stringify(after));
            app.isQuitting = true; app.quit();
          }, 11000);
        }
        if (process.env.WS_RESIZE === '1') {
          setTimeout(() => {
            const before = win.getBounds();
            try {
              win.setBounds({ x: before.x, y: before.y, width: 1200, height: 675 });
              console.log('[selfcheck] resize ' + JSON.stringify(before) + ' -> ' + JSON.stringify(win.getBounds()));
            } catch (e) { console.log('[selfcheck] resize failed ' + e.message); }
          }, 5000);
        }
        if (process.env.WS_LANG) {
          setTimeout(() => {
            win.webContents.executeJavaScript(`setLanguage(${JSON.stringify(process.env.WS_LANG)})`)
              .then(() => console.log('[selfcheck] language=' + process.env.WS_LANG))
              .catch(e => console.log('[selfcheck] language failed: ' + e.message));
          }, 3500);
        }
        if (process.env.WS_SEARCH) {
          setTimeout(() => {
            const q = process.env.WS_SEARCH;
            win.webContents.executeJavaScript(`(() => {
              const el = document.getElementById('search');
              el.value = ${JSON.stringify(q)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              return 'injected';
            })()`).then(() => console.log('[selfcheck] search injected: ' + q))
              .catch(e => console.log('[selfcheck] search inject failed: ' + e.message));
          }, 4000);
        }
        if (process.env.WS_SHOT === '1') {
          setTimeout(() => {
            win.webContents.executeJavaScript(`(() => {
              const cards = [...document.querySelectorAll('.card')];
              const imgs = cards.map(c => {
                const i = c.querySelector('img');
                return { src: i && i.src, state: i && i.dataset.state, loaded: !!(i && i.classList.contains('is-loaded')), complete: !!(i && i.complete), nw: i && i.naturalWidth };
              });
              const stageEl = document.getElementById('stage');
              const searchEl = document.getElementById('search');
              const refreshEl = document.getElementById('btn-refresh');
              const logoEl = document.getElementById('logotype');
              const mastheadEl = document.getElementById('masthead');
              const curtainEl = document.getElementById('boot-curtain');
              refreshEl.dispatchEvent(new PointerEvent('pointerdown', {
                clientX: 120, clientY: 120, bubbles: true
              }));
              logoEl.dispatchEvent(new MouseEvent('mousemove', {
                clientX: 300, clientY: 90, bubbles: true
              }));
              const te = document.getElementById('toast');
              te.textContent = '已关闭';
              te.classList.add('is-on');
              te.style.transition = 'none';
              te.style.opacity = '1';
              te.style.transform = 'none';
              return JSON.stringify({
                cards: cards.length,
                loaded: imgs.filter(x => x.loaded).length,
                broken: cards.filter(c => c.classList.contains('is-broken')).length,
                gridTop: getComputedStyle(document.documentElement).getPropertyValue('--grid-top'),
                stageScale: getComputedStyle(document.documentElement).getPropertyValue('--stage-s'),
                stageTransform: getComputedStyle(stageEl).transform,
                stageUserSelect: getComputedStyle(stageEl).userSelect,
                searchUserSelect: getComputedStyle(searchEl).userSelect,
                modeWords: document.querySelectorAll('.mode-word').length,
                resolutionWords: document.querySelectorAll('#resolution-block .filter-word').length,
                suggestionsOpen: document.getElementById('suggestions').classList.contains('is-on'),
                suggestionCount: document.querySelectorAll('#suggestions .suggestion').length,
                frameDragRegion: getComputedStyle(document.getElementById('frame-drag-top')).webkitAppRegion,
                inkAfterClick: document.querySelectorAll('.ink').length,
                pressedAfterClick: document.querySelectorAll('.is-pressed').length,
                toastTop: getComputedStyle(document.getElementById('toast')).top,
                toastRight: getComputedStyle(document.getElementById('toast')).right,
                toastBlend: getComputedStyle(document.getElementById('toast')).mixBlendMode,
                toastBg: getComputedStyle(document.getElementById('toast')).backgroundColor,
                mastheadRegion: getComputedStyle(mastheadEl).webkitAppRegion,
                logoShift: getComputedStyle(logoEl).getPropertyValue('--logo-shift'),
                curtainClip: curtainEl ? getComputedStyle(curtainEl).clipPath : 'removed',
                searchValue: searchEl.value,
                searchResult: document.getElementById('search-result').textContent,
                first: imgs.slice(0, 5)
              });
            })()`).then(d => {
              fs.writeFileSync(path.join(DATA, 'selfcheck-dom.json'), d);
              console.log('[selfcheck] DOM ' + d.slice(0, 1200));
              // Chain the capture, and let Chromium commit a frame first.
              return new Promise(r => setTimeout(r, 320))
                .then(() => win.webContents.capturePage());
            }).then(img => {
              fs.writeFileSync(path.join(DATA, 'selfcheck.png'), img.toPNG());
              console.log('[selfcheck] screenshot written');
            }).catch(e => console.log('[selfcheck] shot failed: ' + e.message));
          }, 9000);
        }
        if (process.env.WS_SHOT === '1' && process.env.WS_SELFTEST !== '1') {
          setTimeout(() => { app.isQuitting = true; app.quit(); }, 12500);
        }
        if (process.env.WS_SELFTEST === '1') {
          setTimeout(async () => {
            try {
              if (!items.length) await loadSources();
              const item = items.find(i => i.source === 'bing') || items[0];
              const r = item ? await applyItem(item, { style: 'fill' }) : { ok: false, error: 'no items' };
              fs.writeFileSync(path.join(DATA, 'selfcheck-receipt.json'), JSON.stringify(r, null, 2));
              console.log('[selfcheck] apply ok=' + r.ok + ' ' + (r.error || ''));
            } catch (e) {
              console.log('[selfcheck] apply threw: ' + e.message);
            }
          }, 11000);
          setTimeout(() => { app.isQuitting = true; app.quit(); }, 15000);
        }
      });
    }
  });
}

app.on('before-quit', () => {
  clearTimeout(cacheGcStartupTimer);
  clearInterval(cacheGcInterval);
  motion.quit();
  wallpaper.dispose();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', e => { if (!app.isQuitting) e.preventDefault(); });
