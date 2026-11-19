'use strict';

const wallpaperSearch = (() => {
  const cache = new WeakMap();
  const nameCache = new WeakMap();
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
  const stopWords = new Set(['and', 'the', 'in', 'by', 'of', 'on', 'for', 'with', 'from', 'a', 'an', 'to', 'unknown']);
  const animeSubject = /\b(anime|manga|waifu|chibi|vtuber|vocaloid|genshin impact)\b|动漫|動漫|动画|動畫|漫画|漫畫|二次元|アニメ/u;
  const drawnSubject = /\b(illustrations?|fan art|fanart|digital art|paintings?|cartoon|drawings?)\b|插画|插畫|同人图|同人圖|手绘|手繪|イラスト/u;
  const photoSubject = /\b(photograph(?:s|y|ic)?|photos?|live action|cosplay)\b|摄影|攝影|照片|写真|寫真|真人|実写/u;
  const realPerson = /\b(celebrit(?:y|ies)|actors?|actress(?:es)?|singers?|cosplayers?)\b|明星|艺人|藝人|演员|演員|歌手|模特|有名人/u;
  const humanSubject = /\b(people|person|portraits?|women|woman|men|man|children|girls?|boys?|models?)\b|人物|人像|肖像|少女|少年|ポートレート/u;
  const photoSources = new Set(['unsplash', 'pexels']);
  const genres = {
    landscape: /\b(landscapes?|scenery|mountains?|forests?|lakes?|oceans?|rivers?|beaches|waterfalls?|deserts?|sunsets?|sunrises?)\b|风景|風景|山脉|山脈|森林|树林|海洋|山水|瀑布|日落|日出|湖泊/u,
    animals: /\b(animals?|wildlife|cats?|dogs?|birds?|fox(?:es)?|wolves|dolphins?|lions?|tigers?)\b|动物|動物|野生动物|猛兽|海豚|猫|鳥|鲸/u,
    architecture: /\b(architecture|cityscapes?|cities|city|buildings?|skyscrapers?|bridges?|castles?)\b|建筑|建築|城市|都市|楼宇|桥梁|天际线|街景/u,
    space: /\b(astronomy|galax(?:y|ies)|nebulae?|planets?|stars?|milky way|outer space)\b|太空|宇宙|星系|星云|行星|星空|銀河/u,
    abstract: /\b(abstract|minimal(?:ism|ist)?|geometric|monochrome|gradients?|fractal)\b|抽象|极简|極簡|几何|幾何|渐变|漸變|ミニマル/u
  };

  const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
  const terms = value => normalize(value).split(' ').filter(Boolean);
  const matches = (entry, words) => words.every(word => entry.text.includes(word));

  function genreScores(item, tags, themeText) {
    const scores = new Map();
    const declared = new Set(item.genres || []);
    for (const [genre, pattern] of Object.entries(genres)) {
      if (declared.has(genre)) scores.set(genre, 3);
      else if (tags.some(tag => pattern.test(tag))) scores.set(genre, 2);
      else if (pattern.test(themeText)) scores.set(genre, 1);
    }
    const curatedAnime = item.source === 'anime' || item.source === 'nekos' || declared.has('anime');
    const photo = item.medium === 'photo' || photoSubject.test(themeText);
    const cosplayPhoto = photo && !drawnSubject.test(themeText) &&
      /\b(cosplay|cosplayer|live action)\b|真人版|真人翻拍|実写/u.test(themeText);
    if (curatedAnime || (!cosplayPhoto && animeSubject.test(themeText))) {
      scores.set('anime', curatedAnime ? 3 : tags.some(tag => animeSubject.test(tag)) ? 2 : 1);
    } else if (!drawnSubject.test(themeText)) {
      if (item.medium === 'photo' && declared.has('people')) scores.set('people', 3);
      else if (realPerson.test(themeText) || cosplayPhoto) scores.set('people', 2);
      else if ((photo || photoSources.has(item.source)) && humanSubject.test(themeText)) scores.set('people', 1);
    }
    return scores;
  }

  function index(item) {
    if (cache.has(item)) return cache.get(item);
    const tags = [...(item.tags || []), ...(item.tagsCn || [])];
    const words = new Map();
    const add = (label, weight) => {
      const word = normalize(label);
      if (!word || word.length > 36 || /^\p{N}+$/u.test(word) || stopWords.has(word)) return;
      if (word.length < 2 && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)) return;
      const existing = words.get(word);
      if (!existing || existing.weight < weight) words.set(word, { label: String(label).trim(), weight });
    };
    for (const tag of tags) add(tag, 4);
    add(item.title, 3);
    for (const part of segmenter.segment(item.title || '')) if (part.isWordLike) add(part.segment, 2);
    add(item.author, 1);
    const themeText = normalize([item.title, ...tags, item.source === 'local' ? '' : item.description].join(' '));
    const entry = { text: normalize([item.title, item.author, item.description, item.source, item.sourceLabel, ...tags].join(' ')),
      words, genres: genreScores(item, tags.map(normalize), themeText), date: String(item.date || '').replace(/\D/g, '') };
    cache.set(item, entry);
    return entry;
  }

  function indexWithName(item, name) {
    const base = index(item);
    if (!name) return base;
    const cached = nameCache.get(item);
    if (cached?.name === name) return cached.entry;
    const words = new Map(base.words);
    words.set(normalize(name), { label: name, weight: 6 });
    for (const part of segmenter.segment(name)) {
      if (part.isWordLike) words.set(normalize(part.segment), { label: part.segment, weight: 5 });
    }
    const entry = { ...base, text: base.text + ' ' + normalize(name), words };
    nameCache.set(item, { name, entry });
    return entry;
  }

  function suggest(items, value, recent = [], limit = 6, customName = () => '') {
    const query = normalize(value);
    if (!query) return recent.slice(0, limit);
    const before = terms(value);
    const fragment = /[^\p{L}\p{M}\p{N}]$/u.test(value) ? '' : before.pop();
    const scores = new Map();
    for (const item of items) {
      const entry = indexWithName(item, customName(item));
      if (!matches(entry, before)) continue;
      for (const [word, candidate] of entry.words) {
        const rank = word.startsWith(query) ? 0 : word.startsWith(fragment) ? 1 : word.includes(fragment) ? 2 : -1;
        if (rank < 0) continue;
        const result = rank === 0 ? candidate.label : [...before, candidate.label].join(' ');
        const key = normalize(result);
        if (key === query || before.includes(word) || !matches(entry, terms(result))) continue;
        const score = scores.get(key);
        if (score) {
          score.rank = Math.min(score.rank, rank);
          score.weight += candidate.weight;
        } else {
          scores.set(key, { result, rank, weight: candidate.weight });
        }
      }
    }
    return [...scores.values()].sort((left, right) => left.rank - right.rank || right.weight - left.weight ||
      left.result.localeCompare(right.result)).slice(0, limit).map(entry => entry.result);
  }

  const matchesGenre = (item, genre) => genre === 'all' || index(item).genres.has(genre);
  function compareGenre(left, right, genre, newestFirst) {
    const leftEntry = index(left);
    const rightEntry = index(right);
    const priority = (rightEntry.genres.get(genre) || 0) - (leftEntry.genres.get(genre) || 0);
    return priority || (newestFirst ? rightEntry.date.localeCompare(leftEntry.date) : 0);
  }
  const compareDate = (left, right) => index(right).date.localeCompare(index(left).date);
  const comparePopularity = (left, right) => (right.stats?.favorites ?? -1) - (left.stats?.favorites ?? -1) ||
    (right.stats?.views ?? -1) - (left.stats?.views ?? -1);
  return { normalize, terms, matches, index, indexWithName, suggest, matchesGenre, compareGenre, compareDate, comparePopularity };
})();

if (typeof module === 'object') module.exports = wallpaperSearch;
