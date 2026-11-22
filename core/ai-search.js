'use strict';
// Zero-dependency AI smart global wallpaper search.
// Stage 1: Understand natural-language intent via OpenAI-compatible or Gemini API.
// Stage 2: Query global web image engines (Serper / Brave / Bing Web / Openverse /
//          Wikimedia Commons) + built-in providers concurrently.
// Stage 3: Filter watermarks/tiny images, deduplicate, and rank for desktop framing.

const crypto = require('node:crypto');
const { get, json } = require('./fetch');

const BLOCKED_HOSTS = [
  'shutterstock.com', 'gettyimages.com', 'istockphoto.com', 'alamy.com',
  'depositphotos.com', 'dreamstime.com', '123rf.com', 'vecteezy.com',
  'stock.adobe.com', 'vcg.com', 'nipic.com', '58pic.com', 'ibaotu.com',
  'veer.com', 'quanjing.com', 'hellorf.com', 'tukuppt.com', 'pinterest.com',
  'pinimg.com', 'freepik.com', 'pikbest.com', 'lovepik.com', 'pngtree.com'
];

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function ratioOf(w, h) {
  if (!w || !h) return null;
  const r = w / h;
  return r >= 2 ? 'ultrawide' : r >= 1.68 ? '16:9' : r >= 1.54 ? '16:10' : r >= 1.2 ? '4:3' : r >= .9 ? '1:1' : 'portrait';
}

function isSafeHttpsUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (BLOCKED_HOSTS.some(b => host === b || host.endsWith('.' + b))) return false;
    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[\uE000-\uF8FF]/g, '');
}

function extractJsonObject(text) {
  const cleaned = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch { /* scan braces */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return JSON.parse(cleaned.slice(start, end + 1));
  }
  throw new Error('AI response did not contain valid JSON');
}

async function httpJson(url, options = {}, fetchFn = null) {
  if (typeof fetchFn === 'function') {
    const signal = AbortSignal.timeout(options.timeout || 15000);
    const res = await fetchFn(url, {
      method: options.method || 'GET',
      headers: Object.assign({ Accept: 'application/json' }, options.headers || {}),
      body: options.body,
      signal,
      bypassCustomProtocolHandlers: true
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text);
        detail = parsed?.error?.message || parsed?.message || detail;
      } catch { /* raw text */ }
      throw new Error(`HTTP ${res.status}: ${detail}`);
    }
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  }
  return json(url, options);
}

async function httpText(url, options = {}, fetchFn = null) {
  if (typeof fetchFn === 'function') {
    const signal = AbortSignal.timeout(options.timeout || 9000);
    const res = await fetchFn(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      signal,
      bypassCustomProtocolHandlers: true
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
  const r = await get(url, options);
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return r.body.toString('utf8');
}

function buildOpenAiEndpoint(baseUrl) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!clean) return 'https://api.openai.com/v1/chat/completions';
  if (/\/chat\/completions$/i.test(clean)) return clean;
  if (/\/v\d+$/i.test(clean)) return clean + '/chat/completions';
  return clean + '/v1/chat/completions';
}

function buildGeminiEndpoint(baseUrl, model) {
  const clean = String(baseUrl || '').trim().replace(/\/+$/, '') || 'https://generativelanguage.googleapis.com';
  const m = String(model || '').trim() || 'gemini-2.5-flash';
  if (/:generateContent$/i.test(clean)) return clean;
  const prefix = /\/v1beta$/i.test(clean) ? clean : clean + '/v1beta';
  return `${prefix}/models/${encodeURIComponent(m)}:generateContent`;
}

async function callLLM({ credentials, systemPrompt, userPrompt, maxTokens = 450, jsonMode = true, fetchFn = null }) {
  const provider = credentials?.aiProvider === 'gemini' ? 'gemini' : 'openai';
  const apiKey = String(credentials?.aiApiKey || '').trim();
  if (!apiKey) throw new Error('AI API Key is not configured');

  if (provider === 'gemini') {
    const model = String(credentials?.aiModel || '').trim() || 'gemini-2.5-flash';
    const url = buildGeminiEndpoint(credentials?.aiBaseUrl, model);
    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: maxTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {})
      }
    };
    const data = await httpJson(url, {
      method: 'POST',
      timeout: 18000,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body)
    }, fetchFn);
    const text = (data?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    if (!text) throw new Error('Empty response from Gemini');
    return { text, provider, model };
  }

  const model = String(credentials?.aiModel || '').trim() || 'gpt-4o-mini';
  const url = buildOpenAiEndpoint(credentials?.aiBaseUrl);
  const body = {
    model,
    temperature: 0.3,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };
  const data = await httpJson(url, {
    method: 'POST',
    timeout: 18000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  }, fetchFn);
  const text = String(data?.choices?.[0]?.message?.content || '').trim();
  if (!text) throw new Error('Empty response from OpenAI-compatible API');
  return { text, provider, model };
}

