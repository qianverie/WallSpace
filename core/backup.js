'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pick } = require('./store');
const { topologyKey, matchDisplayLayout } = require('./desktop');

const FORMAT = 'wallspace-library';
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_ASSET_BYTES = 90 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const list = value => Array.isArray(value);
const record = value => value && typeof value === 'object' && !list(value);
const text = (value, limit) => typeof value === 'string' && value.length <= limit;
const assetId = value => text(value, 64) && /^[0-9a-f]{64}$/.test(value);

function check(condition, code = 'BACKUP_INVALID') {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function imageExtension(bytes) {
  if (bytes.length < 16) return null;
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return '.jpg';
  if (bytes.toString('ascii', 0, 2) === 'BM') return '.bmp';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return '.webp';
  return null;
}

function validHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
}

function framingEntries(value) {
  check(list(value) && value.length <= 10000);
  return value.map(entry => {
    check(list(entry) && entry.length === 2);
    const [id, frame] = entry;
    check(text(id, 8192) && id && record(frame) &&
      [frame.x, frame.y, frame.zoom].every(Number.isFinite) &&
      frame.zoom >= 0.25 && frame.zoom <= 5 && Math.abs(frame.x) <= 100 && Math.abs(frame.y) <= 100);
    return [id, { x: frame.x, y: frame.y, zoom: frame.zoom }];
  });
}

function favoriteFields(item) {
  check(record(item) && text(item.id, 8192) && item.id && text(item.title, 8192) && text(item.source, 100));
  const favorite = pick(item);
  for (const [key, value] of Object.entries(favorite)) {
    if (['tags', 'tagsCn', 'genres'].includes(key)) {
      favorite[key] = list(value) ? value.filter(word => text(word, 256)).slice(0, 128) : [];
    } else if (key === 'stats') {
      favorite.stats = record(value)
        ? Object.fromEntries(Object.entries(value).filter(([key, number]) => text(key, 80) && Number.isFinite(number)).slice(0, 24))
        : undefined;
    } else if (key === 'ext') {
      favorite.ext = typeof value === 'string' && /^\.(?:jpg|jpeg|png|webp|bmp)$/i.test(value) ? value : undefined;
    } else if (key !== 'localPath' && value != null) {
      if (key === 'width' || key === 'height') check(Number.isFinite(value) && value > 0);
      else if (key === 'sizeFromThumb') check(typeof value === 'boolean');
      else check(text(value, 16384));
    }
  }
  delete favorite.localPath;
  if (text(item.customName, 60) && /[\p{L}\p{N}]/u.test(item.customName) && !/[\r\n]/.test(item.customName)) {
    favorite.customName = item.customName;
  }
  return favorite;
}

function portableProfile(profile) {
  check(record(profile) && Number.isInteger(profile.position) && profile.position >= 0 && profile.position <= 5 &&
    Number.isInteger(profile.color) && profile.color >= 0 && profile.color <= 0xffffff &&
    list(profile.monitors) && profile.monitors.length > 0 && profile.monitors.length <= 32);
  const ids = new Set();
  return {
    position: profile.position, color: profile.color, flags: 0,
    monitors: profile.monitors.map(monitor => {
      check(record(monitor) && text(monitor.id, 2048) && monitor.id && !ids.has(monitor.id.toLowerCase()) &&
        ['x', 'y', 'width', 'height'].every(key => Number.isSafeInteger(monitor[key]) && Math.abs(monitor[key]) <= 65536) &&
        monitor.width > 0 && monitor.height > 0);
      ids.add(monitor.id.toLowerCase());
      const { id, x, y, width, height } = monitor;
      return { id, x, y, width, height };
    })
  };
}

