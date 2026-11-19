'use strict';
/* WALL／SCAPE — renderer.
   One fixed 16:9 stage; WINDOW is a uniform scale of FULLSCREEN.
   Every click produces an immediate press + ink response and a text receipt. */

const $ = s => document.querySelector(s);
const api = window.wsp;
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n, l = 3) => String(n).padStart(l, '0');
const ratioOf = (w, h) => {
  if (!w || !h) return null;
  const r = w / h;
  return r > 2 ? 'ultrawide' : r > 1.6 ? '16:9' : r > 1.25 ? '4:3' : r > .9 ? '1:1' : 'portrait';
};

/* ---------------- i18n ---------------- */
const I18N = {
  zh: {
    scopeAll: '全部', scopeSaved: '收藏', scopeHistory: '历史',
    genreAll: '全部题材', genreAnime: '动漫 / 二次元', genreLandscape: '风景', genrePeople: '真人 / 明星', genreAnimals: '动物',
    genreArchitecture: '城市建筑', genreSpace: '太空', genreAbstract: '抽象极简', genreLabel: '题材',
    toneAny: '全部', toneWarm: '暖', toneCool: '冷', toneGreen: '绿', toneMono: '单色', toneNeutral: '中性',
    ratioAny: '全部', searchPlaceholder: '搜索壁纸', recentSearches: '最近搜索',
    clearSearchHistory: '清空历史',
    refresh: '刷新', settings: '设置', backToTop: '回顶部',
    sortLabel: '排序', sortDefault: '推荐', sortPopular: '热门', sortNewest: '最新',
    popularityFavorites: '收藏', popularityViews: '浏览',
    engineBad: '壁纸引擎不可用', display: '显示器', images: '张图片',
    close: '关闭', save: '收藏', savedOn: '已收藏 ◆', saveImageAs: '导出原图', sourceLink: '来源 ↗',
    renameFavorite: '重命名', favoriteNameHint: '留空可恢复原名', cancelRename: '取消', confirmRename: '保存名称',
    favoriteNameSaved: '收藏名称已保存', favoriteNameInvalid: '名称最多 60 字，须包含文字或数字',
    favoriteNameMissing: '这张壁纸已取消收藏',
    motionLibrary: '动态壁纸', motionFeatured: '精选壁纸', motionLocal: '本地视频', motionImport: '导入视频', motionSearch: '搜索精选壁纸',
    motionSearchAction: '搜索', motionStop: '停止播放', motionEmptyLocal: '导入 MP4 或 WebM 开始预览',
    motionEmptyFeatured: '没有匹配的精选壁纸', motionLoading: '正在读取壁纸…', motionStarting: '正在准备视频…',
    motionPlaying: '正在播放', motionPaused: '全屏时已暂停', motionReconnecting: '等待显示器或桌面恢复',
    motionPreviewFailed: '无法预览此视频',
    lockScreen: '锁屏', on: '开', off: '关', monitor: '显示器', allDisplays: '全部', oneDisplay: '1 台显示器',
    apply: '应用到桌面',
    modeFill: '覆盖', modeStretch: '拉伸', modeFit: '适应', modeTile: '平铺', modeCenter: '居中', modeSpan: '跨屏',
    noteFill: '覆盖 · 等比裁切填满', noteStretch: '拉伸 · 铺满不保比例', noteFit: '适应 · 等比完整显示',
    noteTile: '平铺 · 原尺寸重复', noteCenter: '居中 · 原尺寸居中', noteSpan: '跨屏 · 延伸过所有屏幕',
    nothing: '这一版没有内容', imageUnavailable: '图片不可用', bootFailed: '启动失败',
    preparingWallpaper: '正在准备壁纸', downloadingWallpaper: '正在下载原图',
    applying: '正在应用到桌面', applied: '已应用到桌面', applyFailed: '应用失败',
    imageNetworkError: '连接原图服务器失败，请稍后重试，或打开「来源」检查原图',
    desktopChanged: '应用前检测到壁纸设置或显示器布局变化，请核对目标屏幕后重试',
    filtersCleared: '筛选已清空', savedToast: '已收藏', removed: '已取消收藏',
    refreshing: '正在刷新图源', indexed: '张图已入索引', searchUnavailable: '部分在线图源暂不可用', usingCache: '使用缓存',
    imageSaved: '图片已保存', cancelled: '已取消', saveFailed: '保存失败', savingImage: '正在保存图片',
    oneDisplayToast: '检测到一台显示器 / 多屏已就绪',
    saveFraming: '保存构图', resetFraming: '重置构图', framingSaved: '已保存此图构图', framingReset: '已恢复默认构图',
    framingControls: 'Ctrl＋滚轮缩放 · 拖动移动 · 滚轮翻阅',
    undoWallpaper: '撤销上次应用', wallpaperUndone: '已恢复上次桌面壁纸',
    desktopProfileNote: '保存每块屏幕当前的壁纸。相同的屏幕布局重新连接时会恢复。',
    saveDesktopProfile: '保存显示器方案', restoreDesktopProfile: '恢复显示器方案',
    desktopProfileSaved: '已保存当前屏幕方案', desktopProfileRestored: '已恢复屏幕方案',
    lockOn: '锁屏同步已开', lockOff: '锁屏同步已关', allDisplaysToast: '全部显示器',
    noSourceLink: '没有来源链接', nothingChanged: '没有改动', credentialsSaved: '凭据已保存在本机',
    localFolderAdded: '本地文件夹已添加', cacheCleared: '缓存已清理', cacheClearFailed: '缓存清理失败',
    autoStartOn: '开机自启已开', autoStartOff: '开机自启已关', localFolderNone: '没有本地文件夹',
    onlineSources: '在线图源', credentialsTitle: '凭据',
    credNote: '留空即为关闭。填入后刷新即启用对应图源，凭据只保存在本机。',
    localLibrary: '本地图库', desktop: '桌面', language: '语言', keyboard: '键盘',
    addLocalFolder: '添加本地文件夹', saveCredentials: '保存凭据', autoStart: '开机自启',
    windowMode: '显示模式', immersive: '全屏', window: '窗口', clearCache: '清理缓存',
    checking: '检测中', available: '可用', blocked: '受限', notConnected: '未连接',
    keyShow: '显示 / 隐藏', keyMode: '窗口 / 全屏', keyStep: '上一张 / 下一张',
    keyFav: '收藏当前', keySearch: '搜索', keyClear: '清空筛选', keyExport: '导出原图', keyEsc: '收起 / 隐藏',
    keySuggest: '搜索联想 / 采纳',
    unsplashKey: 'UNSPLASH 访问密钥', pexelsKey: 'PEXELS API 密钥',
    moreWallhaven: '更多壁纸', loadingMore: '正在找图…', retryMore: '重试加载',
    waitingForImages: '正在寻找符合筛选的壁纸…', loadingPaused: '连接不稳定，自动续页已暂停，可点「重试加载」',
    cacheLabel: '缓存', files: '个文件', lockAvailable: '锁屏 / WINRT 可用', lockBlocked: '锁屏 / 受限',
    okLabel: '成功', failedLabel: '失败',
    opened: '已展开', closed: '已关闭', settingsOpened: '设置已打开', settingsClosed: '设置已关闭',
    modeWindow: '已切到窗口', modeFullscreen: '已切到全屏', nextItem: '下一张', prevItem: '上一张',
    unknownSize: '尺寸未标注'
  },
  en: {
    scopeAll: 'ALL', scopeSaved: 'SAVED', scopeHistory: 'HISTORY',
    genreAll: 'ALL THEMES', genreAnime: 'ANIME', genreLandscape: 'LANDSCAPE', genrePeople: 'REAL PEOPLE', genreAnimals: 'ANIMALS',
    genreArchitecture: 'ARCHITECTURE', genreSpace: 'SPACE', genreAbstract: 'ABSTRACT', genreLabel: 'Themes',
    toneAny: 'ANY', toneWarm: 'WARM', toneCool: 'COOL', toneGreen: 'GREEN', toneMono: 'MONO', toneNeutral: 'NEUTRAL',
    ratioAny: 'ANY', searchPlaceholder: 'SEARCH THE COLLECTION', recentSearches: 'Recent searches',
    clearSearchHistory: 'Clear history',
    refresh: 'REFRESH', settings: 'SETTINGS', backToTop: 'BACK TO TOP',
    sortLabel: 'SORT', sortDefault: 'RECOMMENDED', sortPopular: 'POPULAR', sortNewest: 'NEWEST',
    popularityFavorites: 'SAVES', popularityViews: 'VIEWS',
    engineBad: 'WALLPAPER ENGINE UNAVAILABLE', display: 'DISPLAY', images: 'IMAGES',
    close: 'CLOSE', save: 'SAVE', savedOn: 'SAVED ◆', saveImageAs: 'SAVE IMAGE AS', sourceLink: 'SOURCE ↗',
    renameFavorite: 'RENAME', favoriteNameHint: 'Leave blank to restore the original title.', cancelRename: 'Cancel', confirmRename: 'Save name',
    favoriteNameSaved: 'FAVORITE NAME SAVED', favoriteNameInvalid: 'Use up to 60 characters with at least one letter or number.',
    favoriteNameMissing: 'This wallpaper is no longer a favorite.',
    motionLibrary: 'MOTION', motionFeatured: 'Featured', motionLocal: 'Local videos', motionImport: 'Import videos', motionSearch: 'Search featured wallpapers',
    motionSearchAction: 'Search', motionStop: 'Stop playback', motionEmptyLocal: 'Import an MP4 or WebM video to preview it.',
    motionEmptyFeatured: 'No matching featured wallpapers.', motionLoading: 'Loading wallpapers…', motionStarting: 'Preparing video…',
    motionPlaying: 'Playing', motionPaused: 'Paused while fullscreen', motionReconnecting: 'Waiting for display or desktop',
    motionPreviewFailed: 'This video cannot be previewed.',
    lockScreen: 'LOCK SCREEN', on: 'ON', off: 'OFF', monitor: 'MONITOR', allDisplays: 'ALL', oneDisplay: '1 DISPLAY',
    apply: 'APPLY TO DESKTOP',
    modeFill: 'FILL', modeStretch: 'STRETCH', modeFit: 'FIT', modeTile: 'TILE', modeCenter: 'CENTER', modeSpan: 'SPAN',
    noteFill: 'Fill · crop to cover, keep ratio', noteStretch: 'Stretch · fill, ignore ratio', noteFit: 'Fit · show whole image',
    noteTile: 'Tile · repeat at original size', noteCenter: 'Center · original size', noteSpan: 'Span · extend across displays',
    nothing: 'NOTHING IN THIS EDITION', imageUnavailable: 'IMAGE UNAVAILABLE', bootFailed: 'BOOT FAILED',
    preparingWallpaper: 'PREPARING WALLPAPER', downloadingWallpaper: 'DOWNLOADING ORIGINAL',
    applying: 'APPLYING TO DESKTOP', applied: 'APPLIED TO DESKTOP', applyFailed: 'APPLY FAILED',
    imageNetworkError: 'Could not reach the original image server. Try again or open the source page.',
    desktopChanged: 'Wallpaper settings or the display layout changed before application. Check the target display and try again.',
    filtersCleared: 'FILTERS CLEARED', savedToast: 'SAVED', removed: 'REMOVED',
    refreshing: 'REFRESHING SOURCES', indexed: 'IMAGES INDEXED', searchUnavailable: 'SOME ONLINE SOURCES ARE UNAVAILABLE', usingCache: 'CACHED',
    imageSaved: 'IMAGE SAVED', cancelled: 'CANCELLED', saveFailed: 'SAVE FAILED', savingImage: 'SAVING IMAGE',
    oneDisplayToast: 'ONE DISPLAY DETECTED / MULTI-MONITOR READY',
    saveFraming: 'SAVE FRAMING', resetFraming: 'RESET FRAMING', framingSaved: 'FRAMING SAVED FOR THIS IMAGE', framingReset: 'DEFAULT FRAMING RESTORED',
    framingControls: 'Ctrl + wheel to zoom · Drag to pan · Wheel to browse',
    undoWallpaper: 'UNDO LAST APPLY', wallpaperUndone: 'PREVIOUS DESKTOP WALLPAPER RESTORED',
    desktopProfileNote: 'Save the wallpaper on each display. Reconnecting the same layout restores it.',
    saveDesktopProfile: 'SAVE DISPLAY PROFILE', restoreDesktopProfile: 'RESTORE DISPLAY PROFILE',
    desktopProfileSaved: 'DISPLAY PROFILE SAVED', desktopProfileRestored: 'DISPLAY PROFILE RESTORED',
    lockOn: 'LOCK SCREEN SYNC ON', lockOff: 'LOCK SCREEN SYNC OFF', allDisplaysToast: 'ALL DISPLAYS',
    noSourceLink: 'NO SOURCE LINK', nothingChanged: 'NOTHING CHANGED', credentialsSaved: 'CREDENTIALS SAVED LOCALLY',
    localFolderAdded: 'LOCAL FOLDER ADDED', cacheCleared: 'CACHE CLEARED', cacheClearFailed: 'CACHE CLEAR FAILED',
    autoStartOn: 'AUTO START ON', autoStartOff: 'AUTO START OFF', localFolderNone: 'NO LOCAL FOLDER',
    onlineSources: 'ONLINE SOURCES', credentialsTitle: 'CREDENTIALS',
    credNote: 'Leave blank to keep a source off. Credentials are stored on this machine only.',
    localLibrary: 'LOCAL LIBRARY', desktop: 'DESKTOP', language: 'LANGUAGE', keyboard: 'KEYBOARD',
    addLocalFolder: 'ADD LOCAL FOLDER', saveCredentials: 'SAVE CREDENTIALS', autoStart: 'AUTO START',
    windowMode: 'DISPLAY MODE', immersive: 'FULLSCREEN', window: 'WINDOW', clearCache: 'CLEAR CACHE',
    checking: 'CHECKING', available: 'AVAILABLE', blocked: 'BLOCKED', notConnected: 'NOT CONNECTED',
    keyShow: 'Show / hide', keyMode: 'Window / fullscreen', keyStep: 'Previous / next',
    keyFav: 'Favourite current', keySearch: 'Search', keyClear: 'Clear filters', keyExport: 'Export original', keyEsc: 'Dismiss / hide',
    keySuggest: 'Suggestions / accept',
    unsplashKey: 'UNSPLASH ACCESS KEY', pexelsKey: 'PEXELS API KEY',
    moreWallhaven: 'MORE WALLPAPERS', loadingMore: 'LOADING…', retryMore: 'RETRY',
    waitingForImages: 'LOOKING FOR MATCHING WALLPAPERS…', loadingPaused: 'AUTO-LOADING PAUSED. SELECT RETRY TO CONTINUE.',
    cacheLabel: 'CACHE', files: 'FILES', lockAvailable: 'LOCK SCREEN / WINRT AVAILABLE', lockBlocked: 'LOCK SCREEN / BLOCKED',
    okLabel: 'OK', failedLabel: 'FAILED',
    opened: 'OPENED', closed: 'CLOSED', settingsOpened: 'SETTINGS OPENED', settingsClosed: 'SETTINGS CLOSED',
    modeWindow: 'WINDOW MODE', modeFullscreen: 'FULLSCREEN MODE', nextItem: 'NEXT', prevItem: 'PREVIOUS',
    unknownSize: 'SIZE UNKNOWN'
  },
  ja: {
    scopeAll: 'すべて', scopeSaved: 'お気に入り', scopeHistory: '履歴',
    genreAll: 'すべてのテーマ', genreAnime: 'アニメ', genreLandscape: '風景', genrePeople: '実写・有名人', genreAnimals: '動物',
    genreArchitecture: '街・建築', genreSpace: '宇宙', genreAbstract: '抽象・ミニマル', genreLabel: 'テーマ',
    toneAny: 'すべて', toneWarm: '暖色', toneCool: '寒色', toneGreen: '緑', toneMono: 'モノクロ', toneNeutral: '中間色',
    ratioAny: 'すべて', searchPlaceholder: '壁紙を検索', recentSearches: '最近の検索',
    clearSearchHistory: '履歴を消去',
    refresh: '更新', settings: '設定', backToTop: '先頭へ',
    sortLabel: '並び順', sortDefault: 'おすすめ', sortPopular: '人気', sortNewest: '新着',
    popularityFavorites: '保存', popularityViews: '閲覧',
    engineBad: '壁紙エンジン利用不可', display: 'ディスプレイ', images: '枚の画像',
    close: '閉じる', save: '保存', savedOn: '保存済み ◆', saveImageAs: '画像を保存', sourceLink: '出典 ↗',
    renameFavorite: '名前を変更', favoriteNameHint: '空欄にすると元の名前に戻ります。', cancelRename: 'キャンセル', confirmRename: '名前を保存',
    favoriteNameSaved: '名前を保存しました', favoriteNameInvalid: '文字または数字を含む60文字以内の名前を入力してください。',
    favoriteNameMissing: 'この壁紙はお気に入りから削除されています。',
    motionLibrary: '動く壁紙', motionFeatured: 'おすすめ壁紙', motionLocal: 'ローカル動画', motionImport: '動画を追加', motionSearch: 'おすすめ壁紙を検索',
    motionSearchAction: '検索', motionStop: '停止', motionEmptyLocal: 'MP4 または WebM の動画を追加してください。',
    motionEmptyFeatured: '一致する壁紙が見つかりません。', motionLoading: '壁紙を読み込み中…', motionStarting: '動画を準備中…',
    motionPlaying: '再生中', motionPaused: '全画面表示中は一時停止', motionReconnecting: '画面またはデスクトップの復帰を待機中',
    motionPreviewFailed: 'この動画をプレビューできません。',
    lockScreen: 'ロック画面', on: 'オン', off: 'オフ', monitor: 'モニター', allDisplays: 'すべて', oneDisplay: '1 ディスプレイ',
    apply: 'デスクトップに適用',
    modeFill: '塗りつぶし', modeStretch: '引き伸ばし', modeFit: '全体表示', modeTile: '並べて表示', modeCenter: '中央', modeSpan: '画面横断',
    noteFill: '塗りつぶし · 比率を保ち裁断', noteStretch: '引き伸ばし · 比率無視', noteFit: '全体表示 · 比率維持',
    noteTile: '並べて表示 · 元サイズ', noteCenter: '中央 · 元サイズ', noteSpan: '画面横断 · 全ディスプレイへ',
    nothing: 'この号には何もありません', imageUnavailable: '画像を読み込めません', bootFailed: '起動失敗',
    preparingWallpaper: '壁紙を準備しています', downloadingWallpaper: '元画像をダウンロードしています',
    applying: 'デスクトップに適用しています', applied: 'デスクトップに適用しました', applyFailed: '適用失敗',
    imageNetworkError: '元画像のサーバーに接続できません。再試行するか出典をご確認ください。',
    desktopChanged: '適用前に壁紙設定または画面構成が変わりました。対象の画面を確認して再試行してください。',
    filtersCleared: '絞り込みを解除', savedToast: '保存しました', removed: '解除しました',
    refreshing: 'ソースを更新中', indexed: '枚を索引化', searchUnavailable: '一部のオンラインソースに接続できません', usingCache: 'キャッシュ使用中',
    imageSaved: '画像を保存しました', cancelled: 'キャンセル', saveFailed: '保存失敗', savingImage: '画像を保存中',
    oneDisplayToast: 'ディスプレイ 1 台 / マルチ対応済み',
    saveFraming: '構図を保存', resetFraming: '構図をリセット', framingSaved: 'この画像の構図を保存しました', framingReset: '既定の構図に戻しました',
    framingControls: 'Ctrl＋ホイールで拡大縮小 · ドラッグで移動 · ホイールで画像切替',
    undoWallpaper: '最後の適用を取り消す', wallpaperUndone: '以前の壁紙に戻しました',
    desktopProfileNote: '各画面の壁紙を保存します。同じ画面構成を再接続すると復元されます。',
    saveDesktopProfile: '画面設定を保存', restoreDesktopProfile: '画面設定を復元',
    desktopProfileSaved: '画面設定を保存しました', desktopProfileRestored: '画面設定を復元しました',
    lockOn: 'ロック画面同期 オン', lockOff: 'ロック画面同期 オフ', allDisplaysToast: 'すべてのディスプレイ',
    noSourceLink: '出典リンクなし', nothingChanged: '変更なし', credentialsSaved: '認証情報を保存しました',
    localFolderAdded: 'ローカルフォルダを追加', cacheCleared: 'キャッシュを削除', cacheClearFailed: '削除失敗',
    autoStartOn: '自動起動 オン', autoStartOff: '自動起動 オフ', localFolderNone: 'ローカルフォルダなし',
    onlineSources: 'オンラインソース', credentialsTitle: '認証情報',
    credNote: '空欄のままにすると無効です。認証情報はこの端末にのみ保存されます。',
    localLibrary: 'ローカルライブラリ', desktop: 'デスクトップ', language: '言語', keyboard: 'キーボード',
    addLocalFolder: 'ローカルフォルダを追加', saveCredentials: '認証情報を保存', autoStart: '自動起動',
    windowMode: '表示モード', immersive: '全画面', window: 'ウィンドウ', clearCache: 'キャッシュ削除',
    checking: '確認中', available: '利用可', blocked: '制限', notConnected: '未接続',
    keyShow: '表示 / 非表示', keyMode: 'ウィンドウ / 全画面', keyStep: '前 / 次',
    keyFav: '現在を保存', keySearch: '検索', keyClear: '絞り込み解除', keyExport: '元画像を書き出す', keyEsc: '閉じる / 非表示',
    keySuggest: '候補 / 確定',
    unsplashKey: 'UNSPLASH アクセスキー', pexelsKey: 'PEXELS API キー',
    moreWallhaven: '壁紙をもっと見る', loadingMore: '読み込み中…', retryMore: '再試行',
    waitingForImages: '条件に合う壁紙を検索中…', loadingPaused: '自動読み込みが停止しました。再試行してください。',
    cacheLabel: 'キャッシュ', files: 'ファイル', lockAvailable: 'ロック画面 / WINRT 利用可', lockBlocked: 'ロック画面 / 制限',
    okLabel: '成功', failedLabel: '失敗',
    opened: '開きました', closed: '閉じました', settingsOpened: '設定を開きました', settingsClosed: '設定を閉じました',
    modeWindow: 'ウィンドウモード', modeFullscreen: '全画面モード', nextItem: '次へ', prevItem: '前へ',
    unknownSize: 'サイズ不明'
  }
};