async function testConnection(credentials, fetchFn = null) {
  const started = Date.now();
  try {
    const res = await callLLM({
      credentials,
      systemPrompt: 'Reply with OK only.',
      userPrompt: 'ping',
      maxTokens: 16,
      jsonMode: false,
      fetchFn
    });
    return {
      ok: true,
      provider: res.provider,
      model: res.model,
      latencyMs: Date.now() - started,
      reply: res.text.slice(0, 40)
    };
  } catch (error) {
    return {
      ok: false,
      provider: credentials?.aiProvider === 'gemini' ? 'gemini' : 'openai',
      model: String(credentials?.aiModel || '').trim(),
      latencyMs: Date.now() - started,
      error: String(error.message || error)
    };
  }
}

const CN_EN_LEXICON = [
  ['赛博朋克', 'cyberpunk'], ['二次元', 'anime'], ['吉卜力', 'ghibli'], ['新海诚', 'makoto shinkai'],
  ['水墨画', 'chinese ink painting'], ['水彩', 'watercolor'], ['油画', 'oil painting'], ['插画', 'illustration'],
  ['极简', 'minimalist'], ['抽象', 'abstract'], ['古风', 'ancient chinese'], ['国风', 'chinese style'],
  ['科幻', 'sci-fi'], ['机甲', 'mecha'], ['蒸汽波', 'vaporwave'], ['复古', 'retro vintage'],
  ['暗黑', 'dark'], ['霓虹', 'neon'], ['像素', 'pixel art'], ['治愈', 'cozy peaceful'],
  ['小猫', 'kitten cat'], ['猫咪', 'cat'], ['布偶猫', 'ragdoll cat'], ['橘猫', 'orange cat'], ['黑猫', 'black cat'], ['猫', 'cat'],
  ['柴犬', 'shiba inu dog'], ['柯基', 'corgi dog'], ['金毛', 'golden retriever'], ['小狗', 'puppy dog'], ['狗', 'dog'],
  ['狐狸', 'fox'], ['雪狐', 'arctic fox'], ['白狼', 'white wolf'], ['狼', 'wolf'], ['老虎', 'tiger'], ['狮子', 'lion'],
  ['熊猫', 'panda'], ['鲸鱼', 'whale'], ['海豚', 'dolphin'], ['水母', 'jellyfish'], ['猫头鹰', 'owl'],
  ['老鹰', 'eagle'], ['蝴蝶', 'butterfly'], ['兔子', 'rabbit'], ['鹿', 'deer'], ['鸟', 'bird'], ['动物', 'animal wildlife'],
  ['樱花', 'sakura cherry blossom'], ['桃花', 'peach blossom'], ['向日葵', 'sunflower'], ['玫瑰', 'rose'], ['花海', 'flower field'], ['花', 'flower'],
  ['雪山', 'snow mountain'], ['富士山', 'mount fuji'], ['山脉', 'mountain'], ['森林', 'forest'], ['竹林', 'bamboo forest'],
  ['大海', 'ocean sea'], ['海边', 'coast beach'], ['海浪', 'ocean wave'], ['海', 'ocean'],
  ['日落', 'sunset'], ['夕阳', 'sunset'], ['晚霞', 'sunset sky'], ['日出', 'sunrise'], ['云海', 'sea of clouds'], ['云', 'clouds'],
  ['星空', 'starry night sky'], ['银河', 'milky way galaxy'], ['星云', 'nebula'], ['极光', 'aurora'], ['月亮', 'moon'], ['宇宙', 'space galaxy'], ['太空', 'outer space'],
  ['雨夜', 'rainy night'], ['下雨', 'rain'], ['下雪', 'snow'], ['雪景', 'winter snow'], ['冬天', 'winter'], ['秋天', 'autumn'], ['枫叶', 'autumn maple'], ['夏天', 'summer'], ['春天', 'spring'],
  ['东京', 'tokyo'], ['京都', 'kyoto'], ['上海', 'shanghai'], ['香港', 'hong kong'], ['纽约', 'new york'], ['巴黎', 'paris'],
  ['城市', 'cityscape'], ['夜景', 'night city'], ['街道', 'street'], ['建筑', 'architecture'], ['城堡', 'castle'], ['桥梁', 'bridge'],
  ['风景', 'landscape scenery'], ['自然', 'nature'], ['沙漠', 'desert'], ['瀑布', 'waterfall'], ['湖泊', 'lake'],
  ['跑车', 'sports car'], ['汽车', 'car'], ['摩托', 'motorcycle'], ['飞机', 'aircraft'], ['火车', 'train'], ['电车', 'train'],
  ['动漫', 'anime'], ['少女', 'girl'], ['美女', 'portrait woman'], ['明星', 'celebrity portrait'], ['人物', 'portrait']
];