async function atomicWrite(file, contents) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, contents, { flag: 'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

function createBackup({ store, desktop, imageDirectory }) {
  async function exportTo(file, savedFramings) {
    const { favorites, desktop: { profiles } } = store.snapshot();
    const assets = new Map();
    const references = new Map();
    let totalBytes = 0;
    async function collect(image) {
      if (references.has(image)) return references.get(image);
      const size = (await fs.stat(image).catch(() => ({ size: 0 }))).size;
      check(size, 'BACKUP_IMAGE_MISSING');
      check(size <= MAX_ASSET_BYTES, 'BACKUP_TOO_LARGE');
      const bytes = await fs.readFile(image);
      check(imageExtension(bytes), 'BACKUP_IMAGE_UNSUPPORTED');
      const id = hash(bytes);
      if (!assets.has(id)) {
        totalBytes += bytes.length;
        check(totalBytes <= MAX_ASSET_BYTES, 'BACKUP_TOO_LARGE');
        assets.set(id, bytes.toString('base64'));
      }
      references.set(image, id);
      return id;
    }

    const favoriteItems = [];
    for (const item of favorites) {
      const favorite = favoriteFields(item);
      if (item.localPath) {
        favorite.asset = await collect(item.localPath);
        delete favorite.fullUrl;
        delete favorite.thumbUrl;
        delete favorite.pageUrl;
        delete favorite.description;
      } else {
        check(validHttps(item.fullUrl), 'BACKUP_IMAGE_UNSUPPORTED');
      }
      favoriteItems.push(favorite);
    }
    const displayProfiles = [];
    for (const profile of Object.values(profiles)) {
      const layout = portableProfile(profile);
      for (const [index, monitor] of profile.monitors.entries()) {
        layout.monitors[index].asset = monitor.wallpaper ? await collect(desktop.resolveWallpaper(monitor)) : null;
      }
      displayProfiles.push(layout);
    }
    const framings = framingEntries(savedFramings);
    const contents = JSON.stringify({
      format: FORMAT, version: 1, favorites: favoriteItems, framings, profiles: displayProfiles,
      assets: Object.fromEntries(assets)
    });
    check(Buffer.byteLength(contents) <= MAX_BYTES, 'BACKUP_TOO_LARGE');
    await atomicWrite(file, contents);
    return { favorites: favoriteItems.length, framings: framings.length, profiles: displayProfiles.length };
  }

  async function importFrom(file) {
    const stat = await fs.stat(file);
    check(stat.isFile() && stat.size <= MAX_BYTES, 'BACKUP_TOO_LARGE');
    const source = await fs.readFile(file, 'utf8');
    let backup;
    try { backup = JSON.parse(source); }
    catch { check(false); }
    check(record(backup) && backup.format === FORMAT && backup.version === 1 && list(backup.favorites) &&
      backup.favorites.length <= 10000 && list(backup.profiles) && backup.profiles.length <= 256 && record(backup.assets));
    const framings = framingEntries(backup.framings);
    const assets = new Map();
    let totalBytes = 0;
    for (const [id, encoded] of Object.entries(backup.assets)) {
      check(assetId(id) && typeof encoded === 'string');
      const bytes = Buffer.from(encoded, 'base64');
      totalBytes += bytes.length;
      check(totalBytes <= MAX_ASSET_BYTES, 'BACKUP_TOO_LARGE');
      const extension = imageExtension(bytes);
      check(extension && hash(bytes) === id && encoded === bytes.toString('base64'));
      assets.set(id, { bytes, file: path.join(imageDirectory, 'import-' + id + extension) });
    }
    const used = new Set();
    function resolveAsset(id) {
      check(assetId(id) && assets.has(id));
      used.add(id);
      return assets.get(id).file;
    }
    const favorites = backup.favorites.map(item => {
      const favorite = favoriteFields(item);
      if (item.asset) {
        favorite.localPath = resolveAsset(item.asset);
        favorite.thumbUrl = favorite.fullUrl = 'wsp://local/' + encodeURIComponent(favorite.localPath);
        delete favorite.pageUrl;
      } else {
        check(validHttps(favorite.fullUrl));
        if (!validHttps(favorite.thumbUrl)) favorite.thumbUrl = favorite.fullUrl;
        if (!validHttps(favorite.pageUrl)) delete favorite.pageUrl;
      }
      return favorite;
    });
    const current = backup.profiles.length ? await desktop.read().catch(() => null) : null;
    const profiles = {};
    let unmatched = 0;
    for (const sourceProfile of backup.profiles) {
      const profile = portableProfile(sourceProfile);
      const matches = current ? matchDisplayLayout(profile.monitors, current.monitors) : null;
      profile.portable = true;
      if (!matches) unmatched++;
      profile.monitors.forEach((monitor, index) => {
        if (matches) monitor.id = matches[index].id;
        const asset = sourceProfile.monitors[index].asset;
        monitor.wallpaper = asset === null ? '' : resolveAsset(asset);
      });
      profiles[topologyKey(profile.monitors)] = profile;
    }
    await fs.mkdir(imageDirectory, { recursive: true });
    for (const id of used) {
      const asset = assets.get(id);
      const existing = await fs.readFile(asset.file).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (!existing?.equals(asset.bytes)) await atomicWrite(asset.file, asset.bytes);
    }
    return {
      favorites: store.mergeLibrary(favorites, profiles), framings, unmatched,
      count: { favorites: favorites.length, framings: framings.length, profiles: Object.keys(profiles).length }
    };
  }

  return { exportTo, importFrom };
}

module.exports = { createBackup };