let lang = 'zh';
const t = k => (I18N[lang] && I18N[lang][k]) || (I18N.en && I18N.en[k]) || k;

const MODES = [
  ['fill', 'modeFill', 'noteFill'], ['stretch', 'modeStretch', 'noteStretch'],
  ['fit', 'modeFit', 'noteFit'], ['tile', 'modeTile', 'noteTile'],
  ['center', 'modeCenter', 'noteCenter'], ['span', 'modeSpan', 'noteSpan']
];
const { DEFAULT_FRAMING, imagePlacement, monitorBounds, framingViewport } = window.framingGeometry;
const FRAMING_KEY_PREFIX = 'wallscape.framing:';
const MIN_PREVIEW_ZOOM = 0.25;
const MAX_PREVIEW_ZOOM = 5;
const TONES = [['any', 'toneAny'], ['warm', 'toneWarm'], ['cool', 'toneCool'], ['green', 'toneGreen'], ['mono', 'toneMono'], ['neutral', 'toneNeutral']];
const GENRES = [['all', 'genreAll'], ['anime', 'genreAnime'], ['people', 'genrePeople'], ['landscape', 'genreLandscape'],
  ['animals', 'genreAnimals'], ['architecture', 'genreArchitecture'], ['space', 'genreSpace'], ['abstract', 'genreAbstract']];