const GENRE_HINTS = {
  anime: { en: 'anime', zh: '动漫' },
  people: { en: 'portrait photography', zh: '人像摄影' },
  landscape: { en: 'landscape scenery', zh: '风景' },
  animals: { en: 'animal photography', zh: '动物' },
  architecture: { en: 'architecture cityscape', zh: '建筑' },
  space: { en: 'space astronomy', zh: '太空' },
  abstract: { en: 'abstract minimal', zh: '抽象极简' }
};

function hasCjk(text) {
  return /[\u4e00-\u9fff\u3040-\u30ff]/.test(String(text || ''));
}

function translateZhToEn(raw) {
  let text = String(raw || '').trim();
  const translated = [];
  for (const [cn, en] of CN_EN_LEXICON) {
    if (text.includes(cn)) {
      translated.push(en);
      text = text.split(cn).join(' ');
    }
  }
  const ascii = text.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (ascii) translated.push(ascii);
  return [...new Set(translated.join(' ').split(/\s+/).filter(Boolean))].join(' ');
}

function fallbackPlan(prompt, context = {}) {
  const clean = String(prompt || '').trim();
  const ratio = context.ratio && context.ratio !== 'any' ? context.ratio : 'any';
  const genre = context.genre && context.genre !== 'all' ? context.genre : 'all';
  const genreHint = GENRE_HINTS[genre] || null;
  const ratioHint = ratio === '16:10' ? '16:10' : ratio === 'ultrawide' ? 'ultrawide' : ratio === 'portrait' ? 'vertical' : '4k';
  const enBase = hasCjk(clean) ? translateZhToEn(clean) : clean;
  const enWithGenre = enBase
    ? (genreHint && !enBase.toLowerCase().includes(genreHint.en.split(' ')[0]) ? `${enBase} ${genreHint.en}` : enBase)
    : (genreHint ? genreHint.en : '');

  const webQueries = [];
  if (enBase) webQueries.push(`${enBase} ${ratioHint} wallpaper`);
  if (enWithGenre && enWithGenre !== enBase) webQueries.push(`${enWithGenre} wallpaper 4k`);
  if (!webQueries.length) webQueries.push(`${clean} ${ratioHint} wallpaper`);

  const zhBase = genreHint && !clean.includes(genreHint.zh) ? `${clean} ${genreHint.zh}` : clean;
  const zhQueries = [...new Set([`${zhBase} 4K 高清壁纸`, `${clean} 4K 壁纸`])];
  const wallhavenQueries = enBase ? [enBase] : [];

  return {
    summary: clean,
    webQueries: [...new Set(webQueries)].slice(0, 2),
    zhQueries: zhQueries.slice(0, 2),
    wallhavenQueries,
    tags: [...new Set([...(enBase ? enBase.toLowerCase().split(/\s+/) : []), ...clean.split(/[\s,，、/]+/)])].filter(Boolean).slice(0, 6),
    genre,
    tone: context.tone || 'any',
    ratio
  };
}

