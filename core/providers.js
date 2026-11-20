'use strict';
// Pluggable wallpaper sources. Every provider returns the same WallpaperItem shape.
// Sources reachable without credentials here (verified):
//   bing   -> cn.bing.com/HPImageArchive.aspx
//   github -> api.github.com + raw.githubusercontent.com + images.weserv.nl
//   anime  -> dharmx/walls :: anime/ (curated, ~299 files)
//   nekos  -> nekos.best SFW API (artist / source / dimensions included)
//   commons -> Wikimedia Commons featured widescreen desktop backgrounds
//   wallhaven -> public SFW wallpaper search
// Unsplash / Pexels stay "unconfigured" until a credential exists;
// they never silently pretend to work. An empty free source is reported as an error.

const fs = require('node:fs');
const path = require('node:path');
const { json } = require('./fetch');

const GH_API = 'https://api.github.com';
const GH_OWNER = 'DenverCoder1';
const GH_REPO = 'minimalistic-wallpaper-collection';
const GH_BRANCH = 'main';
const GH_RAW = `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/images/`;
const GH_WEB = `https://github.com/${GH_OWNER}/${GH_REPO}/blob/${GH_BRANCH}/images/`;
const BING = 'https://cn.bing.com';
const COMMONS = 'https://commons.wikimedia.org';
const COMMONS_CACHE = 'commons-tree.json';
const WALLHAVEN_CACHE = 'wallhaven-index.json';
const WALLHAVEN_TTL = 15 * 60 * 1000;
const WALLHAVEN_CACHE_LIMIT = 720;
const WALLHAVEN_CACHE_VERSION = 2;
const WALLHAVEN_GENRES = {
  anime: { categories: '010' },
  people: { categories: '001', tag: 'photography' },
  landscape: { categories: '100', tag: 'landscape' },
  animals: { categories: '100', tag: 'animals' },
  architecture: { categories: '100', tag: 'architecture' },
  space: { categories: '100', tag: 'space' },
  abstract: { categories: '100', tag: 'abstract' }
};
const WALLHAVEN_MIN_EDGE = { hd: 720, fhd: 1080, qhd: 1440, uhd: 2160 };
const WALLHAVEN_RATIOS = {
  '16:9': '16x9',
  '16:10': '16x10',
  '4:3': '4x3,5x4,3x2',
  ultrawide: '21x9,32x9,48x9',
  portrait: 'portrait'
};

const WALLS_OWNER = 'dharmx';
const WALLS_REPO = 'walls';
const WALLS_BRANCH = 'main';
const WALLS_ANIME_DIR = 'anime';
// Snapshot of the anime/ tree sha, used only when the live root lookup fails.
const WALLS_ANIME_SHA = '46b86b93dd7e4086eac275b0a27257a92c1fa68a';
const WALLS_RAW = `https://raw.githubusercontent.com/${WALLS_OWNER}/${WALLS_REPO}/${WALLS_BRANCH}/${WALLS_ANIME_DIR}/`;
const WALLS_WEB = `https://github.com/${WALLS_OWNER}/${WALLS_REPO}/tree/${WALLS_BRANCH}/${WALLS_ANIME_DIR}`;

// GitHub's unauthenticated API and nekos.best both flap under concurrency.
async function retry(fn, times = 2, gap = 300) {
  let last;
  for (let i = 0; i <= times; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (i < times) await new Promise(r => setTimeout(r, gap * (i + 1)));
    }
  }
  throw last;
}

// raw.githubusercontent.com has no resize endpoint; 1-3 MB originals would
// keep the first screen empty. This proxy is reachable here (200 / ~9 KB).
function wsThumb(target) {
  return `https://images.weserv.nl/?url=${target}&w=480&q=72&output=jpg`;
}
function ghThumb(name) {
  return wsThumb(`raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/${GH_BRANCH}/images/${encodeURIComponent(name)}`);
}
function wallsThumb(name) {
  return wsThumb(`raw.githubusercontent.com/${WALLS_OWNER}/${WALLS_REPO}/${WALLS_BRANCH}/${WALLS_ANIME_DIR}/${encodeURIComponent(name)}`);
}