const RATIOS = [['any', 'ratioAny'], ['16:9', '16:9'], ['4:3', '4:3'], ['1:1', '1:1'], ['ultrawide', 'ULTRA'], ['portrait', 'PORT']];
/* Resolution buckets use the SHORT edge, so portrait artwork is judged fairly.
   Sources without real dimensions are never guessed - they only match ANY / —. */
const RES_MIN = { hd: 720, fhd: 1080, qhd: 1440, uhd: 2160 };
const RESOLUTIONS = [['any', 'ANY'], ['hd', 'HD'], ['fhd', 'FHD'], ['qhd', 'QHD'], ['uhd', 'UHD'], ['unknown', '—']];
const SOURCE_NAMES = { bing: 'BING', github: 'OPEN', anime: 'ANIME', nekos: 'NEKOS', commons: 'COMMONS', unsplash: 'UNSPLASH', pexels: 'PEXELS', wallhaven: 'WALLHAVEN', local: 'LOCAL' };
const RECENT_SEARCHES_KEY = 'wallscape.recentSearches';
const MAX_RECENT_SEARCHES = 10;
const FILTER_KEYS = ['scope', 'genre', 'tone', 'ratio', 'resolution', 'sort'];
const SORTS = ['relevance', 'popular', 'newest'];
const { FRAME_WIDTH: BASE_W, FRAME_HEIGHT: BASE_H } = framingGeometry;
const PRESS_SEL = '.filter-word, .mode, .strip-action, .settings-action, .language-word, .mode-word, #apply-bar, #btn-settings-close, .card, .suggestion';

const S = {
  items: [], sources: [], settings: {}, favorites: [], history: [],
  credentials: {}, folders: [], status: null, background: null,
  scope: 'all', genre: 'all', tone: 'any', ratio: 'any', resolution: 'any', sort: 'relevance', query: '',
  filtered: [], current: null, currentCard: null, previewImage: null, framing: DEFAULT_FRAMING,
  style: 'fill', monitorId: null, monitors: [], syncLock: false, busy: false, undoAvailable: false
};

let toastTimer = null, refreshing = false;
let detailCloseTimer;
let previewTurn = null;
let suggestList = [], suggestIndex = -1, composingSearch = false;
let onlineRequest = 0, onlineSearchKey = '', onlineItems = new Map();
let wallhavenNextSearchPage, loadingMore = false;
let autoLoadTimer = 0, wallhavenAutoAfter = 0;
let autoLoadFailures = 0;
let refreshQueued = false;
const GRID_PREFETCH_SCREENS = 1.5;
const PAGE_LOAD_INTERVAL = 2200;
const MAX_AUTO_FAILURES = 2;
let indexedItems = new Map(), recentSearches = loadRecentSearches();
let favoriteById = new Map();
const cardItems = new WeakMap();
const cardsById = new Map();
const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    loadCardImage(e.target);
    io.unobserve(e.target);
  }
}, { root: $('#grid'), rootMargin: '360px 0px' });

/* ---------------- boot ---------------- */
async function boot() {
  const d = await api.bootstrap();
  S.items = d.items || [];
  S.sources = d.sources || [];
  S.settings = d.settings || {};
  setFavorites(d.favorites || []);
  S.history = d.history || [];
  S.credentials = d.credentials || {};
  S.folders = d.folders || [];
  S.status = d.status || null;
  S.style = MODES.some(([value]) => value === S.settings.style) ? S.settings.style : 'fill';
  S.syncLock = Boolean(S.settings.lockScreenSync);
  S.monitors = d.status?.monitors || [];
  S.undoAvailable = Boolean(d.undoAvailable);
  lang = ['zh', 'en', 'ja'].includes(S.settings.language) ? S.settings.language : 'zh';

  S.scope = S.settings.scope || 'all';
  S.genre = GENRES.some(([id]) => id === S.settings.genre) ? S.settings.genre : 'all';
  S.tone = S.settings.tone || 'any';
  S.ratio = S.settings.ratio || 'any';
  S.resolution = S.settings.resolution || 'any';
  S.sort = SORTS.includes(S.settings.sort) ? S.settings.sort : 'relevance';
  paintSort();
  S.query = '';
  $('#search').value = '';

  setPaper(d.background || (S.items[0] ? thumbOf(S.items[0]) : null));
  paintDate();
  indexCatalog();
  applyI18n();
  applyFilters();
  render();
  bind();
  bindFeedback();
  bindWindowDrag();
  bindApiEvents();
  api.readStatus();
  loadGenreFeed();
  queueWallhavenAutoLoad();
  layout();
  window.addEventListener('resize', layout);

  if (S.settings.pendingFeedback) {
    const key = S.settings.pendingFeedback;
    S.settings.pendingFeedback = '';
    api.setSettings({ pendingFeedback: '' });
    setTimeout(() => toast(t(key)), 450);
  }
}

/* Uniform scale of the SAME stage. No reflow, no per-element resizing. */
function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  const s = Math.min(w / BASE_W, h / BASE_H);
  const x = (w - BASE_W * s) / 2, y = (h - BASE_H * s) / 2;
  const root = document.documentElement.style;
  root.setProperty('--stage-s', String(s));
  root.setProperty('--stage-x', x + 'px');
  root.setProperty('--stage-y', y + 'px');
  requestAnimationFrame(() => {
    const stage = $('#stage').getBoundingClientRect();
    const lowerEdge = (suggestionsOpen() ? $('#search-assist') : $('#searchbar')).getBoundingClientRect().bottom;
    const input = $('#search').getBoundingClientRect();
    const scale = s || 1;
    root.setProperty('--suggestions-left', (input.left - stage.left) / scale + 'px');
    root.setProperty('--grid-top', Math.ceil((lowerEdge - stage.top) / scale + 20) + 'px');
    queueWallhavenAutoLoad();
  });
}

function applyI18n() {
  document.body.className = 'lang-' + lang;
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja' : 'en';
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $('#search').setAttribute('aria-label', t('searchPlaceholder'));
  $('#suggestions').setAttribute('aria-label', t('searchPlaceholder'));
  $('#genre-block').setAttribute('aria-label', t('genreLabel'));
  $('#btn-save-framing').title = t('framingControls');
  paintWallhavenMore();
  document.querySelectorAll('.language-word').forEach(w =>
    w.classList.toggle('is-active', w.dataset.lang === lang));
  paintModeWords();
  buildFilters();
  buildModes();
  paintEngineStatus();
  paintSide();
  if (S.current) paintDetailFavorite();
  render();
  if ($('#settings').classList.contains('is-open')) openSettings();
}

function paintModeWords() {
  const cur = S.settings.windowMode === 'window' ? 'window' : 'immersive';
  document.querySelectorAll('.mode-word').forEach(w =>
    w.classList.toggle('is-active', w.dataset.mode === cur));
}

function setLanguage(next) {
  if (!['zh', 'en', 'ja'].includes(next) || next === lang) return;
  lang = next;
  S.settings.language = next;
  api.setSettings({ language: next });
  applyI18n();
  toast({ zh: '中文', en: 'ENGLISH', ja: '日本語' }[next]);
}

function persistFilters() {
  const patch = {};
  for (const k of FILTER_KEYS) patch[k] = S[k];
  api.setSettings(patch);
}

function paintDate() {
  const n = new Date();
  $('#edge-date').textContent = `${n.getFullYear()}.${pad(n.getMonth() + 1, 2)}.${pad(n.getDate(), 2)}`;
}

function paintEngineStatus() {
  const el = $('#engine-status');
  const unavailable = S.status?.ok === false;
  el.textContent = unavailable ? t('engineBad') : '';
  el.title = unavailable ? S.status.error || '' : '';
  el.hidden = !unavailable;
}

function setPaper(url) {
  if (!url) return;
  const safe = String(url).replace(/["')]/g, encodeURIComponent);
  $('#paper-image').style.backgroundImage = `url("${safe}")`;
}

/* ---------------- click feedback ---------------- */
function inkAt(cx, cy) {
  const stage = $('#stage');
  if (!stage) return;
  const r = stage.getBoundingClientRect();
  const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stage-s')) || 1;
  const el = document.createElement('div');
  el.className = 'ink';
  el.style.left = ((cx - r.left) / s) + 'px';
  el.style.top = ((cy - r.top) / s) + 'px';
  stage.appendChild(el);
  setTimeout(() => el.remove(), 460);
}

function bindFeedback() {
  document.addEventListener('pointerdown', e => {
    inkAt(e.clientX, e.clientY);
    const el = e.target.closest(PRESS_SEL);
    if (!el) return;
    el.classList.add('is-pressed');
    setTimeout(() => el.classList.remove('is-pressed'), 170);
  }, true);
  document.addEventListener('dragstart', e => e.preventDefault());
  document.addEventListener('selectstart', e => {
    if (!e.target.closest('#search, #favorite-name, #motion-search')) e.preventDefault();
  });
}

/* ---------------- window drag + resize ---------------- */
function bindWindowDrag() {
  const m = $('#masthead');
  if (m) {
    m.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (S.settings.windowMode !== 'window') return;
      api.dragStart();
      const move = () => api.dragMove();
      const up = () => { api.dragEnd(); window.removeEventListener('pointermove', move); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up, { once: true });
    });
  }
  api.on('window:resized', layout);
  if (typeof ResizeObserver !== 'undefined') {
    try { new ResizeObserver(() => layout()).observe(document.documentElement); } catch (e) { /* ignore */ }
  }
}

/* ---------------- search suggestions ---------------- */
function indexCatalog() {
  indexedItems = new Map(S.items.map(item => [item.id, item]));
}