async function planIntent(prompt, credentials, context = {}, fetchFn = null) {
  const hasKey = Boolean(String(credentials?.aiApiKey || '').trim());
  if (!hasKey) {
    return { plan: fallbackPlan(prompt, context), aiUsed: false, aiError: null };
  }
  const screenRatio = context.displayRatio || '16:9';
  const systemPrompt = [
    'You are a wallpaper search query planner for a Windows desktop wallpaper app.',
    'Convert the user request (any language) into high-recall bilingual search queries for clean, watermark-free HD/4K desktop wallpapers.',
    'Return ONLY a compact JSON object with these fields:',
    '- summary: short summary in the user language (max 24 chars)',
    '- webQueries: array of 2 concise English image-search queries ending with "wallpaper 4k" (or "vertical wallpaper" if portrait)',
    '- zhQueries: array of 1-2 concise Chinese wallpaper queries ending with "4K壁纸" (great for anime, games, movies, and Chinese scenes)',
    '- wallhavenQueries: array of 2 short English tag queries (1-3 words each, broad + specific, no punctuation) suitable for Wallhaven',
    '- tags: array of 3-6 concise lowercase English keywords',
    '- genre: one of ["all","anime","people","landscape","animals","architecture","space","abstract"]',
    '- tone: one of ["any","warm","cool","green","mono","neutral"]',
    '- ratio: one of ["any","16:9","16:10","4:3","1:1","ultrawide","portrait"] (use "any" unless the user explicitly specifies an orientation/ratio)'
  ].join('\n');

  const userPrompt = `User query: ${prompt}\nCurrent screen ratio: ${screenRatio}\nActive ratio filter: ${context.ratio || 'any'}`;
  try {
    const res = await callLLM({ credentials, systemPrompt, userPrompt, maxTokens: 380, jsonMode: true, fetchFn });
    const parsed = extractJsonObject(res.text);
    const webQueries = (Array.isArray(parsed.webQueries) ? parsed.webQueries : [])
      .map(q => String(q || '').trim()).filter(Boolean).slice(0, 2);
    const zhQueries = (Array.isArray(parsed.zhQueries) ? parsed.zhQueries : [])
      .map(q => String(q || '').trim()).filter(Boolean).slice(0, 2);
    const wallhavenQueries = (Array.isArray(parsed.wallhavenQueries) ? parsed.wallhavenQueries : [])
      .map(q => String(q || '').trim()).filter(Boolean).slice(0, 2);
    const validGenres = ['all', 'anime', 'people', 'landscape', 'animals', 'architecture', 'space', 'abstract'];
    const validTones = ['any', 'warm', 'cool', 'green', 'mono', 'neutral'];
    const validRatios = ['any', '16:9', '16:10', '4:3', '1:1', 'ultrawide', 'portrait'];
    const fb = fallbackPlan(prompt, context);
    const plan = {
      summary: String(parsed.summary || prompt).trim().slice(0, 40),
      webQueries: webQueries.length ? webQueries : fb.webQueries,
      zhQueries: zhQueries.length ? zhQueries : fb.zhQueries,
      wallhavenQueries: wallhavenQueries.length ? wallhavenQueries : webQueries.slice(0, 1),
      tags: (Array.isArray(parsed.tags) ? parsed.tags : []).map(t => String(t || '').trim().toLowerCase()).filter(Boolean).slice(0, 8),
      genre: validGenres.includes(parsed.genre) ? parsed.genre : (context.genre || 'all'),
      tone: validTones.includes(parsed.tone) ? parsed.tone : (context.tone || 'any'),
      ratio: context.ratio && context.ratio !== 'any'
        ? context.ratio
        : (validRatios.includes(parsed.ratio) ? parsed.ratio : 'any')
    };
    return { plan, aiUsed: true, aiError: null, model: res.model, provider: res.provider };
  } catch (error) {
    return {
      plan: fallbackPlan(prompt, context),
      aiUsed: false,
      aiError: String(error.message || error)
    };
  }
}

/* ---------------- global web image adapters ---------------- */
function urlId(prefix, url) {
  return prefix + ':' + crypto.createHash('sha1').update(String(url)).digest('hex').slice(0, 14);
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'web'; }
}

