'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['wallpaper:changed', 'wallpaper:applyProgress', 'tray:command', 'sources:updated', 'wallhaven:updated', 'bootstrap:ready', 'window:resized', 'displays:changed', 'motion:active']);

contextBridge.exposeInMainWorld('wsp', {
  dragStart: () => ipcRenderer.send('window:dragStart'),
  dragMove: () => ipcRenderer.send('window:dragMove'),
  dragEnd: () => ipcRenderer.send('window:dragEnd'),
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  refreshSources: () => ipcRenderer.invoke('sources:refresh'),
  searchSources: (query, genre, filters) => ipcRenderer.invoke('sources:search', { query, genre, filters }),
  aiSearch: (prompt, context) => ipcRenderer.invoke('ai:search', { prompt, context }),
  aiTest: draft => ipcRenderer.invoke('ai:test', draft),
  wallhavenMore: (query, page, genre, filters) => ipcRenderer.invoke('sources:wallhavenMore', { query, page, genre, filters }),
  apply: payload => ipcRenderer.invoke('item:apply', payload),
  undoWallpaper: () => ipcRenderer.invoke('desktop:undo'),
  saveDesktopProfile: () => ipcRenderer.invoke('desktop:saveProfile'),
  restoreDesktopProfile: () => ipcRenderer.invoke('desktop:restoreProfile'),
  toggleFavorite: item => ipcRenderer.invoke('item:favorite', item),
  renameFavorite: (id, name) => ipcRenderer.invoke('item:renameFavorite', { id, name }),
  saveImageAs: item => ipcRenderer.invoke('item:saveAs', item),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  setCredentials: patch => ipcRenderer.invoke('credentials:set', patch),
  setAutoStart: enabled => ipcRenderer.invoke('settings:autostart', { enabled }),
  cacheInfo: () => ipcRenderer.invoke('cache:info'),
  cacheClear: () => ipcRenderer.invoke('cache:clear'),
  lockProbe: () => ipcRenderer.invoke('engine:lockProbe'),
  pickFolder: () => ipcRenderer.invoke('folders:pick'),
  readStatus: (force = false) => ipcRenderer.invoke('status:read', force),
  openExternal: url => ipcRenderer.invoke('shell:open', url),
  hide: () => ipcRenderer.invoke('window:hide'),
  setWindowMode: mode => ipcRenderer.invoke('window:setMode', { mode }),
  toggleWindowMode: () => ipcRenderer.invoke('window:toggleMode'),
  getWindowMode: () => ipcRenderer.invoke('window:mode'),
  motionLibrary: () => ipcRenderer.invoke('motion:library'),
  importMotion: () => ipcRenderer.invoke('motion:import'),
  searchMotion: (query, language) => ipcRenderer.invoke('motion:search', query, language),
  previewMotion: id => ipcRenderer.invoke('motion:preview', id),
  playMotion: (id, monitorId) => ipcRenderer.invoke('motion:play', { id, monitorId }),
  stopMotion: monitorId => ipcRenderer.invoke('motion:stop', monitorId),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleMode'),
  quit: () => ipcRenderer.invoke('window:quit'),
  on: (channel, fn) => {
    if (!EVENTS.has(channel)) return () => {};
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