function loadRecentSearches() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY));
    return Array.isArray(list) ? list.filter(term => typeof term === 'string' && term.trim() && term.length <= 120)
      .slice(0, MAX_RECENT_SEARCHES) : [];
  } catch { return []; }
}

function saveRecentSearches(list) {
  recentSearches = list;
  try { localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list)); } catch {}
}

function rememberSearch(term) {
  const query = wallpaperSearch.normalize(term);
  if (!query) return;
  saveRecentSearches([term, ...recentSearches.filter(entry => wallpaperSearch.normalize(entry) !== query)]
    .slice(0, MAX_RECENT_SEARCHES));
}

function clearRecentSearches() {
  saveRecentSearches([]);
  closeSuggestions();
}

function closeSuggestions() {
  const box = $('#suggestions');
  const wasOpen = box.classList.contains('is-on');
  box.classList.remove('is-on');
  box.replaceChildren();
  $('#search').setAttribute('aria-expanded', 'false');
  $('#search').removeAttribute('aria-activedescendant');
  $('#search').removeAttribute('aria-keyshortcuts');
  $('#btn-clear-search-history').hidden = true;
  suggestList = [];
  suggestIndex = -1;
  if (wasOpen) layout();
}

function acceptSuggestion(word) {
  $('#search').value = word;
  S.query = word;
  resetOnlineSearch();
  rememberSearch(word);
  closeSuggestions();
  $('#grid').scrollTop = 0;
  renderSearch();
  toast(`${word} · ${pad(S.filtered.length)}`);
}

function paintSuggestionActive() {
  document.querySelectorAll('#suggestions .suggestion').forEach((el, i) => {
    el.classList.toggle('is-active', i === suggestIndex);
    el.setAttribute('aria-selected', String(i === suggestIndex));
  });
  if (suggestIndex >= 0) $('#search').setAttribute('aria-activedescendant', `suggestion-${suggestIndex}`);
  else $('#search').removeAttribute('aria-activedescendant');
}

function updateSuggestions() {
  const input = $('#search');
  const box = $('#suggestions');
  if (composingSearch || document.activeElement !== input) return;
  const history = !wallpaperSearch.normalize(input.value);
  suggestList = history ? recentSearches : wallpaperSearch.suggest(scopedItems(), input.value, [], 6, customName);
  suggestIndex = -1;
  box.replaceChildren();
  if (!suggestList.length) { closeSuggestions(); return; }
  box.setAttribute('aria-label', t(history ? 'recentSearches' : 'searchPlaceholder'));
  $('#btn-clear-search-history').hidden = !history;
  if (history) input.setAttribute('aria-keyshortcuts', 'Control+Delete');
  else input.removeAttribute('aria-keyshortcuts');
  if (history) {
    const heading = document.createElement('div');
    heading.className = 'suggestion-heading';
    heading.setAttribute('aria-hidden', 'true');
    heading.textContent = t('recentSearches');
    box.appendChild(heading);
  }
  const options = document.createElement('div');
  options.className = 'suggestion-items';
  options.setAttribute('role', 'presentation');
  suggestList.forEach((word, index) => {
    const el = document.createElement('div');
    el.id = `suggestion-${index}`;
    el.className = 'suggestion';
    el.setAttribute('role', 'option');
    el.textContent = word;
    el.title = word;
    el.addEventListener('mousedown', event => event.preventDefault());
    el.addEventListener('click', () => acceptSuggestion(word));
    options.appendChild(el);
  });
  box.appendChild(options);
  paintSuggestionActive();
  box.classList.add('is-on');
  input.setAttribute('aria-expanded', 'true');
  layout();
}

function suggestionsOpen() {
  const box = $('#suggestions');
  return !!(box && box.classList.contains('is-on') && suggestList.length);
}

/* ---------------- filters ---------------- */
function buildFilters() {
  const groups = [
    ['scope-block', 'scope', [['all', 'scopeAll'], ['saved', 'scopeSaved'], ['history', 'scopeHistory']]],
    ['genre-block', 'genre', GENRES],
    ['tone-block', 'tone', TONES],
    ['ratio-block', 'ratio', RATIOS],
    ['resolution-block', 'resolution', RESOLUTIONS]
  ];
  for (const [blockId, key, options] of groups) {
    const block = $('#' + blockId);
    if (!block) continue;
    block.innerHTML = '';
    for (const [value, labelKey] of options) {
      const b = document.createElement('button');
      b.className = 'filter-word' + (S[key] === value ? ' is-active' : '');
      b.setAttribute('aria-pressed', String(S[key] === value));
      b.textContent = t(labelKey);
      b.addEventListener('click', () => {
        if (S[key] === value) return;
        const restart = ['scope', 'genre', 'ratio', 'resolution'].includes(key);
        const submitted = Boolean(onlineSearchKey);
        if (restart) resetOnlineSearch();
        S[key] = value;
        persistFilters();
        $('#grid').scrollTop = 0;
        buildFilters(); applyFilters(); render();
        toast(`${t(labelKey)} · ${pad(S.filtered.length)}`);
        loadGenreFeed();
        if (restart && submitted && S.scope === 'all' && S.resolution !== 'unknown') submitSearch(false);
      });
      block.appendChild(b);
    }
  }
  layout();
}

function clearFilters() {
  S.scope = 'all'; S.genre = 'all'; S.tone = 'any'; S.ratio = 'any';
  S.resolution = 'any'; S.query = '';
  $('#search').value = '';
  resetOnlineSearch();
  closeSuggestions();
  persistFilters();
  $('#grid').scrollTop = 0;
  buildFilters(); applyFilters(); render();
  toast(t('filtersCleared'));
}

function setFavorites(favorites) {
  S.favorites = favorites;
  favoriteById = new Map(favorites.map(item => [item.id, item]));
}

function isFav(id) { return favoriteById.has(id); }
function customName(item) { return favoriteById.get(item.id)?.customName || ''; }

function paintItemTitle(element, item) {
  const name = customName(item);
  element.textContent = name || item.title;
  element.classList.toggle('has-custom-name', Boolean(name));
  element.title = name;
}

function paintDetailFavorite() {
  const favorited = isFav(S.current.id);
  $('#btn-fav').textContent = t(favorited ? 'savedOn' : 'save');
  $('#btn-rename-favorite').hidden = !favorited;
  paintItemTitle($('#detail-title'), S.current);
}

function updateFavorites(favorites, id) {
  setFavorites(favorites);
  const card = cardsById.get(id);
  if (card) updateCard(card, cardItems.get(card));
  if (S.current?.id === id) paintDetailFavorite();
  if (S.scope === 'saved' || S.query.trim()) renderSearch(false, true);
}

function matchesFilters(item) {
  if (!wallpaperSearch.matchesGenre(item, S.genre)) return false;
  if (S.tone !== 'any' && (item.tone || 'neutral') !== S.tone) return false;
  if (S.ratio !== 'any' && item.ratio !== S.ratio) return false;
  if (S.resolution !== 'any') {
    const known = !!(item.width && item.height && !item.sizeFromThumb);
    if (S.resolution === 'unknown') {
      if (known) return false;
    } else {
      if (!known) return false;
      if (Math.min(item.width, item.height) < RES_MIN[S.resolution]) return false;
    }
  }
  return true;
}

function scopedItems(includeOnline = false) {
  const archive = S.scope === 'saved' ? S.favorites : S.scope === 'history' ? S.history : null;
  const items = archive ? archive.map(item => item.genres?.includes(S.genre)
    ? item : indexedItems.get(item.id) || item)
    : includeOnline && onlineItems.size
      ? S.items.map(item => onlineItems.get(item.id) || item).concat([...onlineItems.values()].filter(item => !indexedItems.has(item.id)))
      : S.items;
  const named = !archive && S.query.trim() ? S.favorites.filter(item => item.customName &&
    !indexedItems.has(item.id) && !(includeOnline && onlineItems.has(item.id))) : [];
  return items.concat(named).filter(matchesFilters);
}

function applyFilters() {
  const words = wallpaperSearch.terms(S.query);
  S.filtered = scopedItems(true).filter(item => !words.length || (S.scope === 'all' && onlineItems.has(item.id)) ||
    wallpaperSearch.matches(wallpaperSearch.indexWithName(item, customName(item)), words));
  if (S.sort === 'popular') S.filtered.sort(wallpaperSearch.comparePopularity);
  else if (S.sort === 'newest') S.filtered.sort(wallpaperSearch.compareDate);
  else if (S.scope === 'all' && S.genre !== 'all') {
    S.filtered.sort((left, right) => wallpaperSearch.compareGenre(left, right, S.genre, !words.length));
  }
}

function renderSearch(append = false, preservePosition = append) {
  const previous = S.filtered;
  applyFilters();
  if (append && previous.length && (S.sort === 'relevance' || $('#grid').scrollTop > 0)) {
    const positions = new Map(previous.map((item, position) => [item.id, position]));
    S.filtered.sort((left, right) => (positions.get(left.id) ?? previous.length) - (positions.get(right.id) ?? previous.length));
  }
  const samePrefix = previous.every((item, index) => item.id === S.filtered[index]?.id);
  for (const item of S.filtered) {
    const card = cardsById.get(item.id);
    if (card && cardItems.get(card) !== item) updateCard(card, item);
  }
  if (!samePrefix || previous.length !== S.filtered.length) render(append && samePrefix ? previous.length : 0, preservePosition);
  else paintSearchCount();
}

function paintSearchCount() {
  const additional = [...onlineItems.keys()].filter(id => !indexedItems.has(id)).length;
  $('#search-result').textContent = `${pad(S.filtered.length)} / ${pad(Math.max(S.items.length + additional, S.filtered.length))}`;
  paintWallhavenMore();
  paintBackToTop();
  queueWallhavenAutoLoad();
}

function paintBackToTop() {
  const grid = $('#grid');
  $('#btn-back-to-top').hidden = grid.scrollTop <= grid.clientHeight;
}

function backToTop() {
  $('#grid').scrollTop = 0;
  if (S.sort !== 'relevance') renderSearch();
}

/* ---------------- grid ---------------- */
function gridAnchor(grid) {
  const top = grid.scrollTop;
  if (!top) return null;
  let visible;
  for (const card of grid.children) {
    if (card.offsetTop + card.offsetHeight <= top || card.offsetTop >= top + grid.clientHeight) continue;
    if (!visible || card.offsetTop < visible.offsetTop) visible = card;
    if (visible.offsetTop <= top) break;
  }
  return { top, id: visible?.dataset.id, offset: visible ? top - visible.offsetTop : 0 };
}