async function searchBingWeb(query, ratio, fetchFn) {
  let qft = '+filterui:imagesize-large';
  if (ratio === 'portrait') qft += '+filterui:aspect-tall';
  else if (ratio === '1:1') qft += '+filterui:aspect-square';
  else if (ratio !== 'any') qft += '+filterui:aspect-wide';
  const url = `https://www.bing.com/images/async?q=${encodeURIComponent(query)}&first=1&count=35&qft=${encodeURIComponent(qft)}`;
  const html = await httpText(url, {
    timeout: 9000,
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8' }
  }, fetchFn);

  const items = [];
  const anchorRe = /<a\b[^>]*\bclass="iusc"[^>]*>/g;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    const tag = match[0];
    const mAttr = /\bm="([^"]+)"/.exec(tag);
    if (!mAttr) continue;
    let meta;
    try { meta = JSON.parse(decodeHtmlEntities(mAttr[1])); } catch { continue; }
    const fullUrl = meta?.murl;
    const thumbUrl = meta?.turl;
    if (!fullUrl || !isSafeHttpsUrl(fullUrl)) continue;
    const hrefAttr = /\bhref="([^"]+)"/.exec(tag);
    const href = hrefAttr ? decodeHtmlEntities(hrefAttr[1]) : '';
    const wMatch = /[?&]expw=(\d+)/.exec(href);
    const hMatch = /[?&]exph=(\d+)/.exec(href);
    const width = wMatch ? Number(wMatch[1]) : null;
    const height = hMatch ? Number(hMatch[1]) : null;
    if (width && height && Math.max(width, height) < 1280) continue;
    if (width && height && Math.min(width, height) < 720) continue;
    const domain = hostOf(meta.purl || fullUrl);
    items.push({
      id: urlId('web', fullUrl),
      source: 'aiweb',
      sourceLabel: 'WEB · BING',
      title: decodeHtmlEntities(meta.t).replace(/\s*[-|·]\s*[^-|·]{2,30}$/, '').trim() || '—',
      author: domain,
      description: decodeHtmlEntities(meta.desc || ''),
      tags: [],
      tagsCn: [],
      genres: [],
      width,
      height,
      ratio: width && height ? ratioOf(width, height) : null,
      tone: null,
      thumbUrl: isSafeHttpsUrl(thumbUrl) ? thumbUrl : fullUrl,
      fullUrl,
      pageUrl: isSafeHttpsUrl(meta.purl) ? meta.purl : fullUrl,
      license: domain + ' / 全网来源',
      date: '',
      aiWeb: true
    });
  }
  return items;
}

async function searchBaiduWeb(query, ratio, fetchFn) {
  const params = new URLSearchParams({
    tn: 'resultjson_com', logid: '1', ipn: 'rj', ct: '201326592', fp: 'result',
    word: query, queryWord: query, cl: '2', lm: '-1', ie: 'utf-8', oe: 'utf-8',
    z: '3', pn: '0', rn: '36'
  });
  if (ratio !== 'portrait' && ratio !== '1:1') {
    params.set('width', '1920');
    params.set('height', '1080');
  }
  const url = `https://image.baidu.com/search/acjson?${params}`;
  const raw = await httpText(url, {
    timeout: 7500,
    headers: { 'User-Agent': BROWSER_UA, Referer: 'https://image.baidu.com/', Accept: 'application/json, text/plain, */*' }
  }, fetchFn);
  const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const items = [];
  for (const entry of data?.data || []) {
    if (!entry || typeof entry !== 'object') continue;
    const objUrl = entry.replaceUrl?.[0]?.ObjURL || '';
    const hoverUrl = entry.hoverURL || entry.middleURL || entry.thumbURL || '';
    const fullUrl = isSafeHttpsUrl(objUrl) ? objUrl : (isSafeHttpsUrl(hoverUrl) ? hoverUrl : '');
    if (!fullUrl) continue;
    const thumbUrl = isSafeHttpsUrl(hoverUrl) ? hoverUrl : fullUrl;
    const width = Number(entry.width) || null;
    const height = Number(entry.height) || null;
    if (width && height && (Math.max(width, height) < 1280 || Math.min(width, height) < 720)) continue;
    const pageUrl = entry.replaceUrl?.[0]?.FromURL || '';
    const domain = hostOf(pageUrl || fullUrl);
    const title = decodeHtmlEntities(String(entry.fromPageTitleEnc || entry.fromPageTitle || '').replace(/<[^>]+>/g, '')).trim();
    items.push({
      id: urlId('baidu', fullUrl),
      source: 'aiweb',
      sourceLabel: 'WEB · BAIDU',
      title: title || '—',
      author: domain,
      description: '',
      tags: [],
      tagsCn: [],
      genres: [],
      width,
      height,
      ratio: width && height ? ratioOf(width, height) : null,
      tone: null,
      thumbUrl,
      fullUrl,
      pageUrl: isSafeHttpsUrl(pageUrl) ? pageUrl : fullUrl,
      license: domain + ' / 全网来源',
      date: '',
      aiWeb: true
    });
  }
  return items;
}

