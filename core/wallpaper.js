'use strict';
// Thin wrapper around wallpaper.ps1. Always returns a structured receipt.
// A failed Win32/WinRT call is never reported as success.

const path = require('node:path');
const { execFile } = require('node:child_process');

// powershell.exe cannot read files inside app.asar; the portable build keeps
// this script beside the runtime and points at it via WSP_ENGINE.
const SCRIPT = process.env.WSP_ENGINE
  ? path.resolve(process.env.WSP_ENGINE)
  : (__dirname.includes('app.asar')
      ? path.resolve(__dirname, '..', '..', '..', '..', 'engine', 'wallpaper.ps1')
      : path.join(__dirname, 'wallpaper.ps1'));

function run(action, args = {}) {
  return new Promise(resolve => {
    const argv = [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT, '-Action', action
    ];
    if (args.image) argv.push('-Image', args.image);
    if (args.style) argv.push('-Style', args.style);
    if (args.monitorIndex != null && args.monitorIndex >= 0) {
      argv.push('-MonitorIndex', String(args.monitorIndex));
    }

    execFile('powershell.exe', argv, {
      timeout: 45000, windowsHide: true, maxBuffer: 4 * 1024 * 1024
    }, (err, stdout, stderr) => {
      const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
      let parsed = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const o = JSON.parse(lines[i]);
          if (o && typeof o === 'object') { parsed = o; break; }
        } catch (e) { /* skip banner / noise lines */ }
      }
      if (!parsed) {
        return resolve({
          ok: false, action, engine: 'powershell',
          error: `no JSON receipt from engine (${err ? err.message : 'unknown'})`,
          stdout: String(stdout || '').slice(0, 800),
          stderr: String(stderr || '').slice(0, 800)
        });
      }
      resolve(parsed);
    });
  });
}

module.exports = { run };