function render(appendFrom = 0, preservePosition = false) {
  const grid = $('#grid');
  const anchor = !appendFrom && preservePosition ? gridAnchor(grid) : null;
  const previousTop = grid.scrollTop;
  const list = S.filtered;
  $('#empty-state').classList.toggle('is-on', list.length === 0);
  if (!appendFrom) {
    const keep = new Set(list.map(item => item.id));
    for (const [id, card] of cardsById) {
      if (keep.has(id)) continue;
      io.unobserve(card);
      card.remove();
      cardsById.delete(id);
    }
  }
  let cursor = appendFrom ? null : grid.firstElementChild;
  for (let index = appendFrom; index < list.length; index++) {
    const item = list[index];
    let card = cardsById.get(item.id);
    if (!card) {
      card = document.createElement('article');
      card.className = 'card';
      card.dataset.id = item.id;
      card.innerHTML = '<img alt="" data-state="idle"><span class="card-fav">◆</span>' +
        '<span class="card-fallback"></span><div class="card-caption"><div class="card-title"></div></div>';
      card.addEventListener('click', () => openDetail(cardItems.get(card), card));
      cardsById.set(item.id, card);
      io.observe(card);
    }
    updateCard(card, item);
    card.classList.toggle('is-wide', index % 7 === 2);
    if (card === cursor) cursor = cursor.nextElementSibling;
    else grid.insertBefore(card, cursor);
    if (card.dataset.id === anchor?.id) anchor.card = card;
  }
  if (anchor) grid.scrollTop = anchor.card ? anchor.card.offsetTop + anchor.offset : anchor.top;
  else if (appendFrom) grid.scrollTop = previousTop;
  paintSearchCount();
}
function updateCard(card, item) {
  const previous = cardItems.get(card);
  cardItems.set(card, item);
  card.classList.toggle('is-fav', isFav(item.id));
  paintItemTitle(card.querySelector('.card-title'), item);
  card.querySelector('.card-fallback').textContent = t('imageUnavailable');
  if (previous && thumbOf(previous) !== thumbOf(item)) {
    const image = card.querySelector('img');
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    image.classList.remove('is-loaded');
    image.dataset.state = 'idle';
    delete image.dataset.retried;
    card.classList.remove('is-broken');
    io.observe(card);
  }
}
function thumbOf(item) { return item.thumbUrl || item.fullUrl || ''; }

function loadCardImage(card) {
  const img = card.querySelector('img');
  if (!img || img.dataset.state !== 'idle') return;
  const item = cardItems.get(card);
  if (!item) return;
  const first = thumbOf(item);
  img.dataset.state = 'loading';
  img.onload = () => {
    img.classList.add('is-loaded'); img.dataset.state = 'done';
    // A 480px proxy thumbnail is NOT the original resolution. Never let it
    // overwrite real dimensions, and never use it to fake a resolution bucket.
    const current = cardItems.get(card);
    if (current && img.naturalWidth) {
      current.thumbWidth = img.naturalWidth;
      current.thumbHeight = img.naturalHeight;
      if (!current.width || !current.height) current.sizeFromThumb = true;
      if (!current.ratio) current.ratio = ratioOf(current.thumbWidth, current.thumbHeight);
    }
    if (current) sampleTone(current, img);
  };
  img.onerror = () => {
    if (!img.dataset.retried && item.fullUrl && item.fullUrl !== first) {
      img.dataset.retried = '1'; img.src = item.fullUrl; return;
    }
    img.dataset.state = 'error'; card.classList.add('is-broken');
  };
  img.src = first;
}
function sampleTone(item, img) {
  try {
    const c = document.createElement('canvas'); c.width = 12; c.height = 12;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 12, 12);
    const d = ctx.getImageData(0, 0, 12, 12).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    r /= n; g /= n; b /= n;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 22) item.tone = 'mono';
    else if (g > r + 12 && g > b + 6) item.tone = 'green';
    else if (r > b + 14) item.tone = 'warm';
    else item.tone = 'cool';
  } catch (e) { /* cross-origin tainted: keep filename-derived tone */ }
}

/* ---------------- detail sheet ---------------- */
function buildModes() {
  const box = $('#mode-scale');
  box.innerHTML = '';
  for (const [value, labelKey, noteKey] of MODES) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'mode' + (S.style === value ? ' is-active' : '');
    el.setAttribute('aria-pressed', String(S.style === value));
    el.dataset.value = value;
    el.textContent = t(labelKey);
    el.addEventListener('click', () => {
      S.style = value;
      for (const m of box.children) {
        const active = m.dataset.value === value;
        m.classList.toggle('is-active', active);
        m.setAttribute('aria-pressed', String(active));
      }
      paintPreview();
      paintSide();
      if (value === 'span') api.readStatus(true);
      toast(t(noteKey));
      api.setSettings({ style: value });
    });
    box.appendChild(el);
  }
}

function previewMonitors() {
  return S.monitors.filter(m => m.active && m.width > 0 && m.height > 0);
}

function previewMonitorId() {
  return S.style === 'span' ? null : S.monitorId;
}

function readFraming(id) {
  try {
    const framing = JSON.parse(localStorage.getItem(FRAMING_KEY_PREFIX + id));
    if (framing && framing.zoom >= MIN_PREVIEW_ZOOM && framing.zoom <= MAX_PREVIEW_ZOOM &&
        [framing.zoom, framing.x, framing.y].every(Number.isFinite)) return framing;
  } catch (e) { /* invalid or unavailable local storage */ }
  return DEFAULT_FRAMING;
}

function saveFraming(reset = false) {
  if (!S.current || !S.previewImage?.url) return;
  const key = FRAMING_KEY_PREFIX + S.current.id;
  const { zoom, x, y } = S.framing;
  try {
    if (reset || (zoom === 1 && x === 0 && y === 0)) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(S.framing));
  } catch (e) {
    toast(t('saveFailed'));
    return;
  }
  if (reset) {
    S.framing = DEFAULT_FRAMING;
    paintFraming();
  }
  toast(t(reset ? 'framingReset' : 'framingSaved'));
}

function paintFraming() {
  const preview = $('#detail-preview');
  const { zoom, x, y } = S.framing;
  preview.style.setProperty('--preview-zoom', zoom);
  preview.style.setProperty('--preview-x', `${(x + (1 - zoom) / 2) * preview.clientWidth}px`);
  preview.style.setProperty('--preview-y', `${(y + (1 - zoom) / 2) * preview.clientHeight}px`);
}

function clearPreviewTurn() {
  if (!previewTurn) return;
  previewTurn.enter?.cancel();
  previewTurn.exit?.cancel();
  previewTurn.previous.remove();
  previewTurn = null;
}

function preparePreviewTurn(direction) {
  const current = $('#detail-preview');
  const visible = current.childElementCount ? current : previewTurn?.previous;
  const previous = visible?.cloneNode(true);
  clearPreviewTurn();
  if (!previous) return;
  previous.removeAttribute('id');
  previous.style.transition = 'none';
  previous.style.transform = 'none';
  previous.classList.add('is-outgoing');
  current.before(previous);
  previewTurn = { previous, direction };
}

function playPreviewTurn(current) {
  const turn = previewTurn;
  if (!turn || turn.enter) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    clearPreviewTurn();
    return;
  }

  const distance = 12 * turn.direction;
  const timing = { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' };
  turn.exit = turn.previous.animate([
    { transform: 'translateY(0)', opacity: 1 },
    { transform: `translateY(${-distance}%)`, opacity: 0 }
  ], timing);
  turn.enter = current.animate([
    { transform: `translateY(${distance}%)`, opacity: 0 },
    { transform: 'translateY(0)', opacity: 1 }
  ], timing);
  turn.enter.onfinish = () => {
    if (previewTurn === turn) clearPreviewTurn();
  };
}

function paintPreview() {
  const image = S.previewImage;
  const preview = $('#detail-preview');
  if (!image?.url || !preview.clientWidth || !preview.clientHeight) return;

  const monitors = previewMonitors();
  const fallback = {
    x: 0, y: 0, width: screen.width * devicePixelRatio, height: screen.height * devicePixelRatio
  };
  const primary = monitors.find(m => m.x === 0 && m.y === 0) || monitors[0] || fallback;
  const id = previewMonitorId();
  const span = S.style === 'span';
  const tile = S.style === 'tile';
  const targets = span && monitors.length
    ? monitors
    : [monitors.find(m => m.id === id) || primary];
  const bounds = monitorBounds(targets);
  const viewport = framingViewport(bounds, preview.clientWidth, preview.clientHeight);
  const { scale } = viewport;
  const placement = imagePlacement(image, bounds, S.style, DEFAULT_FRAMING);
  const imageWidth = placement.width * scale;
  const imageHeight = placement.height * scale;
  const imageX = (placement.x - viewport.x) * scale;
  const imageY = (placement.y - viewport.y) * scale;
  const backgroundImage = `url(${JSON.stringify(image.url)})`;
  paintFraming();
  preview.classList.toggle('is-multi', targets.length > 1);
  preview.replaceChildren(...targets.map(m => {
    const layer = document.createElement('div');
    const x = (m.x - viewport.x) * scale;
    const y = (m.y - viewport.y) * scale;
    layer.className = 'preview-monitor';
    Object.assign(layer.style, {
      left: `${x}px`, top: `${y}px`,
      width: `${m.width * scale}px`, height: `${m.height * scale}px`,
      backgroundImage
    });
    layer.style.setProperty('--monitor-x', `${x}px`);
    layer.style.setProperty('--monitor-y', `${y}px`);
    layer.style.setProperty('--image-width', `${imageWidth}px`);
    layer.style.setProperty('--image-height', `${imageHeight}px`);
    layer.style.setProperty('--image-x', `${imageX}px`);
    layer.style.setProperty('--image-y', `${imageY}px`);
    if (tile) layer.style.backgroundRepeat = 'repeat';
    return layer;
  }));
  playPreviewTurn(preview);
}

function loadPreviewImage(item) {
  const preview = S.previewImage = {};
  $('#detail-preview').replaceChildren();
  const thumbUrl = thumbOf(item);
  const fullUrl = item.fullUrl;
  const hasThumbnail = Boolean(thumbUrl && thumbUrl !== fullUrl);
  let pending = Number(hasThumbnail) + Number(Boolean(fullUrl));
  if (!pending) clearPreviewTurn();
  function load(url, original) {
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      if (S.previewImage !== preview || preview.original) return;
      const knownSize = !item.sizeFromThumb && item.width > 0 && item.height > 0;
      Object.assign(preview, {
        url: img.src, original,
        width: !original && knownSize ? item.width : img.naturalWidth,
        height: !original && knownSize ? item.height : img.naturalHeight
      });
      paintPreview();
    };
    img.onerror = () => {
      pending--;
      if (!pending && S.previewImage === preview && !preview.url) clearPreviewTurn();
    };
    img.src = url;
  }
  if (hasThumbnail) load(thumbUrl, false);
  load(fullUrl, true);
  return preview;
}

function sizeLabel(item) {
  return item.width && item.height && !item.sizeFromThumb
    ? `${item.width}×${item.height}` : t('unknownSize');
}

function detailMetadata(item) {
  const counts = [['favorites', 'popularityFavorites'], ['views', 'popularityViews']]
    .filter(([key]) => Number.isFinite(item.stats?.[key]))
    .map(([key, label]) => `${t(label)} ${item.stats[key].toLocaleString(lang)}`);
  return [(item.tags || []).slice(0, 8).join(' · '), sizeLabel(item), ...counts].filter(Boolean).join('  /  ');
}