async function searchSerper(query, apiKey, ratio, fetchFn) {
  if (!apiKey) return [];
  const data = await httpJson('https://google.serper.dev/images', {
    method: 'POST',
    timeout: 7500,
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
    body: JSON.stringify({ q: query, num: 24 })
  }, fetchFn);
  const items = [];
  for (const img of data?.images || []) {
    const fullUrl = img.imageUrl;
    if (!isSafeHttpsUrl(fullUrl)) continue;
    const width = Number(img.imageWidth) || null;
    const height = Number(img.imageHeight) || null;
    if (width && height && (Math.max(width, height) < 1280 || Math.min(width, height) < 720)) continue;
    const domain = img.domain || hostOf(img.link || fullUrl);
    items.push({
      id: urlId('serper', fullUrl),
      source: 'aiweb',
      sourceLabel: 'WEB · GOOGLE',
      title: String(img.title || '').trim() || '—',
      author: img.source || domain,
      description: '',
      tags: [],
      tagsCn: [],
      genres: [],
      width,
      height,
      ratio: width && height ? ratioOf(width, height) : null,
      tone: null,
      thumbUrl: isSafeHttpsUrl(img.thumbnailUrl) ? img.thumbnailUrl : fullUrl,
      fullUrl,
      pageUrl: isSafeHttpsUrl(img.link) ? img.link : fullUrl,
      license: domain + ' / Google 全网',
      date: '',
      aiWeb: true
    });
  }
  return items;
}

async function searchBrave(query, apiKey, ratio, fetchFn) {
  if (!apiKey) return [];
  const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=24&safesearch=strict`;
  const data = await httpJson(url, {
    timeout: 7500,
    headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' }
  }, fetchFn);
  const items = [];
  for (const img of data?.results || []) {
    const fullUrl = img?.properties?.url;
    if (!isSafeHttpsUrl(fullUrl)) continue;
    const width = Number(img?.properties?.width) || null;
    const height = Number(img?.properties?.height) || null;
    if (width && height && (Math.max(width, height) < 1280 || Math.min(width, height) < 720)) continue;
    const domain = hostOf(img.url || fullUrl);
    items.push({
      id: urlId('brave', fullUrl),
      source: 'aiweb',
      sourceLabel: 'WEB · BRAVE',
      title: String(img.title || '').trim() || '—',
      author: img.source || domain,
      description: '',
      tags: [],
      tagsCn: [],
      genres: [],
      width,
      height,
      ratio: width && height ? ratioOf(width, height) : null,
      tone: null,
      thumbUrl: isSafeHttpsUrl(img?.thumbnail?.src) ? img.thumbnail.src : fullUrl,
      fullUrl,
      pageUrl: isSafeHttpsUrl(img.url) ? img.url : fullUrl,
      license: domain + ' / Brave 全网',
      date: '',
      aiWeb: true
    });
  }
  return items;
}

async function searchOpenverse(query, ratio, fetchFn) {
  const aspect = ratio === 'portrait' ? 'tall' : ratio === '1:1' ? 'square' : 'wide';
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=16&aspect_ratio=${aspect}`;
  const data = await httpJson(url, { timeout: 7000 }, fetchFn);
  const items = [];
  for (const img of data?.results || []) {
    const fullUrl = img.url;
    if (!isSafeHttpsUrl(fullUrl)) continue;
    const width = Number(img.width) || null;
    const height = Number(img.height) || null;
    if (!width || !height || Math.max(width, height) < 1280 || Math.min(width, height) < 720) continue;
    items.push({
      id: urlId('openverse', fullUrl),
      source: 'aiweb',
      sourceLabel: 'WEB · OPENVERSE',
      title: String(img.title || '').trim() || '—',
      author: img.creator || img.source || 'Openverse',
      description: '',
      tags: (img.tags || []).map(t => t.name).filter(Boolean).slice(0, 8),
      tagsCn: [],
      genres: [],
      width,
      height,
      ratio: ratioOf(width, height),
      tone: null,
      thumbUrl: isSafeHttpsUrl(img.thumbnail) ? img.thumbnail : fullUrl,
      fullUrl,
      pageUrl: isSafeHttpsUrl(img.foreign_landing_url) ? img.foreign_landing_url : fullUrl,
      license: (img.license || 'CC').toUpperCase(),
      date: '',
      aiWeb: true
    });
  }
  return items;
}