const TAG_CN = {
  mountain: '山', mountains: '山脉', sunset: '日落', sunrise: '日出', night: '夜',
  sky: '天空', cloud: '云', clouds: '云', ocean: '海', sea: '海', water: '水',
  forest: '森林', tree: '树', trees: '树林', nature: '自然', snow: '雪', winter: '冬',
  autumn: '秋', summer: '夏', spring: '春', cherry: '樱', blossom: '花', flower: '花',
  minimal: '极简', minimalist: '极简', minimalism: '极简', abstract: '抽象', flat: '平涂',
  space: '太空', planet: '行星', galaxy: '星系', moon: '月', stars: '星', cyber: '赛博',
  neon: '霓虹', city: '城市', cityscape: '城市', architecture: '建筑', geometric: '几何',
  gradient: '渐变', blue: '蓝', red: '红', green: '绿', orange: '橙', purple: '紫',
  dark: '暗色', light: '亮色', monochrome: '单色', grayscale: '灰度', retro: '复古',
  vintage: '复古', calm: '静谧', quiet: '静谧', landscape: '风景', sci: '科幻',
  eagle: '鹰', bird: '鸟', lake: '湖', river: '河', desert: '沙漠',
  rain: '雨', fog: '雾', mist: '雾', wave: '浪', waves: '浪', island: '岛',
  horizon: '地平线', silhouette: '剪影', anime: '动漫', art: '艺术', girl: '少女',
  boy: '少年', school: '校园', sakura: '樱花', cat: '猫', fox: '狐'
};

const TONE_HINTS = {
  warm: ['sunset', 'sunrise', 'orange', 'red', 'autumn', 'desert', 'golden', 'cherry', 'fire', 'warm', 'horizon'],
  cool: ['night', 'blue', 'ocean', 'sea', 'snow', 'ice', 'space', 'cyber', 'rain', 'calm', 'winter', 'planet', 'galaxy', 'moon'],
  green: ['forest', 'green', 'tree', 'nature', 'jungle', 'leaf', 'island', 'mountain'],
  mono: ['monochrome', 'grayscale', 'noir', 'minimal', 'minimalist', 'white', 'black', 'abstract', 'flat', 'silhouette']
};

function toneFrom(words) {
  const w = words.map(s => s.toLowerCase());
  let best = 'neutral', score = 0;
  for (const [tone, keys] of Object.entries(TONE_HINTS)) {
    const n = keys.filter(k => w.some(x => x.includes(k))).length;
    if (n > score) { score = n; best = tone; }
  }
  return best;
}
function normalize(raw) {
  return raw.replace(/\.[^.]+$/, '').replace(/[_\s]+/g, '-').split('-')
    .map(s => s.trim().toLowerCase())
    .filter(s => s && !/^\d+$/.test(s) && s.length > 1);
}
function titleCase(s) { return s.replace(/\b[a-z]/g, c => c.toUpperCase()); }
function ratioOf(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  return r >= 2 ? 'ultrawide' : r >= 1.68 ? '16:9' : r >= 1.54 ? '16:10' : r >= 1.2 ? '4:3' : r >= .9 ? '1:1' : 'portrait';
}

// ---------- Bing China daily wallpaper ----------
async function bingCn() {
  const out = [];
  for (const idx of [0, 8]) {
    try {
      const d = await json(`${BING}/HPImageArchive.aspx?format=js&idx=${idx}&n=8&mkt=zh-cn`);
      for (const im of (d.images || [])) {
        const base = im.urlbase || '';
        const words = normalize(im.title || '');
        const copy = String(im.copyright || '');
        const author = (copy.match(/©\s*([^/)]+)/) || [])[1] || 'Microsoft Bing';
        out.push({
          id: 'bing:' + (im.startdate || '') + ':' + (im.hsh || base.slice(-12)),
          source: 'bing', sourceLabel: 'BING / 每日',
          title: im.title || '每日一图', author: author.trim(), description: copy,
          tags: [...new Set([...words, '每日', '风景', 'bing'])], tagsCn: ['每日', '风景'],
          width: 1920, height: 1080, ratio: '16:9', tone: toneFrom(words),
          thumbUrl: BING + base + '_400x240.jpg',
          fullUrl: BING + (im.url || base + '_1920x1080.jpg'),
          pageUrl: BING + (im.copyrightlink || '/'),
          license: 'Bing 每日壁纸 / 版权归原作者', date: im.startdate || ''
        });
      }
    } catch (e) { /* one batch failing must not break the other */ }
  }
  const seen = new Set();
  return out.filter(i => !seen.has(i.id) && seen.add(i.id));
}