function openDetail(item, card, direction = 0) {
  clearTimeout(detailCloseTimer);
  if (direction) preparePreviewTurn(direction);
  else clearPreviewTurn();
  $('#search').blur();
  S.current = item; S.currentCard = card;
  S.framing = readFraming(item.id);
  const d = $('#detail');
  $('#detail-source').textContent = `${item.sourceLabel || SOURCE_NAMES[item.source] || ''} / ${item.license || ''}`;
  $('#detail-author').textContent = item.author || 'UNKNOWN';
  $('#detail-tags').textContent = detailMetadata(item);
  const idx = S.filtered.findIndex(x => x.id === item.id) + 1;
  $('#detail-index').textContent = `${pad(idx)} / ${pad(S.filtered.length)}`;
  paintDetailFavorite();
  $('#receipt').textContent = '';
  paintSide();
  toast(`${t('opened')} · ${pad(idx)} / ${pad(S.filtered.length)}`);

  const img = $('#detail-preview');
  img.style.transition = 'none';
  const preview = loadPreviewImage(item);

  d.classList.remove('is-closing'); d.classList.add('is-open');
  d.setAttribute('aria-hidden', 'false');
  if (!direction) api.readStatus();
  if (direction) {
    img.style.transform = 'none';
    return;
  }
  const src = card ? card.querySelector('img') : null;
  const target = $('#detail-visual').getBoundingClientRect();
  if (src && src.complete && src.naturalWidth) {
    const r = src.getBoundingClientRect();
    img.style.transform = `translate(${r.left - target.left}px, ${r.top - target.top}px) scale(${r.width / target.width}, ${r.height / target.height})`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (S.previewImage !== preview) return;
      img.style.transition = 'transform 680ms cubic-bezier(.76,0,.24,1)';
      img.style.transform = 'translate(0,0) scale(1,1)';
    }));
  } else {
    img.style.transform = 'scale(1.08)';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (S.previewImage !== preview) return;
      img.style.transition = 'transform 900ms cubic-bezier(.22,1,.36,1)';
      img.style.transform = 'scale(1)';
    }));
  }
}

function closeDetail() {
  const d = $('#detail');
  if (!d.classList.contains('is-open') || d.classList.contains('is-closing')) return;
  clearPreviewTurn();
  const img = $('#detail-preview'); const card = S.currentCard;
  if (card && S.previewImage?.url) {
    const src = card.querySelector('img'); const tRect = $('#detail-visual').getBoundingClientRect();
    if (src && src.naturalWidth) {
      const r = src.getBoundingClientRect();
      img.style.transition = 'transform 460ms cubic-bezier(.76,0,.24,1)';
      img.style.transform = `translate(${r.left - tRect.left}px, ${r.top - tRect.top}px) scale(${r.width / tRect.width}, ${r.height / tRect.height})`;
    }
  }
  S.previewImage = null;
  toast(t('closed'));
  d.classList.add('is-closing');
  detailCloseTimer = setTimeout(() => {
    d.classList.remove('is-open', 'is-closing');
    d.setAttribute('aria-hidden', 'true'); S.current = null;
    img.replaceChildren();
    queueWallhavenAutoLoad();
  }, 460);
}

function paintSide() {
  const lock = $('#btn-lock');
  lock.textContent = `${t('lockScreen')} / ${S.syncLock ? t('on') : t('off')}`;
  const count = previewMonitors().length;
  const selected = previewMonitors().find(m => m.id === previewMonitorId());
  const m = $('#btn-monitor');
  m.textContent = count < 2 ? `${t('monitor')} / ${t('oneDisplay')}`
    : `${t('monitor')} / ${selected ? pad(selected.index + 1, 2) : t('allDisplays')}`;
  $('#btn-undo-wallpaper').hidden = !S.undoAvailable;
}

function stepDetail(dir) {
  if (!S.current || S.filtered.length < 2 || $('#detail').classList.contains('is-closing')) return;
  const i = S.filtered.findIndex(x => x.id === S.current.id);
  const n = i < 0 ? (dir > 0 ? 0 : S.filtered.length - 1) : (i + dir + S.filtered.length) % S.filtered.length;
  const next = S.filtered[n];
  const card = document.querySelector(`.card[data-id="${CSS.escape(next.id)}"]`);
  openDetail(next, card, dir);
  toast(`${dir > 0 ? t('nextItem') : t('prevItem')} · ${pad(n + 1)} / ${pad(S.filtered.length)}`);
}

function bindPreviewControls() {
  const detail = $('#detail');
  const visual = $('#detail-visual');
  let drag = null, didPan = false;
  let lastWheelAt = -Infinity, wheelTravel = 0, wheelStepped = false;

  visual.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary) return;
    didPan = false;
    if (!S.previewImage?.url) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, framing: S.framing };
    visual.setPointerCapture(e.pointerId);
  });
  visual.addEventListener('pointermove', e => {
    if (drag?.id !== e.pointerId || !S.previewImage?.url) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!didPan && Math.hypot(dx, dy) < 4) return;
    const rect = visual.getBoundingClientRect();
    didPan = true;
    visual.classList.add('is-panning');
    S.framing = {
      zoom: drag.framing.zoom,
      x: drag.framing.x + dx / rect.width,
      y: drag.framing.y + dy / rect.height
    };
    paintFraming();
  });
  visual.addEventListener('lostpointercapture', () => {
    drag = null;
    visual.classList.remove('is-panning');
  });
  visual.addEventListener('click', () => {
    if (!didPan) closeDetail();
  });

  detail.addEventListener('wheel', e => {
    e.preventDefault();
    if (drag || !S.current || detail.classList.contains('is-closing')) return;
    const rect = visual.getBoundingClientRect();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
    const delta = e.deltaY * unit;
    if (!delta) return;
    if (e.ctrlKey) {
      if (!S.previewImage?.url) return;
      const { zoom, x, y } = S.framing;
      const next = Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, zoom * Math.exp(-0.0017 * delta)));
      const ratio = next / zoom;
      const cursorX = (e.clientX - rect.left) / rect.width - 0.5;
      const cursorY = (e.clientY - rect.top) / rect.height - 0.5;
      S.framing = { zoom: next, x: x * ratio + cursorX * (1 - ratio), y: y * ratio + cursorY * (1 - ratio) };
      paintFraming();
      return;
    }
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    if (e.timeStamp - lastWheelAt > 180) {
      wheelTravel = 0;
      wheelStepped = false;
    }
    lastWheelAt = e.timeStamp;
    if (wheelStepped) return;
    wheelTravel += delta;
    if (Math.abs(wheelTravel) < 24) return;
    wheelStepped = true;
    stepDetail(Math.sign(wheelTravel));
  }, { passive: false });
  $('#btn-save-framing').addEventListener('click', () => saveFraming());
  $('#btn-reset-framing').addEventListener('click', () => saveFraming(true));
}

/* ---------------- apply / export / mode ---------------- */
async function applyCurrent() {
  if (!S.current || S.busy) return;
  S.busy = true;
  $('#apply-bar').classList.add('is-busy');
  $('#receipt').textContent = t('preparingWallpaper');
  let r;
  try {
    const topology = previewMonitors().map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
    r = await api.apply({
      item: S.current, style: S.style, monitorId: previewMonitorId(),
      topology: topology.length ? topology : null, syncLock: S.syncLock, framing: S.framing
    });
  }
  catch (e) { r = { ok: false, error: String(e.message || e) }; }
  S.busy = false;
  $('#apply-bar').classList.remove('is-busy');
  if (!r.ok) {
    const receipt = $('#receipt');
    receipt.title = r.error || '';
    const messageKey = { IMAGE_NETWORK: 'imageNetworkError', DESKTOP_CHANGED: 'desktopChanged' }[r.code];
    if (r.code === 'DESKTOP_CHANGED') api.readStatus(true);
    receipt.textContent = messageKey ? t(messageKey) : `${t('failedLabel')} / ${r.stage || 'engine'} / ${r.error || 'unknown'}`;
    toast(t('applyFailed')); return;
  }
  $('#receipt').title = '';
  $('#receipt').textContent =
    `${t('okLabel')} / ${r.style.toUpperCase()} / ${t('display')} ${r.targetCount}` +
    (r.lock ? ` / LOCK ${r.lock.ok ? 'OK' : 'FAILED'}` : '');
  toast(t('applied'));
}

async function desktopAction(action, success, selector) {
  if (S.busy) return;
  S.busy = true;
  const output = $(selector);
  output.textContent = t('checking');
  let result;
  try { result = await action(); }
  catch (error) { result = { ok: false, error: error.message }; }
  S.busy = false;
  if (typeof result.undoAvailable === 'boolean') S.undoAvailable = result.undoAvailable;
  paintSide();
  const message = result.ok ? t(success) : `${t('failedLabel')} / ${result.error}`;
  output.textContent = message;
  toast(result.ok ? message : t('failedLabel'));
}
async function saveImageAs() {
  if (!S.current) return;
  toast(t('savingImage'));
  let r;
  try { r = await api.saveImageAs(S.current); }
  catch (e) { r = { ok: false, error: String(e.message || e) }; }
  toast(r.ok ? t('imageSaved') : r.canceled ? t('cancelled') : `${t('saveFailed')} / ${(r.error || '').slice(0, 30)}`);
}
async function toggleWindowMode() {
  try {
    const r = await api.toggleWindowMode();
    if (r && r.mode) S.settings.windowMode = r.mode;
  } catch (e) { /* this renderer is destroyed during rebuild */ }
}

/* ---------------- settings ---------------- */
async function openSettings() {
  $('#search').blur();
  const s = $('#settings');
  const report = $('#sources-report');
  report.innerHTML = '';
  for (const src of S.sources) {
    const row = document.createElement('div');
    row.className = 'source-report-row';
    const state = !src.configured ? t('notConnected') : src.loading ? t('checking')
      : src.stale ? `${t('usingCache')} / ${src.count} ${t('images')}`
      : src.ok ? `${t('okLabel')} / ${src.count} ${t('images')}` : `${t('failedLabel')} / ${(src.error || '').slice(0, 26)}`;
    row.innerHTML = `<span>${SOURCE_NAMES[src.id] || src.id.toUpperCase()}</span>` +
      `<span class="sr-state${src.ok ? ' is-ok' : ''}">${esc(state)}</span>`;
    report.appendChild(row);
  }
  $('#folder-list').innerHTML = S.folders.length
    ? S.folders.map(f => `<div class="folder-row">${esc(f)}</div>`).join('')
    : `<div class="folder-row">${esc(t('localFolderNone'))}</div>`;
  for (const [id, key] of [['cred-unsplash', 'unsplash'], ['cred-pexels', 'pexels']]) {
    const el = $('#' + id);
    el.value = '';
    el.placeholder = `${t(el.dataset.i18nPh)}${S.credentials[key] ? ' · ✓' : ''}`;
  }
  $('#btn-autostart').textContent = `${t('autoStart')} / ${S.settings.autoStart ? t('on') : t('off')}`;
  $('#lock-probe').textContent = `${t('lockScreen')} / ${t('checking')}`;
  paintModeWords();
  await refreshCacheInfo();
  s.classList.remove('is-closing'); s.classList.add('is-open');
  s.setAttribute('aria-hidden', 'false');
  toast(t('settingsOpened'));
  const probe = await api.lockProbe();
  const el = $('#lock-probe');
  el.textContent = probe && probe.ok ? t('lockAvailable')
    : `${t('lockBlocked')} — ${((probe && probe.error) || 'unknown').slice(0, 36)}`;
  el.classList.toggle('is-bad', !(probe && probe.ok));
}
async function refreshCacheInfo() {
  const r = await api.cacheInfo();
  if (r && r.ok) $('#cache-info').textContent = `${t('cacheLabel')} ${(r.bytes / 1048576).toFixed(1)} MB / ${r.count} ${t('files')}`;
}
function closeSettings() {
  const s = $('#settings');
  if (!s.classList.contains('is-open')) return;
  toast(t('settingsClosed'));
  s.classList.add('is-closing');
  setTimeout(() => {
    s.classList.remove('is-open', 'is-closing');
    s.setAttribute('aria-hidden', 'true');
    queueWallhavenAutoLoad();
  }, 400);
}

