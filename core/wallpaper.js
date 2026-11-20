'use strict';
// Persistent worker wrapper around wallpaper.ps1. Compiles the Win32/GDI+ C#
// bridge once per session instead of spawning powershell.exe on every call.
// Always returns a structured receipt; a failed Win32/WinRT call is never
// reported as success.

const path = require('node:path');
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');

// powershell.exe cannot read files inside app.asar; the portable build keeps
// this script beside the runtime and points at it via WSP_ENGINE.
const SCRIPT = process.env.WSP_ENGINE
  ? path.resolve(process.env.WSP_ENGINE)
  : (__dirname.includes('app.asar')
      ? path.resolve(__dirname, '..', '..', '..', '..', 'engine', 'wallpaper.ps1')
      : path.join(__dirname, 'wallpaper.ps1'));

const REQUEST_TIMEOUT_MS = 45000;

let worker = null;
let nextId = 1;
let disposed = false;
const pending = new Map();

function failPending(reason, stderr = '') {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    pending.delete(id);
    entry.resolve({
      ok: false,
      action: entry.action,
      engine: 'powershell',
      error: reason,
      stderr: stderr.slice(0, 800)
    });
  }
}

function resetWorker(reason, stderr = '') {
  const current = worker;
  worker = null;
  if (current) {
    try { current.rl.close(); } catch (e) { /* ignore */ }
    try { current.child.stdin.end(); } catch (e) { /* ignore */ }
    try { current.child.kill(); } catch (e) { /* ignore */ }
  }
  if (reason) failPending(reason, stderr);
}

function ensureWorker() {
  if (disposed) return null;
  if (worker && !worker.child.killed && worker.child.exitCode === null) return worker;

  const argv = [
    '-STA', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT, '-Action', 'worker'
  ];
  const child = spawn('powershell.exe', argv, {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderrBuf = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderrBuf = (stderrBuf + chunk).slice(-4000);
  });

  const rl = createInterface({ input: child.stdout });
  const instance = { child, rl };
  worker = instance;

  rl.on('line', line => {
    if (worker !== instance) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch (e) { return; }
    if (!parsed || typeof parsed !== 'object' || parsed.ready === true) return;
    const id = parsed.id;
    const entry = pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(id);
    delete parsed.id;
    entry.resolve(parsed);
  });

  child.once('error', err => {
    if (worker !== instance) return;
    resetWorker(`engine worker error (${err.message})`, stderrBuf);
  });

  child.once('exit', (code, signal) => {
    if (worker !== instance) return;
    const detail = signal ? `signal ${signal}` : `code ${code}`;
    resetWorker(`engine worker exited (${detail})`, stderrBuf);
  });

  return instance;
}

function warmup() {
  if (disposed) return;
  try { ensureWorker(); } catch (e) { /* lazy retry on first run */ }
}

function run(action, args = {}) {
  return new Promise(resolve => {
    if (disposed) {
      return resolve({ ok: false, action, engine: 'powershell', error: 'engine disposed' });
    }
    let inst;
    try { inst = ensureWorker(); }
    catch (e) {
      return resolve({ ok: false, action, engine: 'powershell', error: e.message });
    }
    if (!inst) {
      return resolve({ ok: false, action, engine: 'powershell', error: 'engine unavailable' });
    }

    const id = nextId++;
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      resetWorker();
      resolve({
        ok: false,
        action,
        engine: 'powershell',
        error: `engine request timed out after ${REQUEST_TIMEOUT_MS}ms`
      });
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, { action, resolve, timer });
    const payload = { id, action };
    if (args.image) payload.image = args.image;
    if (args.planFile) payload.planFile = args.planFile;

    try {
      inst.child.stdin.write(JSON.stringify(payload) + '\n', 'utf8');
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      resetWorker(`engine write failed (${e.message})`);
      resolve({ ok: false, action, engine: 'powershell', error: e.message });
    }
  });
}

function dispose() {
  disposed = true;
  const current = worker;
  worker = null;
  failPending('engine disposed');
  if (!current) return;
  try { current.rl.close(); } catch (e) { /* ignore */ }
  try {
    current.child.stdin.write(JSON.stringify({ id: 0, action: 'quit' }) + '\n', 'utf8');
    current.child.stdin.end();
  } catch (e) { /* ignore */ }
  const killer = setTimeout(() => {
    try { if (current.child.exitCode === null) current.child.kill(); } catch (e) { /* ignore */ }
  }, 300);
  killer.unref();
}

module.exports = { run, warmup, dispose };
