'use strict';
// Zero-dependency HTTP client. GitHub API rejects requests without a User-Agent,
// and several endpoints gzip their payload, so both are handled here.

const https = require('node:https');
const http = require('node:http');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { URL } = require('node:url');

const UA = 'Wallscape/0.1 (Windows desktop wallpaper client)';

function get(url, options = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'http:' ? http : https;
    const redirects = options.followRedirects == null ? 4 : options.followRedirects;

    const headers = Object.assign({
      'User-Agent': UA,
      'Accept': options.accept || '*/*',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'close'
    }, options.headers || {});

    const req = mod.request(u, {
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 20000,
      signal: options.signal
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
        res.resume();
        const next = new URL(res.headers.location, u).toString();
        return resolve(get(next, Object.assign({}, options, { followRedirects: redirects - 1 })));
      }
      const chunks = [];
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      let stream = res;
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      stream.on('data', c => chunks.push(c));
      stream.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
      stream.on('error', reject);
      res.on('aborted', () => reject(options.signal?.reason || new Error('Response interrupted: ' + u.host)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + u.host)));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function json(url, options = {}) {
  const r = await get(url, Object.assign({ accept: 'application/json' }, options));
  if (r.status >= 400) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`);
  const text = r.body.toString('utf8').replace(/^\uFEFF/, '');
  return JSON.parse(text);
}

// Downloads to `dest` atomically (tmp file + rename), so a half-written image
// can never be handed to SystemParametersInfo.
async function getImage(url, fetchImage) {
  const source = new URL(url);
  const sourceError = message => Object.assign(new Error(message), { code: 'IMAGE_SOURCE' });
  if (source.protocol !== 'https:' || source.username || source.password) throw sourceError('Invalid image URL');
  const timeout = AbortSignal.timeout(30000);
  const limit = 128 * 1024 * 1024;
  let response;
  try {
    response = await fetchImage(source.href, {
      headers: { Accept: 'image/*, application/octet-stream;q=0.8' },
      signal: timeout, bypassCustomProtocolHandlers: true
    });
  } catch (error) {
    throw Object.assign(new Error(`${source.host}: ${error.message}`, { cause: error }), { code: 'IMAGE_NETWORK' });
  }
  try {
    if (!response.ok || response.status === 206) throw sourceError(`${source.host}: HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/^(image\/|application\/(?:octet-stream|binary)\b)/i.test(contentType)) {
      throw sourceError(`unexpected content-type: ${contentType}`);
    }
    if (Number(response.headers.get('content-length')) > limit) throw sourceError('image exceeds 128 MB');
    if (!response.body) throw sourceError('image response was empty');
    const chunks = [];
    let bytes = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read().catch(error => {
          throw Object.assign(new Error(`${source.host}: ${error.message}`, { cause: error }), { code: 'IMAGE_NETWORK' });
        });
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) throw sourceError('image exceeds 128 MB');
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    if (bytes < 1024) throw sourceError('image payload too small');
    return Buffer.concat(chunks, bytes);
  } finally {
    await response.body?.cancel().catch(() => {});
  }
}

async function download(url, dest, fetchImage) {
  let body;
  try { body = await getImage(url, fetchImage); }
  catch (error) {
    const reason = error.cause?.message || '';
    if (error.code !== 'IMAGE_NETWORK' || !/RESET|CLOSED|ABORTED|TIMED.OUT|NETWORK_CHANGED|TLS connection/i.test(reason)) throw error;
    await delay(400);
    body = await getImage(url, fetchImage);
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${randomUUID()}.part`;
  try {
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

module.exports = { get, json, download, UA };