// ---------- GitHub minimalistic collection ----------
const TREE_VERSION = 2;
let treeCache = { at: 0, version: TREE_VERSION, data: null };

async function githubCollection(cacheDir) {
  const cacheFile = path.join(cacheDir, 'github-tree.json');
  const MAX_AGE = 6 * 60 * 60 * 1000;
  if (treeCache.data && treeCache.version === TREE_VERSION && Date.now() - treeCache.at < MAX_AGE) return treeCache.data;
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached.version === TREE_VERSION && Date.now() - cached.at < MAX_AGE && cached.data.length) {
      treeCache = cached; return cached.data;
    }
  } catch (e) { /* no usable cache */ }
  const d = await retry(() => json(`${GH_API}/repos/${GH_OWNER}/${GH_REPO}/git/trees/${GH_BRANCH}?recursive=1`,
    { headers: { Accept: 'application/vnd.github+json' } }));
  if (d.truncated) throw new Error('GitHub tree truncated; refusing partial index');
  const files = (d.tree || []).filter(t =>
    t.type === 'blob' && t.path.startsWith('images/') && /\.(jpe?g|png|webp)$/i.test(t.path));
  const data = files.map(f => {
    const name = path.basename(f.path);
    const words = normalize(name);
    const subject = words.slice(1);
    return {
      id: 'github:' + name, source: 'github', sourceLabel: 'OPEN COLLECTION',
      title: subject.length ? titleCase(subject.join(' ')) : titleCase(name.replace(/\.[^.]+$/, '')),
      author: words[0] ? titleCase(words[0]) : 'Unknown',
      description: `来自开源合集 · ${(f.size / 1024 / 1024).toFixed(2)} MB`,
      tags: [...new Set([...subject, 'minimal', 'collection'])],
      tagsCn: [...new Set(subject.map(w => TAG_CN[w]).filter(Boolean))],
      width: null, height: null, ratio: null, tone: toneFrom(subject),
      thumbUrl: ghThumb(name), fullUrl: GH_RAW + encodeURIComponent(name),
      pageUrl: GH_WEB + encodeURIComponent(name),
      license: '开源合集 / 版权归原作者', date: '', bytes: f.size || 0
    };
  });
  treeCache = { at: Date.now(), version: TREE_VERSION, data };
  if (data.length) { try { fs.writeFileSync(cacheFile, JSON.stringify(treeCache)); } catch (e) { /* ignore */ } }
  return data;
}