async function searchCommonsWeb(query, ratio, fetchFn) {
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6' +
    `&gsrsearch=${encodeURIComponent(query)}&gsrlimit=12&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=640&format=json`;
  const data = await httpJson(url, { timeout: 7000 }, fetchFn);
  const items = [];
  for (const page of Object.values(data?.query?.pages || {})) {
    const info = page?.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|webp)$/i.test(info.mime || '')) continue;
    const fullUrl = info.url;
    if (!isSafeHttpsUrl(fullUrl)) continue;
    const width = Number(info.width) || 0;
    const height = Number(info.height) || 0;
    if (Math.max(width, height) < 1600 || Math.min(width, height) < 900) continue;
    const title = String(page.title || '').replace(/^File:/i, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const artist = String(info.extmetadata?.Artist?.value || '').replace(/<[^>]+>/g, '').trim().slice(0, 60);
    const license = String(info.extmetadata?.LicenseShortName?.value || 'Wikimedia Commons').trim();
    items.push({
      id: urlId('wmc', fullUrl),
      source: 'aiweb',
      sourceLabel: 'WEB · COMMONS',
      title: title || '—',
      author: artist || 'Wikimedia Commons',
      description: '',
      tags: [],
      tagsCn: [],
      genres: [],
      width,
      height,
      ratio: ratioOf(width, height),
      tone: null,
      thumbUrl: isSafeHttpsUrl(info.thumburl) ? info.thumburl : fullUrl,
      fullUrl,
      pageUrl: isSafeHttpsUrl(info.descriptionurl) ? info.descriptionurl : fullUrl,
      license,
      date: '',
      aiWeb: true
    });
  }
  return items;
}

function scoreItem(item, plan, preferredRatio) {
  let score = 0;
  if (item.width && item.height) {
    const shortEdge = Math.min(item.width, item.height);
    if (shortEdge >= 2160) score += 35;
    else if (shortEdge >= 1440) score += 28;
    else if (shortEdge >= 1080) score += 20;
    else if (shortEdge >= 720) score += 8;
    else score -= 30;
  } else {
    score += 4;
  }
  const targetRatio = plan.ratio !== 'any' ? plan.ratio : preferredRatio;
  if (targetRatio && targetRatio !== 'any' && item.ratio) {
    if (item.ratio === targetRatio) score += 30;
    else if (['16:9', '16:10'].includes(targetRatio) && ['16:9', '16:10'].includes(item.ratio)) score += 16;
    else if (targetRatio === 'portrait' && item.ratio !== 'portrait') score -= 24;
    else if (targetRatio !== 'portrait' && item.ratio === 'portrait') score -= 20;
  }
  const hay = [item.title, ...(item.tags || []), item.description].join(' ').toLowerCase();
  for (const tag of plan.tags || []) {
    if (tag && hay.includes(tag)) score += 7;
  }
  if (item.sourceLabel === 'WEB · GOOGLE') score += 12;
  else if (item.sourceLabel === 'WEB · BRAVE') score += 10;
  else if (item.source === 'wallhaven') score += 8;
  return score;
}

