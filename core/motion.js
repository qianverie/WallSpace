'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline');
const { Readable } = require('node:stream');

const MIME = { '.mp4': 'video/mp4', '.webm': 'video/webm' };
const FEATURED = [
  {
    slug: 'coastal-rain',
    titles: { zh: '海岸雨站', en: 'Coastal Rain', ja: '海辺の雨駅' },
    aspect: '16:9',
    tags: '横屏 雨夜 海岸 landscape rain coast 横長 雨 海辺'
  },
  {
    slug: 'cedar-lantern',
    titles: { zh: '林间灯火', en: 'Lantern Creek', ja: '森の灯火' },
    aspect: '9:16',
    tags: '竖屏 森林 萤火 portrait forest firefly 縦長 森 蛍'
  }
];
const hash = text => createHash('sha256').update(text).digest('hex').slice(0, 24);

function localItem(file) {
  return { id: 'local:' + hash(file.toLowerCase()), kind: 'local', title: path.basename(file, path.extname(file)), file };
}

function createMotion({ BrowserWindow, dialog, root, store, readDesktop, notify }) {
  const players = new Map();
  const media = new Map();
  const posters = new Map();
  const featured = FEATURED.map(scene => {
    const base = path.join(root, 'assets', 'motion', scene.slug);
    return { ...scene, id: 'studio:' + scene.slug, file: base + '.mp4', poster: base + '.jpg' };
  });
  const previews = new Map();
  let busy = false;
  let stopped = false;
  const host = process.env.WSP_LIVE_HOST || (root.includes('app.asar')
    ? path.join(path.dirname(root), '..', '..', 'engine', 'live-host.ps1')
    : path.join(root, 'core', 'live-host.ps1'));

  function register(file, mime) {
    const key = randomUUID();
    media.set(key, { file, mime });
    return { key, url: 'wsp://motion/' + key };
  }

  function library() {
    return store.state.motionLibrary.filter(file => MIME[path.extname(file).toLowerCase()] && fs.existsSync(file)).map(localItem);
  }

  function featuredTitle(item, language) {
    return item.titles[language] || item.titles.zh;
  }

  function getItem(id) {
    const item = featured.find(scene => scene.id === id);
    if (item) return { ...item, title: featuredTitle(item, store.state.settings.language) };
    return library().find(entry => entry.id === id);
  }

  async function serve(request) {
    const file = media.get(new URL(request.url).pathname.slice(1));
    if (!file) return new Response(null, { status: 404 });
    try {
      const { size } = await fs.promises.stat(file.file);
      const header = request.headers.get('range');
      let start = 0, end = size - 1;
      if (header) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(header);
        if (!range || (!range[1] && !range[2])) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
        if (range[1]) {
          start = Number(range[1]);
          if (range[2]) end = Math.min(end, Number(range[2]));
        } else start = Math.max(0, size - Number(range[2]));
        if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
      }
      const headers = {
        'Content-Type': file.mime, 'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'
      };
      if (header) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      const stream = request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(file.file, { start, end }));
      return new Response(stream, { status: header ? 206 : 200, headers });
    } catch { return new Response(null, { status: 404 }); }
  }

  function browse(query, language) {
    const words = String(query || '').trim().slice(0, 80).toLowerCase().split(/\s+/);
    return featured.filter(item => {
      const keywords = [...Object.values(item.titles), item.tags, item.aspect].join(' ').toLowerCase();
      return words.every(word => keywords.includes(word));
    }).map(item => {
      if (!posters.has(item.id)) posters.set(item.id, register(item.poster, 'image/jpeg'));
      return {
        id: item.id, kind: 'featured', title: featuredTitle(item, language),
        author: 'Wallscape', aspect: item.aspect, poster: posters.get(item.id).url
      };
    });
  }

  function localLibrary() {
    return library().map(({ id, kind, title }) => ({ id, kind, title }));
  }

  async function importFiles(window) {
    const picked = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'MP4 / WebM', extensions: ['mp4', 'webm'] }]
    });
    if (!picked.canceled) {
      const paths = new Map(store.state.motionLibrary.map(file => [file.toLowerCase(), file]));
      for (const file of picked.filePaths) if (MIME[path.extname(file).toLowerCase()]) paths.set(file.toLowerCase(), file);
      store.setMotionLibrary([...paths.values()]);
    }
    return localLibrary();
  }

  function preview(id) {
    const item = getItem(id);
    if (!item) throw new Error('Video is no longer available');
    if (!previews.has(id)) {
      previews.set(id, register(item.file, MIME[path.extname(item.file).toLowerCase()]));
    }
    return previews.get(id).url;
  }

  function active() {
    return [...players.values()].map(entry => ({ monitorId: entry.monitorId, title: entry.title, paused: entry.paused, reconnecting: !entry.window }));
  }

  function cleanup(entry) {
    const window = entry.window;
    entry.window = null;
    entry.native?.kill();
    entry.native = null;
    if (window && !window.isDestroyed()) window.destroy();
    if (entry.media) media.delete(entry.media.key);
    entry.media = null;
  }

  function stop(monitorId) {
    for (const [id, entry] of players) {
      if (monitorId && id !== monitorId) continue;
      players.delete(id);
      clearTimeout(entry.retry);
      cleanup(entry);
    }
    notify?.(active());
    return active();
  }

  async function launch(entry, bounds) {
    entry.bounds = bounds;
    entry.media = register(entry.file, MIME[path.extname(entry.file).toLowerCase()]);
    const window = new BrowserWindow({
      show: false, focusable: false, skipTaskbar: true, frame: false, backgroundColor: '#000000',
      enableLargerThanScreen: true,
      webPreferences: { backgroundThrottling: false, sandbox: true, contextIsolation: true }
    });
    entry.window = window;
    window.setIgnoreMouseEvents(true);
    window.on('closed', () => {
      if (entry.window === window) reconnect(entry);
    });
    await window.loadFile(path.join(root, 'renderer', 'motion-player.html'));
    await window.webContents.executeJavaScript(`startWallpaperVideo(${JSON.stringify(entry.media.url)})`);
    const handle = window.getNativeWindowHandle().readBigUInt64LE();
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', host,
      '-Window', String(handle), '-Owner', String(process.pid), '-X', String(bounds.x), '-Y', String(bounds.y),
      '-Width', String(bounds.width), '-Height', String(bounds.height)];
    await new Promise((resolve, reject) => {
      let attached = false;
      const child = spawn('powershell.exe', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      entry.native = child;
      const timer = setTimeout(() => reject(new Error('Timed out waiting for the Windows desktop layer')), 8000);
      const fail = error => { clearTimeout(timer); reject(error); };
      createInterface({ input: child.stdout }).on('line', line => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (entry.native !== child) return;
        if (message.state === 'attached') {
          // Win32 has placed the HWND below the icons. Mark it visible to
          // Chromium as well so the video compositor starts presenting.
          if (!window.isDestroyed()) window.showInactive();
          attached = true;
          clearTimeout(timer);
          resolve();
        } else if (message.state === 'failed') fail(new Error(message.error));
        else if (message.state === 'playback' && !window.isDestroyed()) {
          entry.paused = message.paused;
          window.webContents.executeJavaScript(`setWallpaperPaused(${Boolean(message.paused)})`).catch(() => {});
          notify?.(active());
        }
      });
      child.once('error', fail);
      child.once('exit', () => {
        if (entry.native !== child) return;
        if (attached) reconnect(entry);
        else fail(new Error('Could not start the Windows desktop layer'));
      });
    });
  }

  function reconnect(entry) {
    cleanup(entry);
    if (stopped || players.get(entry.monitorId) !== entry) return;
    notify?.(active());
    clearTimeout(entry.retry);
    entry.retry = setTimeout(async () => {
      if (stopped || players.get(entry.monitorId) !== entry) return;
      try {
        const desktop = await readDesktop();
        if (players.get(entry.monitorId) !== entry) return;
        const screen = desktop.monitors.find(m => m.id === entry.monitorId);
        if (!screen) return;
        await launch(entry, screen);
        notify?.(active());
      } catch { reconnect(entry); }
    }, 1700);
  }

  async function play(id, monitorId) {
    if (busy) throw new Error('Another video is being prepared');
    busy = true;
    let entry;
    try {
      const item = getItem(id);
      if (!item) throw new Error('Video is no longer available');
      const desktop = await readDesktop();
      const screen = desktop.monitors.find(m => m.id === monitorId);
      if (!screen || stopped) throw new Error('Selected display is no longer connected');
      entry = { monitorId, file: item.file, title: item.title, paused: false };
      await launch(entry, screen);
      if (stopped) throw new Error('Application is closing');
      stop(monitorId);
      players.set(monitorId, entry);
      notify?.(active());
      return active();
    } catch (error) {
      if (entry) cleanup(entry);
      throw error;
    } finally { busy = false; }
  }

  function displaysChanged(monitors) {
    if (!players.size) return;
    for (const entry of players.values()) {
      const current = monitors.find(m => m.active && m.id === entry.monitorId);
      if (!current) {
        clearTimeout(entry.retry);
        cleanup(entry);
      } else if (!entry.window || ['x', 'y', 'width', 'height'].some(key => current[key] !== entry.bounds[key])) {
        reconnect(entry);
      }
    }
    notify?.(active());
  }

  return {
    serve, browse, library: localLibrary, importFiles, preview, play, stop, active, displaysChanged,
    quit() { stopped = true; stop(); }
  };
}

module.exports = { createMotion };