// ---------- GitHub curated ANIME directory ----------
// The repo is 3.8 GB, so a recursive tree is refused by the API. We only walk
// the top-level tree, resolve the anime/ sha, then read that single directory.
async function animeGithub(cacheDir) {
  const cacheFile = path.join(cacheDir, 'anime-tree.json');
  const MAX_AGE = 24 * 60 * 60 * 1000;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (Date.now() - c.at < MAX_AGE && Array.isArray(c.data) && c.data.length) return c.data;
  } catch (e) { /* no usable cache */ }

  const H = { Accept: 'application/vnd.github+json' };
  const errs = [];
  let sha = WALLS_ANIME_SHA;
  try {
    const top = await retry(() => json(`${GH_API}/repos/${WALLS_OWNER}/${WALLS_REPO}/git/trees/${WALLS_BRANCH}`,
      { headers: H, timeout: 15000 }));
    const hit = (top.tree || []).find(x => x.path === WALLS_ANIME_DIR);
    if (hit && hit.sha) sha = hit.sha;
  } catch (e) { errs.push('root:' + e.message); }

  let entries = null;
  try {
    const t = await retry(() => json(`${GH_API}/repos/${WALLS_OWNER}/${WALLS_REPO}/git/trees/${sha}`,
      { headers: H, timeout: 20000 }));
    if (Array.isArray(t.tree)) entries = t.tree;
  } catch (e) { errs.push('tree:' + e.message); }
  if (!entries) {
    try {
      const list = await retry(() => json(`${GH_API}/repos/${WALLS_OWNER}/${WALLS_REPO}/contents/${WALLS_ANIME_DIR}?ref=${WALLS_BRANCH}`,
        { headers: H, timeout: 15000 }), 1);
      // contents API reports type "file", git trees report "blob".
      if (Array.isArray(list)) entries = list.map(x => ({ type: x.type, path: x.name, size: x.size }));
    } catch (e) { errs.push('contents:' + e.message); }
  }
  if (!entries) throw new Error('GitHub anime index unavailable: ' + errs.join(' | '));

  const files = entries.filter(e =>
    (!e.type || e.type === 'blob' || e.type === 'file') && /\.(jpe?g|png|webp)$/i.test(e.path));
  const data = files.map(f => {
    const name = f.path;
    const words = normalize(name);
    const subject = words.slice(1);
    return {
      id: 'anime:' + name, source: 'anime', sourceLabel: 'ANIME / CURATED',
      title: subject.length ? titleCase(subject.join(' ')) : titleCase(name.replace(/\.[^.]+$/, '')),
      author: words[0] ? titleCase(words[0]) : 'dharmx/walls',
      description: `动漫壁纸合集 · ${f.size ? (f.size / 1024 / 1024).toFixed(2) + ' MB' : 'curated'}`,
      tags: [...new Set([...subject, 'anime', '动漫', '二次元', 'wallpaper'])],
      tagsCn: [...new Set(['动漫', '二次元', ...subject.map(w => TAG_CN[w]).filter(Boolean)])],
      width: null, height: null, ratio: null, tone: toneFrom(subject),
      thumbUrl: wallsThumb(name), fullUrl: WALLS_RAW + encodeURIComponent(name),
      pageUrl: WALLS_WEB, license: 'dharmx/walls / 版权归原作者', date: '', bytes: f.size || 0
    };
  });
  if (!data.length) throw new Error('GitHub anime index returned no images');
  try { fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), data })); } catch (e) { /* ignore */ }
  return data;
}

// ---------- nekos.best SFW anime art ----------
async function nekos() {
  const out = [], seen = new Set(), errs = [];
  for (const cat of ['waifu', 'kitsune', 'neko']) {
    try {
      const d = await retry(() => json(`https://nekos.best/api/v2/${cat}?amount=10`, { timeout: 12000 }), 1);
      for (const r of (d.results || [])) {
        const u = String(r.url || '');
        if (!/^https:\/\//.test(u)) continue;
        const id = 'nekos:' + u.split('/').pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const dim = r.dimensions || {};
        out.push({
          id, source: 'nekos', sourceLabel: 'NEKOS / SFW',
          title: `${cat.toUpperCase()} — ${r.artist_name || 'Unknown'}`,
          author: r.artist_name || 'Unknown', description: 'SFW 动漫插画 · nekos.best',
          tags: [cat, 'anime', '动漫', '二次元', 'sfw'], tagsCn: ['动漫', '二次元'],
          width: dim.width || null, height: dim.height || null,
          ratio: ratioOf(dim.width, dim.height), tone: 'neutral',
          thumbUrl: wsThumb(u.replace(/^https:\/\//, '')),
          fullUrl: u, ext: '.png',
          pageUrl: r.source_url || 'https://nekos.best',
          license: '见原站 / 版权归画师', date: ''
        });
      }
    } catch (e) { errs.push(cat + ':' + e.message); }
  }
  if (!out.length) throw new Error('nekos.best returned no images: ' + errs.join(' | '));
  return out;
}

function commonsText(html) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(html || '').replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (match, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()] || match;
      const hex = entity[1].toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : match;
    }).replace(/\s+/g, ' ').trim();
}

