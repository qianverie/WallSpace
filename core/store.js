'use strict';
// Local-only persistence. No collection, history or credential ever leaves this machine.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  favorites: [],
  history: [],
  settings: {
    style: 'fill',
    genre: 'all',
    sort: 'relevance',
    tone: 'any',
    ratio: 'any',
    query: '',
    lastWallpaper: null,
    lockScreenSync: false,
    autoStart: false
  },
  credentials: {
    unsplash: '', pexels: '', wallhaven: '', proxy: '',
    aiProvider: 'openai', aiBaseUrl: '', aiApiKey: '', aiModel: '',
    serperKey: '', braveKey: ''
  },
  desktop: { undo: null, profiles: {} },
  motionLibrary: [],
  customFolders: []
};

class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'state.json');
    fs.mkdirSync(dir, { recursive: true });
    this.state = this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Object.assign({}, structuredClone(DEFAULTS), parsed, {
        settings: Object.assign({}, DEFAULTS.settings, parsed.settings || {}),
        credentials: Object.assign({}, DEFAULTS.credentials, parsed.credentials || {}),
        desktop: Object.assign({}, DEFAULTS.desktop, parsed.desktop || {})
      });
    } catch (e) {
      return structuredClone(DEFAULTS);
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  snapshot() { return structuredClone(this.state); }

  setSettings(patch) {
    Object.assign(this.state.settings, patch || {});
    this.save();
    return this.state.settings;
  }

  setCredentials(patch) {
    Object.assign(this.state.credentials, patch || {});
    this.save();
    return { ok: true };
  }

  setFolders(list) {
    this.state.customFolders = Array.isArray(list) ? list : [];
    this.save();
  }

  setDesktop(patch) {
    const previous = this.state.desktop;
    this.state.desktop = { ...previous, ...patch };
    try { this.save(); }
    catch (error) { this.state.desktop = previous; throw error; }
  }

  mergeLibrary(favorites, profiles) {
    const previous = this.state;
    const merged = new Map(previous.favorites.map(item => [item.id, item]));
    for (const item of favorites) {
      const existing = merged.get(item.id);
      if (!existing) merged.set(item.id, item);
      else if (item.localPath && existing.localPath && !fs.existsSync(existing.localPath)) {
        merged.set(item.id, { ...item, ...(existing.customName ? { customName: existing.customName } : {}) });
      }
    }
    this.state = {
      ...previous, favorites: [...merged.values()],
      desktop: { ...previous.desktop, profiles: { ...profiles, ...previous.desktop.profiles } }
    };
    try { this.save(); }
    catch (error) { this.state = previous; throw error; }
    return this.state.favorites;
  }

  setMotionLibrary(files) {
    const previous = this.state.motionLibrary;
    this.state.motionLibrary = files;
    try { this.save(); }
    catch (error) { this.state.motionLibrary = previous; throw error; }
  }

  isFavorite(id) { return this.state.favorites.some(f => f.id === id); }

  toggleFavorite(item) {
    const i = this.state.favorites.findIndex(f => f.id === item.id);
    if (i >= 0) this.state.favorites.splice(i, 1);
    else this.state.favorites.unshift(pick(item));
    this.save();
    return { favorited: i < 0, favorites: this.state.favorites };
  }

  renameFavorite(id, name) {
    const index = this.state.favorites.findIndex(item => item.id === id);
    if (index < 0) return { ok: false, code: 'NOT_FAVORITE' };
    if (typeof name !== 'string') return { ok: false, code: 'INVALID_NAME' };
    const customName = name.trim();
    if (customName.length > 60 || (customName && !/[\p{L}\p{N}]/u.test(customName)) || /[\r\n]/.test(customName)) {
      return { ok: false, code: 'INVALID_NAME' };
    }
    const previous = this.state.favorites;
    const renamed = { ...previous[index] };
    if (customName && customName !== renamed.title) renamed.customName = customName;
    else delete renamed.customName;
    this.state.favorites = previous.map((item, i) => i === index ? renamed : item);
    try { this.save(); }
    catch (error) { this.state.favorites = previous; throw error; }
    return { ok: true, favorites: this.state.favorites };
  }

  favorites() { return this.state.favorites; }

  pushHistory(item) {
    this.state.history = [Object.assign({ at: Date.now() }, pick(item))]
      .concat(this.state.history.filter(h => h.id !== item.id)).slice(0, 60);
    this.state.settings.lastWallpaper = item.id;
    this.save();
    return this.state.history;
  }
}

function pick(i) {
  return {
    id: i.id, source: i.source, title: i.title, author: i.author,
    sourceLabel: i.sourceLabel, description: i.description, license: i.license, tone: i.tone,
    tags: i.tags, tagsCn: i.tagsCn, genres: i.genres, medium: i.medium, date: i.date, stats: i.stats,
    thumbUrl: i.thumbUrl, fullUrl: i.fullUrl, localPath: i.localPath,
    pageUrl: i.pageUrl, width: i.width, height: i.height, ratio: i.ratio,
    sizeFromThumb: i.sizeFromThumb, ext: i.ext
  };
}

module.exports = { Store, pick };