async function search({ prompt, credentials = {}, context = {}, providers = null, fetchFn = null, signal, onProgress }) {
  const cleanPrompt = String(prompt || '').trim().slice(0, 200);
  if (!cleanPrompt) return { ok: false, error: 'Empty search prompt', items: [] };

  signal?.throwIfAborted();
  const planned = await planIntent(cleanPrompt, credentials, context, fetchFn);
  signal?.throwIfAborted();
  const { plan } = planned;
  const primaryWebQuery = plan.webQueries[0] || `${cleanPrompt} wallpaper 4k`;
  const secondaryWebQuery = plan.webQueries[1] || '';
  const zhQuery = (plan.zhQueries && plan.zhQueries[0]) || `${cleanPrompt} 4K壁纸`;
  const zhQuery2 = (plan.zhQueries && plan.zhQueries[1]) || '';
  const whQuery = (plan.wallhavenQueries && plan.wallhavenQueries[0]) || '';
  const whQuery2 = (plan.wallhavenQueries && plan.wallhavenQueries[1]) || '';
  const enReady = Boolean(whQuery && !hasCjk(whQuery));
  const activeGenre = context.genre && context.genre !== 'all' ? context.genre : (plan.genre || 'all');
  const targetRatio = plan.ratio !== 'any' ? plan.ratio : 'any';
  const preferredRatio = context.displayRatioBucket || 'any';

  const tasks = [];
  const addTask = (label, run) => tasks.push({ label, run });

  if (credentials.serperKey) {
    addTask('Google', () => searchSerper(primaryWebQuery, credentials.serperKey, targetRatio, fetchFn));
  }
  if (credentials.braveKey) {
    addTask('Brave', () => searchBrave(primaryWebQuery, credentials.braveKey, targetRatio, fetchFn));
  }
  addTask('百度', () => searchBaiduWeb(zhQuery, targetRatio, fetchFn));
  if (zhQuery2 && zhQuery2 !== zhQuery) {
    addTask('百度', () => searchBaiduWeb(zhQuery2, targetRatio, fetchFn));
  }
  addTask('Bing', () => searchBingWeb(primaryWebQuery, targetRatio, fetchFn));
  if (secondaryWebQuery && secondaryWebQuery.toLowerCase() !== primaryWebQuery.toLowerCase()) {
    addTask('Bing', () => searchBingWeb(secondaryWebQuery, targetRatio, fetchFn));
  }
  if (enReady) {
    addTask('Openverse', () => searchOpenverse(whQuery, targetRatio, fetchFn));
    addTask('Commons', () => searchCommonsWeb(whQuery, targetRatio, fetchFn));
  }

  if (enReady && providers && typeof providers.wallhavenPage === 'function') {
    const options = { page: 1, genre: activeGenre, useQueryGenre: false, resolution: 'any', sort: 'relevance', signal };
    const first = providers.wallhavenPage({ ...options, query: whQuery, ratio: targetRatio }).then(r => r.items || []);
    addTask('Wallhaven', () => first);
    addTask('Wallhaven', async () => {
      const list = await first.catch(() => []);
      signal?.throwIfAborted();
      if (list.length >= 12) return [];
      const query = whQuery2 && !hasCjk(whQuery2) ? whQuery2 : whQuery;
      const result = await providers.wallhavenPage({ ...options, query, ratio: 'any' });
      return result.items || [];
    });
  }
  if (enReady && providers && typeof providers.searchOnline === 'function') {
    for (const [source, label] of [['unsplash', 'Unsplash'], ['pexels', 'Pexels']]) {
      if (!credentials[source]) continue;
      addTask(label, async () => {
        const result = await providers.searchOnline(credentials, whQuery, source, activeGenre, { signal });
        if (result.failed?.length) throw new Error(label + ' search failed');
        return result.items || [];
      });
    }
  }

  const buckets = new Array(tasks.length);
  function snapshot() {
    const settled = buckets.filter(Boolean);
    const seen = new Set();
    const merged = [];
    const countByLabel = new Map();
    for (const bucket of settled) {
      for (const item of bucket.items) {
        const key = String(item.fullUrl || item.id).split('?')[0].toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        countByLabel.set(bucket.label, (countByLabel.get(bucket.label) || 0) + 1);
      }
    }
    merged.sort((a, b) => scoreItem(b, plan, preferredRatio) - scoreItem(a, plan, preferredRatio));
    const succeeded = new Set(settled.filter(bucket => bucket.ok).map(bucket => bucket.label));
    return {
      ok: true, items: merged.slice(0, 120), plan,
      aiUsed: planned.aiUsed, aiError: planned.aiError,
      model: planned.model || null, provider: planned.provider || null,
      channels: [...countByLabel].map(([name, count]) => ({ name, count })),
      completed: settled.length, total: tasks.length,
      failed: [...new Set(settled.filter(bucket => !bucket.ok && !succeeded.has(bucket.label)).map(bucket => bucket.label))]
    };
  }

  await Promise.all(tasks.map(async ({ label, run }, index) => {
    try {
      const list = await run();
      buckets[index] = { label, ok: true, items: Array.isArray(list) ? list : [] };
    } catch {
      buckets[index] = { label, ok: false, items: [] };
    }
    if (!signal?.aborted) onProgress?.(snapshot());
  }));
  signal?.throwIfAborted();
  return snapshot();
}

module.exports = { search, testConnection, planIntent };