function commonsUrl(value, ...hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.includes(url.host) && !url.username && !url.password;
  } catch { return false; }
}

function commonsItems(payload) {
  if (payload.error) throw new Error(`Wikimedia API: ${payload.error.code || 'unknown'}`);
  const items = [];
  for (const page of payload.query?.pages || []) {
    const image = page.imageinfo?.[0];
    if (!page.pageid || !image || !['image/jpeg', 'image/png'].includes(image.mime)) continue;
    if (!(image.width >= 1920 && image.height >= 1080)) continue;
    if (!commonsUrl(image.url, 'upload.wikimedia.org') || !commonsUrl(image.thumburl, 'upload.wikimedia.org', 'thumb.wikimedia.org') ||
        !commonsUrl(image.descriptionurl, 'commons.wikimedia.org')) continue;
    const meta = image.extmetadata || {};
    const title = page.title.replace(/^File:/i, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    const description = commonsText(meta.ImageDescription?.value).slice(0, 500);
    const words = (`${title} ${description}`.toLowerCase().match(/[a-z]+/g) || []).filter(word => Object.hasOwn(TAG_CN, word));
    items.push({
      id: `commons:${page.pageid}`, source: 'commons', sourceLabel: 'WIKIMEDIA COMMONS', title,
      author: commonsText(meta.Artist?.value).slice(0, 160) || 'Wikimedia Commons', description,
      tags: [...new Set(words)], tagsCn: [...new Set(words.map(word => TAG_CN[word]))],
      width: image.width, height: image.height, ratio: ratioOf(image.width, image.height), tone: toneFrom(words),
      thumbUrl: image.thumburl, fullUrl: image.url, pageUrl: image.descriptionurl,
      license: commonsText(meta.LicenseShortName?.value) || 'See file page', date: '', bytes: image.size || 0
    });
  }
  return items;
}

function readIndex(cacheDir, file) {
  if (!file) return null;
  try {
    const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, file), 'utf8'));
    return Array.isArray(cached.data) && cached.data.length ? cached : null;
  } catch { return null; }
}

async function commonsCollection(cacheDir, request = json) {
  const cached = readIndex(cacheDir, COMMONS_CACHE);
  if (cached && Date.now() - cached.at < 24 * 60 * 60 * 1000) return cached.data;
  const params = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', maxlag: '5',
    generator: 'categorymembers', gcmtitle: 'Category:Commons featured widescreen desktop backgrounds',
    gcmtype: 'file', gcmlimit: '40', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '500', iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription'
  });
  const fetchIndex = () => request(`${COMMONS}/w/api.php?${params}`, { timeout: 8000 });
  const response = await fetchIndex().catch(async error => {
    if (error.code !== 'ECONNRESET') throw error;
    await new Promise(resolve => setTimeout(resolve, 300));
    return fetchIndex();
  });
  const data = commonsItems(response);
  if (!data.length) throw new Error('Wikimedia Commons returned no eligible wallpapers');
  try {
    fs.writeFileSync(path.join(cacheDir, COMMONS_CACHE), JSON.stringify({ at: Date.now(), data }));
  } catch (error) {
    console.warn('[commons] could not save index:', error.code || error.message);
  }
  return data;
}

