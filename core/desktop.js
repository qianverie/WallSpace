'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DEFAULT_FRAMING, imagePlacement, monitorBounds, framingViewport } = require('../renderer/framing');

const WINDOWS_STYLES = ['center', 'tile', 'stretch', 'fit', 'fill', 'span'];
const keyOf = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const samePath = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
const topologyKey = monitors => keyOf(monitors.map(m => [m.id.toLowerCase(), m.x, m.y, m.width, m.height]).sort());
function touchFile(file) {
  try {
    const now = new Date();
    fs.utimesSync(file, now, now);
  } catch (e) { /* ignore */ }
}

function sameDesktop(a, b) {
  return a.position === b.position && a.color === b.color && topologyKey(a.monitors) === topologyKey(b.monitors) &&
    a.monitors.every(m => samePath(m.wallpaper, b.monitors.find(n => n.id === m.id)?.wallpaper));
}

function createDesktop({ directory, store, engine, decode, prepareImage }) {
  const images = path.join(directory, 'images');
  const managedImage = file => samePath(path.dirname(file), images);

  async function runPlan(action, plan) {
    fs.mkdirSync(directory, { recursive: true });
    const planFile = path.join(directory, randomUUID() + '.json');
    try {
      fs.writeFileSync(planFile, JSON.stringify(plan));
      return await engine.run(action, { planFile });
    } finally { fs.rmSync(planFile, { force: true }); }
  }

  async function read() {
    const result = await engine.run('desktop');
    if (!result.ok) throw new Error(result.error);
    return result.desktop;
  }

  function backup(desktop, ids) {
    fs.mkdirSync(images, { recursive: true });
    return { ...desktop, monitors: desktop.monitors.map(m => {
      if (!ids.has(m.id) || !m.wallpaper || managedImage(m.wallpaper)) return m;
      const bytes = fs.readFileSync(m.wallpaper);
      const hash = createHash('sha256').update(bytes).digest('hex');
      const copy = path.join(images, 'backup-' + hash + path.extname(m.wallpaper));
      if (!fs.existsSync(copy)) fs.writeFileSync(copy, bytes);
      else touchFile(copy);
      return { ...m, backup: copy };
    }) };
  }

  function originalOrBackup(monitor) {
    if (!monitor.wallpaper) return '';
    if (!monitor.backup) return monitor.wallpaper;
    try {
      const original = fs.readFileSync(monitor.wallpaper);
      if (original.equals(fs.readFileSync(monitor.backup))) return monitor.wallpaper;
    } catch (error) { /* Recover from the saved copy. */ }
    return monitor.backup;
  }

  async function change(before, position, changes) {
    changes = changes.filter(change => !samePath(change.wallpaper, before.monitors.find(m => m.id === change.id).wallpaper));
    if (!changes.length && before.position === position) return { ok: true, desktop: before };
    const existingUndo = store.state.desktop.undo;
    const after = { ...before, position, monitors: before.monitors.map(m => {
      const next = changes.find(change => change.id === m.id);
      return next ? { ...m, wallpaper: next.wallpaper } : m;
    }) };
    const prior = backup(before, new Set(changes.map(m => m.id)));
    store.setDesktop({ undo: { before: prior, after, ids: changes.map(m => m.id) } });
    let result;
    try { result = await runPlan('batch', { before, position, changes }); }
    catch (error) { result = { ok: false, error: error.message }; }
    if (result.code === 'DESKTOP_CHANGED') {
      // The engine rejected the plan before writing any desktop settings.
      store.setDesktop({ undo: existingUndo });
    } else if (!result.ok) {
      const current = await read().catch(() => null);
      if (current && sameDesktop(current, before)) {
        store.setDesktop({ undo: existingUndo });
      } else if (result.rollback === false && current && topologyKey(current.monitors) === topologyKey(before.monitors) &&
          [before.position, position].includes(current.position) && current.color === before.color &&
          current.monitors.every(m => [before, after].some(snapshot =>
            samePath(m.wallpaper, snapshot.monitors.find(entry => entry.id === m.id)?.wallpaper)))) {
        store.setDesktop({ undo: { ...store.state.desktop.undo, after: current } });
      }
    }
    return result;
  }

  async function apply(item, options) {
    const style = options.style;
    if (!WINDOWS_STYLES.includes(style)) throw new Error('Unknown wallpaper style');
    const framing = options.framing || DEFAULT_FRAMING;
    if (![framing.zoom, framing.x, framing.y].every(Number.isFinite) ||
        framing.zoom < 0.25 || framing.zoom > 5 || Math.abs(framing.x) > 100 || Math.abs(framing.y) > 100) {
      throw new Error('Invalid framing');
    }
    const before = await read();
    if (before.flags & 6) throw new Error('Windows slideshow or remote-session wallpaper is active');
    const selected = style === 'span' ? null : options.monitorId;
    const targets = selected ? before.monitors.filter(m => m.id === selected) : before.monitors;
    if (!targets.length) throw new Error('The selected display is no longer connected');
    if (options.topology && topologyKey(options.topology) !== topologyKey(before.monitors)) {
      return { ok: false, code: 'DESKTOP_CHANGED', error: 'Display layout changed. Review the preview and try again.' };
    }
    const image = await prepareImage(item, options.progress);
    const { source } = image;
    const allBounds = monitorBounds(before.monitors);
    const span = style === 'span';
    const normalizePosition = !selected || before.position === 1 || before.position === 5;
    const position = normalizePosition ? 4 : before.position;
    const jobs = [];
    const changes = [];
    const fingerprints = new Map();
    fs.mkdirSync(images, { recursive: true });

    async function add(monitor, file, placement, color) {
      if (file && !fingerprints.has(file)) {
        fingerprints.set(file, createHash('sha256').update(await fs.promises.readFile(file)).digest('hex'));
      }
      const job = {
        width: monitor.width, height: monitor.height, x: placement.x - monitor.x, y: placement.y - monitor.y,
        imageWidth: placement.width, imageHeight: placement.height, tile: placement.tile, color
      };
      const output = path.join(images, 'frame-' + keyOf([fingerprints.get(file), job]) + '.png');
      if (fs.existsSync(output)) touchFile(output);
      else if (!jobs.some(j => j.output === output)) jobs.push({ ...job, source: file, output });
      changes.push({ id: monitor.id, wallpaper: output });
    }

    const customViewport = options.viewport && Number.isFinite(options.viewport.width) &&
      Number.isFinite(options.viewport.height) && options.viewport.width > 0 && options.viewport.height > 0
      ? options.viewport : null;
    for (const monitor of targets) {
      const bounds = span ? allBounds : monitor;
      const viewport = customViewport
        ? framingViewport(bounds, customViewport.width, customViewport.height)
        : framingViewport(bounds);
      await add(monitor, source, imagePlacement(image, bounds, style, framing, viewport), 0);
    }
    if (selected && normalizePosition) {
      for (const monitor of before.monitors.filter(m => m.id !== selected)) {
        const old = monitor.wallpaper;
        const placement = old
          ? imagePlacement(await decode(old), allBounds, WINDOWS_STYLES[before.position], DEFAULT_FRAMING)
          : { x: monitor.x, y: monitor.y, width: 1, height: 1, tile: false };
        await add(monitor, old, placement, before.color);
      }
    }
    if (jobs.length) {
      const outputs = jobs.map(job => ({ ...job, output: job.output + '.' + randomUUID() }));
      try {
        const result = await runPlan('compose', { jobs: outputs });
        if (!result.ok) return result;
        outputs.forEach((job, index) => fs.renameSync(job.output, jobs[index].output));
      } finally {
        outputs.forEach(job => fs.rmSync(job.output, { force: true }));
      }
    }
    options.progress?.('write');
    const result = await change(before, position, changes);
    return { ...result, source, targetCount: targets.length };
  }

  async function undo() {
    const previous = store.state.desktop.undo;
    if (!previous) throw new Error('No wallpaper change to undo');
    const current = await read();
    if (!sameDesktop(current, previous.after)) throw new Error('Desktop or display layout changed after the last application');
    const changes = previous.before.monitors.filter(m => previous.ids.includes(m.id))
      .map(m => ({ id: m.id, wallpaper: originalOrBackup(m) }));
    const result = await runPlan('batch', { before: current, position: previous.before.position, changes });
    if (result.ok) store.setDesktop({ undo: null });
    return result;
  }

  async function saveProfile() {
    const desktop = await read();
    if (desktop.flags & 6) throw new Error('A Windows slideshow cannot be saved as a static layout');
    const profile = backup(desktop, new Set(desktop.monitors.map(m => m.id)));
    store.setDesktop({ profiles: { ...store.state.desktop.profiles, [topologyKey(desktop.monitors)]: profile } });
    return { ok: true, desktop };
  }

  async function restoreProfile(quiet = false) {
    const current = await read();
    const profile = store.state.desktop.profiles[topologyKey(current.monitors)];
    if (!profile) {
      if (quiet) return null;
      throw new Error('No saved layout for these displays');
    }
    const changes = profile.monitors.map(m => ({ id: m.id, wallpaper: originalOrBackup(m) }))
      .filter(m => !samePath(m.wallpaper, current.monitors.find(n => n.id === m.id).wallpaper));
    if (profile.color !== current.color && profile.monitors.some(m => !m.wallpaper)) {
      throw new Error('The desktop background color has changed');
    }
    return change(current, profile.position, changes);
  }

  function pinnedFiles(activeDesktop) {
    const pinned = new Set();
    const keep = p => { if (p) pinned.add(path.resolve(p).toLowerCase()); };
    const collect = snapshot => {
      if (!snapshot || !Array.isArray(snapshot.monitors)) return;
      for (const m of snapshot.monitors) {
        keep(m.wallpaper);
        keep(m.backup);
      }
    };
    collect(activeDesktop);
    keep(store.state.settings.lastWallpaperPath);
    const undoState = store.state.desktop.undo;
    if (undoState) {
      collect(undoState.before);
      collect(undoState.after);
    }
    const profiles = store.state.desktop.profiles || {};
    for (const profile of Object.values(profiles)) collect(profile);
    return pinned;
  }

  function pruneImages({ maxAgeMs = 0, activeDesktop = null } = {}) {
    if (!fs.existsSync(images)) return { removed: 0, freedBytes: 0 };
    const pinned = pinnedFiles(activeDesktop);
    const now = Date.now();
    let removed = 0, freedBytes = 0;
    for (const name of fs.readdirSync(images)) {
      const full = path.join(images, name);
      if (pinned.has(path.resolve(full).toLowerCase())) continue;
      try {
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        if (maxAgeMs > 0 && now - st.mtimeMs < maxAgeMs) continue;
        fs.unlinkSync(full);
        removed++;
        freedBytes += st.size;
      } catch (e) { /* in use or vanished */ }
    }
    return { removed, freedBytes };
  }

  function reclaimableImageStats(activeDesktop = null) {
    if (!fs.existsSync(images)) return { bytes: 0, count: 0 };
    const pinned = pinnedFiles(activeDesktop);
    let bytes = 0, count = 0;
    for (const name of fs.readdirSync(images)) {
      const full = path.join(images, name);
      if (pinned.has(path.resolve(full).toLowerCase())) continue;
      try {
        const st = fs.statSync(full);
        if (st.isFile()) { bytes += st.size; count++; }
      } catch (e) { /* vanished */ }
    }
    return { bytes, count };
  }

  return { read, apply, undo, saveProfile, restoreProfile, pinnedFiles, pruneImages, reclaimableImageStats };
}

module.exports = { createDesktop };