/* ---------------- misc ---------------- */
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2400);
}
function updateCatalog(data, append = false) {
  S.items = (data.items || []).map(item => {
    const previous = indexedItems.get(item.id);
    if (!previous || thumbOf(previous) !== thumbOf(item)) return item;
    if (append) return previous;
    if (previous.thumbWidth) {
      item.thumbWidth = previous.thumbWidth;
      item.thumbHeight = previous.thumbHeight;
      if (!item.width || !item.height) item.sizeFromThumb = previous.sizeFromThumb;
      item.ratio ||= previous.ratio;
    }
    return item;
  });
  S.sources = data.sources || [];
  indexCatalog();
  renderSearch(append || $('#grid').scrollTop > 0, true);
  if (suggestionsOpen()) updateSuggestions();
}

async function refresh() {
  if (refreshing) return;
  if (loadingMore) {
    refreshQueued = true;
    return;
  }
  refreshQueued = false;
  autoLoadFailures = 0;
  wallhavenAutoAfter = 0;
  refreshing = true;
  paintWallhavenMore();
  toast(t('refreshing'));
  try {
    updateCatalog(await api.refreshSources());
    if (S.scope === 'all' && S.resolution !== 'unknown') {
      if (wallpaperSearch.normalize(S.query)) await submitSearch(false, true);
      else if (filteredWallhaven()) {
        const request = onlineRequest;
        try {
          const result = await api.wallhavenMore('', 1, S.genre, onlineFilters());
          if (request === onlineRequest) mergeOnlinePage(result, true, true);
        } catch (error) {
          if (request !== onlineRequest) return;
          wallhavenNextSearchPage ??= 1;
          autoLoadFailures = 1;
          wallhavenAutoAfter = Date.now() + 6000;
          throw error;
        }
      }
    }
    toast(`${pad(S.items.length)} ${t('indexed')}`);
  } catch { toast(t('searchUnavailable')); }
  finally { refreshing = false; paintWallhavenMore(); loadGenreFeed(); queueWallhavenAutoLoad(); }
}

function filteredWallhaven() {
  return S.genre !== 'all' || S.ratio !== 'any' || S.resolution !== 'any';
}

function onlineFilters() {
  return { ratio: S.ratio, resolution: S.resolution, sort: S.sort };
}

function mergeOnlinePage(result, preserveOrder = true, refreshFirst = false) {
  if (!refreshFirst || wallhavenNextSearchPage === undefined) wallhavenNextSearchPage = result.nextPage;
  for (const item of result.items) onlineItems.set(item.id, item);
  renderSearch(preserveOrder, true);
}

function wallhavenMorePage() {
  if (S.scope !== 'all' || S.resolution === 'unknown') return null;
  if (wallpaperSearch.normalize(S.query)) return wallhavenNextSearchPage;
  const feed = S.sources.find(entry => entry.id === 'wallhaven');
  if (!feed) return null;
  if (filteredWallhaven()) return wallhavenNextSearchPage === undefined ? 1 : wallhavenNextSearchPage;
  return feed.loading ? null : feed.nextPage;
}

function loadGenreFeed() {
  if (filteredWallhaven() && !wallpaperSearch.normalize(S.query) && wallhavenNextSearchPage === undefined &&
      wallhavenMorePage() === 1) loadMoreWallhaven();
}

function paintWallhavenMore() {
  const button = $('#btn-wallhaven-more');
  const page = wallhavenMorePage();
  button.hidden = !page;
  button.disabled = refreshing || loadingMore;
  button.textContent = t(loadingMore ? 'loadingMore' : autoLoadFailures >= MAX_AUTO_FAILURES ? 'retryMore' : 'moreWallhaven');
  const empty = $('#empty-state span');
  const label = t(loadingMore || (page && autoLoadFailures < MAX_AUTO_FAILURES) ? 'waitingForImages'
    : page && autoLoadFailures >= MAX_AUTO_FAILURES ? 'loadingPaused' : 'nothing');
  if (empty.textContent !== label) empty.textContent = label;
}

async function loadMoreWallhaven(automatic = false) {
  const page = wallhavenMorePage();
  if (!page || loadingMore || refreshing) return;
  clearTimeout(autoLoadTimer);
  autoLoadTimer = 0;
  if (!automatic) {
    autoLoadFailures = 0;
  }
  const query = wallpaperSearch.normalize(S.query) ? S.query.trim() : '';
  const genre = S.genre;
  const supplemental = Boolean(query) || filteredWallhaven();
  const request = onlineRequest;
  if (supplemental) wallhavenNextSearchPage = page;
  loadingMore = true;
  wallhavenAutoAfter = Date.now() + PAGE_LOAD_INTERVAL;
  paintWallhavenMore();
  try {
    const result = await api.wallhavenMore(query, page, genre, onlineFilters());
    if (!supplemental) updateCatalog(result, true);
    else if (request === onlineRequest) mergeOnlinePage(result, Boolean(query) || page > 1);
    if (request === onlineRequest) {
      autoLoadFailures = 0;
    }
  } catch {
    if (request === onlineRequest) {
      autoLoadFailures++;
      wallhavenAutoAfter = Date.now() + (autoLoadFailures === 1 ? 6000 : 15000);
      if (autoLoadFailures >= MAX_AUTO_FAILURES) toast(t('loadingPaused'));
    }
  } finally {
    loadingMore = false;
    paintWallhavenMore();
    if (refreshQueued) refresh();
    else { loadGenreFeed(); queueWallhavenAutoLoad(); }
  }
}

function queueWallhavenAutoLoad() {
  if (autoLoadTimer || !canPrefetchWallhaven()) return;
  autoLoadTimer = setTimeout(() => {
    autoLoadTimer = 0;
    if (canPrefetchWallhaven()) loadMoreWallhaven(true);
  }, Math.max(16, wallhavenAutoAfter - Date.now()));
}

function canPrefetchWallhaven() {
  if (loadingMore || refreshing || composingSearch || !wallhavenMorePage() ||
      autoLoadFailures >= MAX_AUTO_FAILURES ||
      $('#detail').classList.contains('is-open') || $('#settings').classList.contains('is-open')) return false;
  const grid = $('#grid');
  return grid.clientHeight > 0 &&
    grid.scrollHeight - grid.scrollTop - grid.clientHeight <= grid.clientHeight * GRID_PREFETCH_SCREENS;
}

function resetOnlineSearch() {
  clearTimeout(autoLoadTimer);
  autoLoadTimer = 0;
  autoLoadFailures = 0;
  onlineRequest++;
  onlineSearchKey = '';
  onlineItems.clear();
  wallhavenNextSearchPage = undefined;
}

function syncSearchInput() {
  const value = $('#search').value;
  if (value !== S.query) {
    resetOnlineSearch();
    S.query = value;
    $('#grid').scrollTop = 0;
    renderSearch();
    loadGenreFeed();
  }
  updateSuggestions();
}

async function submitSearch(userSubmitted = true, force = false) {
  const query = S.query.trim();
  const genre = S.genre;
  closeSuggestions();
  rememberSearch(query);
  const words = wallpaperSearch.terms(query);
  const namedMatch = words.length && S.favorites.some(item => item.customName &&
    wallpaperSearch.matches({ text: wallpaperSearch.normalize(item.customName) }, words));
  if (!words.length || namedMatch || S.scope !== 'all' ||
      !S.sources.some(entry => entry.configured && entry.searchable)) {
    toast(`${pad(S.filtered.length)} ${t('images')}`);
    return;
  }
  const key = `${genre}:${query}`;
  if (!force && key === onlineSearchKey) return;
  onlineSearchKey = key;
  const request = ++onlineRequest;
  let result;
  try { result = await api.searchSources(query, genre, onlineFilters()); }
  catch { result = { items: [], failed: ['online'] }; }
  if (request !== onlineRequest) return;
  if (force) mergeOnlinePage({
    items: result.items,
    nextPage: result.failed.includes('wallhaven') ? wallhavenNextSearchPage : result.wallhavenNextPage
  }, true, true);
  else {
    onlineItems = new Map(result.items.map(item => [item.id, item]));
    wallhavenNextSearchPage = result.wallhavenNextPage || null;
    renderSearch(false, true);
  }
  if (result.failed.length) onlineSearchKey = '';
  if (userSubmitted || result.failed.length) {
    toast(`${pad(S.filtered.length)} ${t('images')}${result.failed.length ? ` / ${t('searchUnavailable')}` : ''}`);
  }
}
async function toggleFav() {
  if (!S.current) return;
  const item = S.current;
  try {
    const res = await api.toggleFavorite(item);
    updateFavorites(res.favorites, item.id);
    toast(res.favorited ? t('savedToast') : t('removed'));
  } catch { toast(t('saveFailed')); }
}

function openFavoriteNameDialog() {
  if (!S.current || !isFav(S.current.id)) return;
  const dialog = $('#favorite-name-dialog');
  if (dialog.open) return;
  const input = $('#favorite-name');
  dialog.dataset.id = S.current.id;
  input.value = customName(S.current) || S.current.title || '';
  $('#favorite-name-error').hidden = true;
  dialog.showModal();
  input.select();
}

async function saveFavoriteName(event) {
  event.preventDefault();
  const dialog = $('#favorite-name-dialog');
  const save = $('#favorite-name-save');
  const cancel = $('#favorite-name-cancel');
  if (save.disabled) return;
  save.disabled = cancel.disabled = true;
  const id = dialog.dataset.id;
  let result;
  try { result = await api.renameFavorite(id, $('#favorite-name').value); }
  catch { result = { ok: false }; }
  finally { save.disabled = cancel.disabled = false; }
  if (!result.ok) {
    const key = { INVALID_NAME: 'favoriteNameInvalid', NOT_FAVORITE: 'favoriteNameMissing' }[result.code];
    const error = $('#favorite-name-error');
    error.textContent = t(key || 'saveFailed');
    error.hidden = false;
    return;
  }
  updateFavorites(result.favorites, id);
  dialog.close();
  toast(t('favoriteNameSaved'));
}