// ---------- credential-gated overseas providers ----------
async function unsplash(cred, query) {
  if (!cred.unsplash) return [];
  const q = encodeURIComponent(query || 'wallpaper');
  const d = await json(`https://api.unsplash.com/search/photos?query=${q}&per_page=30&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${cred.unsplash}` } });
  return (d.results || []).map(i => ({
    id: 'unsplash:' + i.id, source: 'unsplash', sourceLabel: 'UNSPLASH',
    title: i.alt_description || i.description || 'Untitled', author: (i.user && i.user.name) || 'Unknown',
    description: i.description || '', tags: (i.tags || []).map(t => t.title || t).slice(0, 8), tagsCn: [],
    width: i.width, height: i.height, ratio: ratioOf(i.width, i.height), tone: 'neutral',
    thumbUrl: i.urls.small, fullUrl: i.urls.regular,
    pageUrl: i.links.html, license: 'Unsplash License', date: (i.created_at || '').slice(0, 10)
  }));
}
async function pexels(cred, query) {
  if (!cred.pexels) return [];
  const q = encodeURIComponent(query || 'wallpaper');
  const d = await json(`https://api.pexels.com/v1/search?query=${q}&per_page=30&orientation=landscape`,
    { headers: { Authorization: cred.pexels } });
  return (d.photos || []).map(i => ({
    id: 'pexels:' + i.id, source: 'pexels', sourceLabel: 'PEXELS',
    title: i.alt || `Photograph ${i.id}`, author: i.photographer || 'Unknown', description: '',
    tags: (i.alt || '').toLowerCase().split(/\s+/).slice(0, 8), tagsCn: [],
    width: i.width, height: i.height, ratio: ratioOf(i.width, i.height), tone: 'neutral',
    thumbUrl: i.src.medium, fullUrl: i.src.large2x || i.src.original,
    pageUrl: i.url, license: 'Pexels License', date: ''
  }));
}
async function wallhavenPage({ query = '', page = 1, genre = 'all', ratio, resolution, sort } = {}) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid Wallhaven page');
  if (resolution === 'unknown') return { items: [], total: 0, nextPage: null };
  const theme = Object.hasOwn(WALLHAVEN_GENRES, genre) ? WALLHAVEN_GENRES[genre] : null;
  const minEdge = Object.hasOwn(WALLHAVEN_MIN_EDGE, resolution) ? WALLHAVEN_MIN_EDGE[resolution] : 0;
  const params = new URLSearchParams({ categories: theme?.categories || '111', purity: '100',
    atleast: `${Math.max(1920, minEdge)}x${Math.max(1080, minEdge)}`,
    sorting: sort === 'popular' ? 'favorites' : sort === 'newest' || !query ? 'date_added' : 'relevance',
    order: 'desc', page: String(page) });
  if (Object.hasOwn(WALLHAVEN_RATIOS, ratio)) params.set('ratios', WALLHAVEN_RATIOS[ratio]);
  const terms = [theme?.tag && '+' + theme.tag, query].filter(Boolean).join(' ');
  if (terms) params.set('q', terms);
  const request = () => json(`https://wallhaven.cc/api/v1/search?${params}`, { timeout: 6000 });
  const response = await request().catch(async error => {
    if (error.code !== 'ECONNRESET') throw error;
    await new Promise(resolve => setTimeout(resolve, 300));
    return request();
  });
  if (!Array.isArray(response.data)) throw new Error('Unexpected Wallhaven response');
  const items = response.data.flatMap(image => {
    if (image.purity !== 'sfw' || !/^[a-z0-9]+$/.test(image.id || '') ||
        !/^https:\/\/w\.wallhaven\.cc\/full\//.test(image.path || '') ||
        !/^https:\/\/th\.wallhaven\.cc\//.test(image.thumbs?.small || '') ||
        !(image.dimension_x >= 1920 && image.dimension_y >= 1080)) return [];
    if (theme?.categories === '010' && image.category !== 'anime') return [];
    if (theme?.categories === '001' && image.category !== 'people') return [];
    if (theme?.categories === '100' && image.category !== 'general') return [];
    const imageRatio = ratioOf(image.dimension_x, image.dimension_y);
    if (Math.min(image.dimension_x, image.dimension_y) < minEdge ||
        (ratio && ratio !== 'any' && imageRatio !== ratio)) return [];
    const tags = [...new Set([image.category, ...(image.tags || []).map(tag => tag.name)].filter(Boolean))];
    const labels = { anime: '动漫', people: '人物' };
    return [{
      id: 'wallhaven:' + image.id, source: 'wallhaven', sourceLabel: 'WALLHAVEN',
      title: tags.filter(tag => tag !== image.category).slice(0, 3).join(' / ') || `Wallhaven · ${image.id}`,
      author: image.uploader?.username || 'Wallhaven community', description: '',
      tags, tagsCn: tags.map(tag => labels[tag] || TAG_CN[tag]).filter(Boolean),
      genres: theme ? [genre] : image.category === 'anime' ? ['anime'] : [],
      ...(genre === 'people' ? { medium: 'photo' } : {}),
      stats: Object.fromEntries(['favorites', 'views'].filter(key => Number.isFinite(image[key]) && image[key] >= 0)
        .map(key => [key, image[key]])),
      width: image.dimension_x, height: image.dimension_y, ratio: imageRatio,
      tone: toneFrom(tags), thumbUrl: image.thumbs.small, fullUrl: image.path,
      pageUrl: `https://wallhaven.cc/w/${image.id}`, license: 'Wallhaven / see source', date: image.created_at || ''
    }];
  });
  return { items, total: Number(response.meta?.total) || 0,
    nextPage: response.data.length && page < Number(response.meta?.last_page) ? page + 1 : null };
}

