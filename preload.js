'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['wallpaper:changed', 'tray:command', 'sources:updated', 'wallhaven:updated', 'bootstrap:ready', 'window:resized']);

contextBridge.exposeInMainWorld('wsp', {
  dragStart: () => ipcRenderer.send('window:dragStart'),
  dragMove: () => ipcRenderer.send('window:dragMove'),
  dragEnd: () => ipcRenderer.send('window:dragEnd'),
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  refreshSources: () => ipcRenderer.invoke('sources:refresh'),
  searchSources: (query, genre, filters) => ipcRenderer.invoke('sources:search', { query, genre, filters }),
  wallhavenMore: (query, page, genre, filters) => ipcRenderer.invoke('sources:wallhavenMore', { query, page, genre, filters }),
  apply: payload => ipcRenderer.invoke('item:apply', payload),
  toggleFavorite: item => ipcRenderer.invoke('item:favorite', item),
  saveImageAs: item => ipcRenderer.invoke('item:saveAs', item),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  setCredentials: patch => ipcRenderer.invoke('credentials:set', patch),
  setAutoStart: enabled => ipcRenderer.invoke('settings:autostart', { enabled }),
  cacheInfo: () => ipcRenderer.invoke('cache:info'),
  cacheClear: () => ipcRenderer.invoke('cache:clear'),
  lockProbe: () => ipcRenderer.invoke('engine:lockProbe'),
  pickFolder: () => ipcRenderer.invoke('folders:pick'),
  readStatus: () => ipcRenderer.invoke('status:read'),
  openExternal: url => ipcRenderer.invoke('shell:open', url),
  hide: () => ipcRenderer.invoke('window:hide'),
  setWindowMode: mode => ipcRenderer.invoke('window:setMode', { mode }),
  toggleWindowMode: () => ipcRenderer.invoke('window:toggleMode'),
  getWindowMode: () => ipcRenderer.invoke('window:mode'),
  toggleFullscreen: () => ipcRenderer.invoke('window:toggleMode'),
  quit: () => ipcRenderer.invoke('window:quit'),
  on: (channel, fn) => {
    if (!EVENTS.has(channel)) return () => {};
    const listener = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