function paintSort() {
  for (const button of $('#sort-control').querySelectorAll('[data-sort]')) {
    const active = button.dataset.sort === S.sort;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function bind() {
  $('#sort-control').addEventListener('click', event => {
    const sort = event.target.closest('[data-sort]')?.dataset.sort;
    if (!SORTS.includes(sort) || sort === S.sort) return;
    const restart = filteredWallhaven() || Boolean(S.query.trim());
    const submitted = Boolean(onlineSearchKey);
    if (restart) resetOnlineSearch();
    S.sort = sort;
    paintSort();
    persistFilters();
    $('#grid').scrollTop = 0;
    renderSearch();
    if (restart && submitted) submitSearch(false);
    else loadGenreFeed();
  });
  const search = $('#search');
  search.addEventListener('compositionstart', () => { composingSearch = true; closeSuggestions(); });
  search.addEventListener('compositionend', () => { composingSearch = false; syncSearchInput(); });
  search.addEventListener('input', event => { if (!composingSearch && !event.isComposing) syncSearchInput(); });
  search.addEventListener('focus', updateSuggestions);
  search.addEventListener('click', () => { if (!suggestionsOpen()) updateSuggestions(); });
  search.addEventListener('blur', closeSuggestions);
  const clearHistory = $('#btn-clear-search-history');
  clearHistory.addEventListener('mousedown', event => event.preventDefault());
  clearHistory.addEventListener('click', clearRecentSearches);
  $('#btn-refresh').addEventListener('click', refresh);
  $('#btn-wallhaven-more').addEventListener('click', () => loadMoreWallhaven());
  $('#btn-back-to-top').addEventListener('click', backToTop);
  $('#grid').addEventListener('scroll', () => {
    paintBackToTop();
    queueWallhavenAutoLoad();
  }, { passive: true });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-settings-close').addEventListener('click', closeSettings);
  $('#btn-close').addEventListener('click', closeDetail);
  bindPreviewControls();
  new ResizeObserver(paintPreview).observe($('#detail-preview'));
  $('#apply-bar').addEventListener('click', applyCurrent);
  $('#btn-undo-wallpaper').addEventListener('click', () => desktopAction(api.undoWallpaper, 'wallpaperUndone', '#receipt'));
  $('#btn-save-desktop-profile').addEventListener('click', () => desktopAction(api.saveDesktopProfile, 'desktopProfileSaved', '#desktop-profile-status'));
  $('#btn-restore-desktop-profile').addEventListener('click', () => desktopAction(api.restoreDesktopProfile, 'desktopProfileRestored', '#desktop-profile-status'));
  $('#btn-fav').addEventListener('click', toggleFav);
  $('#btn-rename-favorite').addEventListener('click', openFavoriteNameDialog);
  $('#favorite-name-form').addEventListener('submit', saveFavoriteName);
  $('#favorite-name-cancel').addEventListener('click', () => $('#favorite-name-dialog').close());
  $('#favorite-name-dialog').addEventListener('cancel', event => {
    if ($('#favorite-name-save').disabled) event.preventDefault();
  });
  $('#btn-save').addEventListener('click', saveImageAs);
  $('#btn-source').addEventListener('click', () => {
    if (S.current && S.current.pageUrl) api.openExternal(S.current.pageUrl);
    else toast(t('noSourceLink'));
  });
  $('#btn-lock').addEventListener('click', () => {
    S.syncLock = !S.syncLock;
    api.setSettings({ lockScreenSync: S.syncLock });
    paintSide(); toast(S.syncLock ? t('lockOn') : t('lockOff'));
  });
  $('#btn-monitor').addEventListener('click', () => {
    const monitors = previewMonitors();
    if (monitors.length < 2) { toast(t('oneDisplayToast')); return; }
    if (S.style === 'span') { toast(t('noteSpan')); return; }
    const next = monitors[monitors.findIndex(m => m.id === S.monitorId) + 1];
    S.monitorId = next?.id || null;
    paintPreview();
    paintSide(); toast(next ? `${t('display')} ${pad(next.index + 1, 2)}` : t('allDisplaysToast'));
  });
  $('#btn-save-cred').addEventListener('click', async () => {
    const patch = {};
    for (const [id, key] of [['cred-unsplash', 'unsplash'], ['cred-pexels', 'pexels']]) {
      const v = $('#' + id).value.trim(); if (v) patch[key] = v;
    }
    if (!Object.keys(patch).length) { toast(t('nothingChanged')); return; }
    const r = await api.setCredentials(patch);
    if (r && r.items) {
      S.credentials = r.credentials || S.credentials;
      resetOnlineSearch();
      updateCatalog(r);
    }
    toast(t('credentialsSaved')); closeSettings();
  });
  $('#btn-add-folder').addEventListener('click', async () => {
    const r = await api.pickFolder();
    if (r && r.ok) {
      S.folders = r.folders;
      if (r.items) updateCatalog(r);
      openSettings(); toast(t('localFolderAdded'));
    }
  });
  $('#btn-autostart').addEventListener('click', async () => {
    const r = await api.setAutoStart(!S.settings.autoStart);
    S.settings.autoStart = Boolean(r.actual);
    $('#btn-autostart').textContent = `${t('autoStart')} / ${r.actual ? t('on') : t('off')}`;
    toast(r.actual ? t('autoStartOn') : t('autoStartOff'));
  });
  $('#btn-cache-clear').addEventListener('click', async () => {
    const r = await api.cacheClear(); await refreshCacheInfo();
    toast(r.ok ? `${t('cacheCleared')} / ${r.removed}` : t('cacheClearFailed'));
  });
  document.querySelectorAll('.language-word').forEach(w =>
    w.addEventListener('click', () => setLanguage(w.dataset.lang)));
  document.querySelectorAll('.mode-word').forEach(w =>
    w.addEventListener('click', async () => {
      const cur = S.settings.windowMode === 'window' ? 'window' : 'immersive';
      if (w.dataset.mode === cur) { toast(t(cur === 'window' ? 'window' : 'immersive')); return; }
      paintModeWords();
      try {
        const r = await api.setWindowMode(w.dataset.mode);
        if (r && r.mode) S.settings.windowMode = r.mode;
      } catch (e) { /* this renderer is destroyed during rebuild */ }
    }));

  document.addEventListener('keydown', e => {
    if ($('#motion-library').classList.contains('is-open') || $('#favorite-name-dialog').open ||
        composingSearch || e.isComposing || e.keyCode === 229) return;
    const detailOpen = $('#detail').classList.contains('is-open');
    const settingsOpen = $('#settings').classList.contains('is-open');
    if (e.key === 'Escape') {
      if (suggestionsOpen()) { closeSuggestions(); return; }
      if (settingsOpen) closeSettings();
      else if (detailOpen) closeDetail();
      else api.hide();
      return;
    }
    if (settingsOpen) return;
    const typing = document.activeElement === $('#search');
    if (e.key === '/' && !typing && !detailOpen) { e.preventDefault(); $('#search').focus(); return; }
    if (typing && e.ctrlKey && e.key === 'Delete' && !$('#btn-clear-search-history').hidden) {
      e.preventDefault();
      clearRecentSearches();
      return;
    }
    if (typing && suggestionsOpen() && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      if (suggestIndex === -1) suggestIndex = e.key === 'ArrowDown' ? 0 : suggestList.length - 1;
      else suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestList.length) % suggestList.length;
      paintSuggestionActive();
      return;
    }
    if (e.key === 'Enter') {
      if (detailOpen && e.target instanceof HTMLButtonElement && $('#detail').contains(e.target)) return;
      if (detailOpen) applyCurrent();
      else if (typing) {
        e.preventDefault();
        if (suggestionsOpen() && suggestIndex >= 0) acceptSuggestion(suggestList[suggestIndex]);
        else submitSearch();
      }
      return;
    }
    if (detailOpen && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault(); stepDetail(e.key === 'ArrowRight' ? 1 : -1); return;
    }
    if (typing) return;
    if (e.key === 'Home' && !detailOpen) { e.preventDefault(); backToTop(); return; }
    const k = e.key.toLowerCase();
    if (k === 's') { toggleFav(); return; }
    if (k === 'r') { refresh(); return; }
    if (k === 'c') { clearFilters(); return; }
    if (k === 'f') { toggleWindowMode(); return; }
    if (k === 'd' && detailOpen) { saveImageAs(); return; }
  });
  window.addEventListener('wheel', e => {
    if (['#detail', '#settings', '#motion-library'].some(selector => $(selector).classList.contains('is-open'))) return;
    if (e.target instanceof Element && e.target.closest('#search-assist')) return;
    const grid = $('#grid');
    if (!(e.target instanceof Node) || !grid.contains(e.target)) grid.scrollTop += e.deltaY;
    if (e.deltaY > 0) queueWallhavenAutoLoad();
  }, { passive: true });
}

function bindApiEvents() {
  api.on('wallpaper:applyProgress', stage => {
    const key = { download: 'downloadingWallpaper', prepare: 'preparingWallpaper', write: 'applying' }[stage];
    if (S.busy && key) $('#receipt').textContent = t(key);
  });
  api.on('wallhaven:updated', ({ added, status, replace }) => {
    if (replace) {
      updateCatalog({ items: added.concat(S.items.filter(item => item.source !== 'wallhaven')),
        sources: S.sources.map(source => source.id === status.id ? status : source) });
      return;
    }
    S.sources = S.sources.map(source => source.id === status.id ? status : source);
    const fresh = added.filter(item => !indexedItems.has(item.id));
    for (const item of fresh) indexedItems.set(item.id, item);
    S.items = S.items.concat(fresh);
    renderSearch(true);
  });
  api.on('bootstrap:ready', d => {
    if (d.settings) S.settings = Object.assign({}, S.settings, d.settings);
    if (d.background) setPaper(d.background);
    if (!d.loading) updateCatalog(d);
  });
  api.on('wallpaper:changed', p => {
    S.undoAvailable = Boolean(p.undoAvailable);
    paintSide();
    if ('background' in p) setPaper(p.background);
    if (p.verification?.ok) { S.status = p.verification; paintEngineStatus(); }
    if (p.history) {
      S.history = p.history;
      if (S.scope === 'history') renderSearch();
    }
  });
  api.on('displays:changed', status => {
    S.status = status;
    if (status.ok && Array.isArray(status.monitors)) {
      const active = status.monitors.filter(m => m.active && m.width > 0 && m.height > 0);
      if (active.length) {
        const sameLayout = active.length === S.monitors.length && active.every((monitor, index) => {
          const previous = S.monitors[index];
          return ['id', 'index', 'x', 'y', 'width', 'height'].every(key => monitor[key] === previous[key]);
        });
        S.monitors = active;
        if (!active.some(m => m.id === S.monitorId)) S.monitorId = null;
        if (!sameLayout) {
          paintSide();
          paintPreview();
        }
      }
    }
    paintEngineStatus();
  });
  api.on('tray:command', p => {
    if (p.type !== 'favorite') return;
    updateFavorites(p.favorites, p.id);
    toast(p.favorited ? t('savedToast') : t('removed'));
  });
  api.on('sources:updated', refresh);
}

/* Stage scaling must NEVER wait on the network bootstrap. */
layout();
window.addEventListener('resize', layout);

/* Pointer-linked title tracking, identical in fullscreen and window. */
(function bindLogoMotion() {
  const logo = $('#logotype');
  document.addEventListener('mousemove', e => {
    const r = logo.getBoundingClientRect();
    if (!r.width) return;
    const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    logo.style.setProperty('--logo-shift', (nx * 0.014).toFixed(4) + 'em');
  });
})();

boot().catch(e => {
  $('#fatal').classList.add('is-on');
  $('#fatal-detail').textContent = String(e.message || e);
});