async function wallhavenLatest(cacheDir) {
  const cached = readIndex(cacheDir, WALLHAVEN_CACHE);
  if (cached?.version === WALLHAVEN_CACHE_VERSION && Date.now() - cached.at < WALLHAVEN_TTL) {
    return { ...cached, items: cached.data, indexedAt: cached.at };
  }
  const pages = await Promise.allSettled([1, 2, 3].map(page => wallhavenPage({ page })));
  const first = pages[0];
  if (first.status === 'rejected') throw first.reason;
  const items = new Map();
  const result = { total: first.value.total, nextPage: 1, indexedAt: Date.now() };
  for (const page of pages) {
    if (page.status === 'rejected' || !result.nextPage) break;
    for (const item of page.value.items) items.set(item.id, item);
    result.nextPage = page.value.nextPage;
  }
  if (!items.size) throw new Error('Wallhaven returned no eligible wallpapers');
  for (const item of cached?.data || []) if (!items.has(item.id)) items.set(item.id, item);
  if (result.nextPage === 4 && cached?.nextPage > 4 && result.indexedAt - cached.at < 24 * 60 * 60 * 1000) {
    result.nextPage = cached.nextPage;
  }
  result.items = [...items.values()].slice(0, WALLHAVEN_CACHE_LIMIT);
  saveWallhavenIndex(cacheDir, result.items, result);
  return result;
}

function saveWallhavenIndex(cacheDir, items, status) {
  if (items.length > WALLHAVEN_CACHE_LIMIT) return;
  const file = path.join(cacheDir, WALLHAVEN_CACHE);
  try {
    fs.writeFileSync(file + '.tmp', JSON.stringify({
      version: WALLHAVEN_CACHE_VERSION, at: status.indexedAt, data: items, total: status.total, nextPage: status.nextPage
    }));
    fs.renameSync(file + '.tmp', file);
  } catch (error) {
    console.warn('[wallhaven] could not save index:', error.code || error.message);
  }
}

// ---------- local folders ----------
function localFolders(folders) {
  const out = [];
  for (const folder of folders || []) {
    try {
      for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
        if (!e.isFile() || !/\.(jpe?g|png|bmp|webp)$/i.test(e.name)) continue;
        const abs = path.join(folder, e.name);
        const words = normalize(e.name);
        const url = 'wsp://local/' + encodeURIComponent(abs);
        out.push({
          id: 'local:' + abs.toLowerCase(), source: 'local', sourceLabel: 'LOCAL',
          title: titleCase(words.join(' ')) || e.name, author: '本机', description: abs,
          tags: words, tagsCn: words.map(w => TAG_CN[w]).filter(Boolean),
          width: null, height: null, ratio: null, tone: toneFrom(words),
          thumbUrl: url, fullUrl: url, localPath: abs,
          pageUrl: '', license: '本地文件', date: ''
        });
      }
    } catch (e) { /* folder vanished */ }
  }
  return out;
}

// ---------- orchestration ----------
const SOURCES = [
  { id: 'bing', load: () => bingCn() },
  { id: 'wallhaven', cache: WALLHAVEN_CACHE, paged: true, load: ({ cacheDir }) => wallhavenLatest(cacheDir),
    search: (_credentials, query, genre, filters) => wallhavenPage({ ...filters, query, genre }) },
  { id: 'github', cache: 'github-tree.json', load: ({ cacheDir }) => githubCollection(cacheDir) },
  { id: 'anime', cache: 'anime-tree.json', load: ({ cacheDir }) => animeGithub(cacheDir) },
  { id: 'nekos', load: () => nekos() },
  { id: 'commons', cache: COMMONS_CACHE, load: ({ cacheDir }) => commonsCollection(cacheDir) },
  { id: 'unsplash', needsKey: true, search: unsplash, load: ({ credentials }) => unsplash(credentials) },
  { id: 'pexels', needsKey: true, search: pexels, load: ({ credentials }) => pexels(credentials) },
  { id: 'local', local: true, load: ({ folders }) => localFolders(folders) }
];

function catalog(rows) {
  return { items: rows.flatMap(row => row.items), sources: rows.map(row => row.status) };
}

function sourceRow(source, items, options = {}) {
  return { items, status: { id: source.id, searchable: Boolean(source.search), configured: true,
    ok: true, count: items.length, error: null, ...options } };
}

function pageStatus(source, batch) {
  return source.paged ? { nextPage: batch?.nextPage || null, total: batch?.total || 0,
    indexedAt: batch?.indexedAt || batch?.at || 0 } : {};
}

async function loadAll({ cacheDir, credentials = {}, folders, onWallhaven }) {
  const rows = SOURCES.map(async source => {
    if (source.needsKey && !credentials[source.id]) return sourceRow(source, [], { configured: false });
    try {
      const batch = await source.load({ cacheDir, credentials, folders });
      const items = source.paged ? batch.items : batch;
      if (!items.length && !source.local) throw new Error('no images returned');
      return sourceRow(source, items, pageStatus(source, batch));
    } catch (error) {
      const cached = readIndex(cacheDir, source.cache);
      const items = cached?.data || [];
      return sourceRow(source, items, { ...pageStatus(source, cached), ok: false,
        stale: items.length > 0, error: String(error.message || error) });
    }
  });
  if (onWallhaven) {
    const index = SOURCES.findIndex(source => source.id === 'wallhaven');
    rows[index] = rows[index].then(row => { onWallhaven(row); return row; });
  }
  return catalog(await Promise.all(rows));
}

function loadCached(cacheDir, credentials = {}, folders) {
  return catalog(SOURCES.map(source => {
    const cached = readIndex(cacheDir, source.cache);
    return sourceRow(source, source.local ? localFolders(folders) : cached?.data || [],
      { ...pageStatus(source, cached), configured: !source.needsKey || Boolean(credentials[source.id]), loading: !source.local });
  }));
}

async function searchOnline(credentials, query, selectedSource = 'all', genre = 'all', filters) {
  if (typeof query !== 'string' || !query.trim()) return { items: [], failed: [] };
  const term = query.trim().slice(0, 120);
  const sources = SOURCES.filter(source => source.search && (!source.needsKey || credentials[source.id]) &&
    (selectedSource === 'all' || selectedSource === source.id));
  const results = await Promise.allSettled(sources.map(source => source.search(credentials, term, genre, filters)));
  const paged = results[sources.findIndex(source => source.paged)]?.value;
  return {
    items: results.flatMap(result => result.status === 'fulfilled' ? result.value.items || result.value : []),
    wallhavenNextPage: paged?.nextPage || null,
    failed: sources.filter((_source, index) => results[index].status === 'rejected').map(source => source.id)
  };
}

// Exported so the anime index can be warmed once, serially, into the local
// cache; concurrent cold requests are what trip the TLS reset.
module.exports = { loadAll, loadCached, searchOnline, ratioOf, TAG_CN, animeGithub, commonsCollection, wallhavenPage, saveWallhavenIndex };
