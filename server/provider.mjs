import { join } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterMs = Number.isFinite(details.retryAfterMs) ? Math.max(0, details.retryAfterMs) : 0;
    this.retryable = Boolean(details.retryable);
  }
}

const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const number = (value) => Math.max(0, Number(value) || 0);
const shortPlayFilters = ['content_type_short_play'];
const rankingPrefix = 'rank.';
const isAvc = (codec) => /h264|avc/i.test(codec);

function playbackOptions(streams) {
  const options = new Map();
  for (const stream of streams) {
    const knownSize = stream.width > 0 && stream.height > 0;
    const landscape = knownSize && stream.width > stream.height;
    const maxWidth = landscape ? 1920 : 1080;
    const maxHeight = landscape ? 1080 : 1920;
    const factor = knownSize ? Math.min(1, maxWidth / stream.width, maxHeight / stream.height) : 0;
    const width = factor ? Math.max(2, Math.floor(stream.width * factor / 2) * 2) : 0;
    const height = factor ? Math.max(2, Math.floor(stream.height * factor / 2) * 2) : 0;
    const transcode = !isAvc(stream.codec) || (knownSize && factor < 1);
    const outputWidth = transcode ? width : stream.width;
    const outputHeight = transcode ? height : stream.height;
    const label = outputWidth && outputHeight ? `${Math.min(outputWidth, outputHeight)}p` : (stream.definition || stream.quality || '原画') + (transcode ? ' · 兼容' : '');
    // Signed URLs and bitrate can vary between models and episodes. Neither belongs in
    // the identity of the viewer's chosen quality, and keys never leave this adapter.
    const id = 'q_' + createHash('sha256').update(JSON.stringify([stream.definition, stream.codec, stream.width, stream.height, stream.quality])).digest('hex').slice(0, 20);
    const choice = { id, label, width: outputWidth, height: outputHeight, definition: stream.definition,
      stream, transcode, maxWidth: width || maxWidth, maxHeight: height || maxHeight };
    const previous = options.get(id);
    if (!previous || stream.bitrate > previous.stream.bitrate) options.set(id, choice);
  }
  const result = [...options.values()];
  // Different codec variants of the same rendition should appear once. Prefer the
  // AVC rendition so choosing a resolution need not involve codec knowledge.
  const renditions = new Map();
  for (const choice of result) {
    const key = `${choice.width}:${choice.height}:${choice.width ? '' : choice.label}`;
    const previous = renditions.get(key);
    if (!previous || (!choice.transcode && previous.transcode) || (choice.transcode === previous.transcode && choice.stream.bitrate > previous.stream.bitrate)) renditions.set(key, choice);
  }
  return [...renditions.values()].sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height));
}

function rankingCursor(page) {
  return page.has_more ? rankingPrefix + Buffer.from(JSON.stringify({ board: page.board || '', cursor: String(page.cursor || '') })).toString('base64url') : '';
}
function parseRankingCursor(cursor) {
  if (!cursor.startsWith(rankingPrefix)) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor.slice(rankingPrefix.length), 'base64url').toString('utf8'));
    if (typeof value.board !== 'string' || value.board.length > 200 || typeof value.cursor !== 'string' || value.cursor.length > 2000) throw new Error();
    return value;
  } catch { throw new ApiError(400, 'INVALID_CURSOR', '目录翻页标记无效，请重新加载推荐。'); }
}

function shareSeriesId(query) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(query)) return null;
  let url;
  try { url = new URL(query); }
  catch { throw new ApiError(400, 'INVALID_SHARE_URL', '分享链接格式无效，请粘贴红果官方播放页链接。'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new ApiError(400, 'INVALID_SHARE_URL', '仅支持红果官方 HTTPS 播放页链接。');
  }
  const pattern = url.hostname === 'hongguoduanju.com'
    ? /^\/player\/([0-9]{1,30})\/?$/
    : url.hostname === 'novelquickapp.com' ? /^\/player\/([0-9]{1,30})\/([0-9]{1,30})\/?$/ : null;
  const match = pattern?.exec(url.pathname);
  if (!match) throw new ApiError(400, 'INVALID_SHARE_URL', '仅支持 hongguoduanju.com 或 novelquickapp.com 的官方播放页链接。');
  return match[1];
}
export function normalizeDrama(raw = {}) {
  return {
    id: String(raw.id ?? raw.series_id ?? raw.book_id ?? ''),
    title: text(raw.title ?? raw.name ?? raw.book_name, 200) || '未命名短剧',
    description: text(raw.description ?? raw.abstract ?? raw.intro ?? raw.summary),
    cover: text(raw.cover_url ?? raw.cover ?? raw.poster_url, 4000),
    episodeCount: number(raw.episode_count),
    tags: (Array.isArray(raw.tags) ? raw.tags : Array.isArray(raw.categories) ? raw.categories : raw.category ? [raw.category] : [])
      .map((tag) => text(typeof tag === 'string' ? tag : tag.name ?? tag.title, 40)).filter(Boolean).slice(0, 12),
    playCount: number(raw.play_count ?? raw.read_count ?? raw.hot_value),
    ...(Number.isInteger(raw.pay_type) ? { payType: raw.pay_type } : {}),
    ...(Number.isInteger(raw.content_type) ? { contentType: raw.content_type } : {}),
    source: 'hongguo',
  };
}

function normalizeEpisode(raw, offset) {
  return {
    id: String(raw.id ?? raw.episode_id ?? raw.item_id ?? ''),
    index: number(raw.index ?? raw.episode_number ?? raw.order ?? raw.number) || offset + 1,
    title: text(raw.title ?? raw.name, 200) || `第 ${offset + 1} 集`,
    duration: number(raw.duration ?? raw.duration_seconds),
    ...(typeof raw.playable === 'boolean' ? { playable: raw.playable } : {}),
  };
}

function pageItems(page) {
  return Array.isArray(page) ? page : page?.items ?? page?.series ?? page?.episodes ?? [];
}

function upstreamError(error, operation, context = {}) {
  if (error instanceof ApiError) return error;
  let code = error?.code || 'UPSTREAM_UNAVAILABLE';
  if (code === 'ANONYMOUS_LIMITED' && operation !== 'play') code = 'UPSTREAM_EMPTY';
  const messages = {
    ANONYMOUS_LIMITED: '红果未返回这一分集的播放数据，可能存在匿名访问限制，请稍后再试。',
    UPSTREAM_EMPTY: '红果接口返回了空数据，当前目录或内容暂时不可用，请稍后重试。',
    AUTHENTICATION_REQUIRED: '这一内容需要红果官方账号授权，匿名接口暂时无法播放。',
    CHALLENGE_REQUIRED: '红果接口要求额外验证，暂时无法访问。',
    DEVICE_REJECTED: '红果拒绝了当前匿名设备，请稍后再试。',
    SIGNATURE_REJECTED: '红果接口签名已变化，需要更新 openhongguo SDK。',
    CONTENT_UNAVAILABLE: '这部短剧已下架，或当前匿名访问无权查看。',
    RATE_LIMITED: '红果请求过于频繁，请稍后再试。',
    TRANSPORT: '暂时无法连接红果，请检查后端网络。',
    SDK_NOT_INSTALLED: '后端尚未安装 openhongguo，请运行 npm install。',
    TIMEOUT: '红果接口响应超时，请稍后再试。',
  };
  return new ApiError(code === 'CONTENT_UNAVAILABLE' ? 404 : code === 'RATE_LIMITED' ? 429 : 503,
    code, messages[code] || '红果数据源暂时不可用，请稍后重试。', {
      retryAfterMs: error?.retryAfterMs || context.retryAfterMs,
      retryable: error?.retryable || ['RATE_LIMITED', 'TRANSPORT', 'TIMEOUT'].includes(code),
    });
}

function timeoutError() {
  return new ApiError(504, 'TIMEOUT', '红果接口响应超时，请稍后再试。', { retryable: true });
}
function cancelledError() {
  return new ApiError(499, 'REQUEST_ABORTED', '播放请求已取消。');
}

function retryAfter(headers, now) {
  const value = headers['retry-after'];
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const until = Date.parse(value);
  return Number.isFinite(until) ? Math.max(0, until - now) : 0;
}

/** Preserve compressed response bytes, while allowing a timed-out SDK operation to abort its socket. */
function abortableTransport(context, timeoutMs, now) {
  return (input) => new Promise((resolve, reject) => {
    const current = context();
    if (current?.controller.signal.aborted) { reject(timeoutError()); return; }
    const url = new URL(input.url);
    const module = url.protocol === 'http:' ? http : https;
    const request = module.request(url, {
      method: input.method || 'GET', headers: input.headers, timeout: timeoutMs,
      signal: current?.controller.signal,
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) request.destroy(new Error('response body too large'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        const headers = {};
        for (const [name, value] of Object.entries(response.headers)) {
          if (name !== 'cookie' && name !== 'set-cookie' && value !== undefined) headers[name] = String(Array.isArray(value) ? value[0] : value);
        }
        const cookies = {};
        for (const line of response.headers['set-cookie'] || []) {
          const pair = line.split(';', 1)[0];
          const at = pair.indexOf('=');
          if (at > 0) cookies[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
        }
        if (current && response.statusCode === 429) current.retryAfterMs = retryAfter(headers, now());
        resolve({ status: response.statusCode, headers, cookies, body: new Uint8Array(Buffer.concat(chunks)) });
      });
    });
    request.on('timeout', () => request.destroy(new Error('request timed out')));
    request.on('error', reject);
    if (input.body?.length) request.write(Buffer.from(input.body));
    request.end();
  });
}

/** The upstream README permits at most two device resets for playback-only limits. */
export function createPlaybackResolver() {
  let queue = Promise.resolve();
  return (sdk, id, signal) => {
    const operation = queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        if (signal?.aborted) throw timeoutError();
        try { return await sdk.resolvePlayback(id); }
        catch (error) {
          if (signal?.aborted) throw timeoutError();
          if (error?.code !== 'ANONYMOUS_LIMITED' || attempt >= 2) throw error;
          await sdk.resetDevice();
        }
      }
    });
    // A rejected playback must not prevent a later episode from being resolved.
    queue = operation.catch(() => {});
    return operation;
  };
}

export function createProvider(dataDirectory, options = {}, coverResolver = (_id, url) => url, dependencies = {}) {
  let clientPromise;
  let ready = false;
  let lastError = null;
  let filterPanel;
  const cache = new Map();
  const inFlight = new Map();
  const cooling = new Map();
  const now = dependencies.now || Date.now;
  let operations = Promise.resolve();
  let activeContext;
  const resolvePlayback = createPlaybackResolver();
  function decorateDrama(raw) {
    const drama = normalizeDrama(raw);
    drama.cover = coverResolver(drama.id, drama.cover);
    return drama;
  }
  async function client() {
    if (!clientPromise) {
      clientPromise = (async () => {
        let sdk;
        try { sdk = await import('openhongguo'); }
        catch (error) {
          if (error.code === 'ERR_MODULE_NOT_FOUND') throw Object.assign(error, { code: 'SDK_NOT_INSTALLED' });
          throw error;
        }
        const instance = await (dependencies.createClient || sdk.createClient)({
          profile: join(dataDirectory, 'anonymous.json'), timeoutMs: 16000, retryAttempts: 1,
          transport: abortableTransport(() => activeContext, options.timeoutMs || 16000, now),
          ...options,
        });
        ready = true;
        return instance;
      })().catch((error) => { clientPromise = undefined; throw error; });
    }
    return clientPromise;
  }
  function subscribe(entry, signal) {
    entry.waiters++;
    return new Promise((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        entry.waiters--;
        signal?.removeEventListener('abort', abort);
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        if (!entry.waiters) entry.cancel();
        reject(cancelledError());
      };
      signal?.addEventListener('abort', abort, { once: true });
      entry.promise.then((value) => { if (finish()) resolve(value); }, (error) => { if (finish()) reject(error); });
      if (signal?.aborted) abort();
    });
  }
  async function run(key, callback, ttl = 90000, signal) {
    if (signal?.aborted) throw cancelledError();
    const saved = cache.get(key);
    if (saved && saved.expires > now()) return saved.value;
    const limited = cooling.get(key);
    if (limited && limited.until > now()) throw new ApiError(429, 'RATE_LIMITED', limited.error.message, { retryAfterMs: limited.until - now(), retryable: true });
    cooling.delete(key);
    const pending = inFlight.get(key);
    if (pending && !pending.context.controller.signal.aborted) return subscribe(pending, signal);
    const operation = key.split(':', 1)[0];
    const context = { controller: new AbortController(), retryAfterMs: 0, failure: null };
    const timeoutMs = dependencies.timeouts?.[operation] ?? (operation === 'play' ? 32000 : 22000);
    let timer;
    const task = operations.then(async () => {
      if (context.controller.signal.aborted) throw context.failure || timeoutError();
      activeContext = context;
      try { return await callback(await client(), context.controller.signal); }
      finally { activeContext = undefined; }
    });
    operations = task.catch(() => {});
    const entry = { context, waiters: 0, promise: null, cancel: null };
    const timed = new Promise((_, reject) => {
      entry.cancel = () => {
        if (context.controller.signal.aborted) return;
        context.failure = cancelledError(); context.controller.abort(); reject(context.failure);
      };
      timer = setTimeout(() => { context.failure = timeoutError(); context.controller.abort(); reject(context.failure); }, timeoutMs);
    });
    const request = Promise.race([task, timed]).then((value) => {
      lastError = null;
      cache.set(key, { value, expires: typeof ttl === 'function' ? ttl(value) : now() + ttl });
      if (cache.size > 150) cache.delete(cache.keys().next().value);
      return value;
    }).catch((error) => {
      const mapped = context.failure || upstreamError(error, operation, context);
      if (mapped.code !== 'REQUEST_ABORTED') lastError = { code: mapped.code, message: mapped.message, retryAfterMs: mapped.retryAfterMs };
      if (mapped.code === 'RATE_LIMITED' && mapped.retryAfterMs > 0) cooling.set(key, { until: now() + mapped.retryAfterMs, error: mapped });
      throw mapped;
    }).finally(() => { clearTimeout(timer); if (inFlight.get(key) === entry) inFlight.delete(key); });
    entry.promise = request;
    inFlight.set(key, entry);
    return subscribe(entry, signal);
  }
  function normalizePage(page) {
    return {
      items: pageItems(page).map(decorateDrama).filter((item) => item.id),
      cursor: String(page?.cursor ?? ''), hasMore: Boolean(page?.has_more ?? page?.hasMore),
    };
  }
  async function categoryPage(sdk, tab, cursor) {
    const categories = {
      都市爱情: [['都市'], ['现言', '爱情']],
      甜宠: [['甜宠']],
      古装: [['古代', '古装']],
      逆袭: [['赘婿逆袭', '逆袭', '强者回归', '打脸虐渣']],
      悬疑: [['悬疑']],
      家庭: [['家长里短', '家庭', '亲情']],
      大女主: [['大女主', '女强']],
    };
    const wanted = categories[tab];
    if (!wanted) return sdk.search(tab, { cursor, pageSize: 18, filters: shortPlayFilters });
    // Resolve labels through the current SDK panel instead of assuming category IDs stay stable.
    if (!filterPanel) filterPanel = sdk.shortFilterPanel('short_play').catch((error) => { filterPanel = undefined; throw error; });
    const panel = await filterPanel;
    const selections = { genre: ['short_play'] };
    for (const names of wanted) {
      // Upstream can move a label between dimensions (e.g. 甜宠) across panel versions.
      const row = panel.find((entry) => entry.options.some((option) => names.includes(option.name)));
      const values = row?.options.filter((entry) => names.includes(entry.name)).map((entry) => entry.value) ?? [];
      if (!values.length) return { ...await sdk.search(tab, { cursor, pageSize: 18, filters: shortPlayFilters }), filter_mode: 'keyword' };
      selections[row.key] = values;
    }
    try {
      const page = await sdk.shortFilter({ selections, cursor });
      return { ...page, category_applied: true };
    } catch (error) {
      // Some anonymous devices can read the panel but are refused the category listing.
      // Keep the selected category useful through an explicit keyword-search fallback.
      if (!['CONTENT_UNAVAILABLE', 'ANONYMOUS_LIMITED'].includes(error?.code)) throw error;
      return { ...await sdk.search(tab, { cursor, pageSize: 18, filters: shortPlayFilters }), filter_mode: 'keyword' };
    }
  }
  return {
    status: () => ({ provider: 'openhongguo', providerReady: ready, providerError: lastError }),
    feed: ({ tab = '', cursor = '' } = {}) => run(`feed:${tab}:${cursor}`, async (sdk) => {
      const general = ['', '推荐', 'for-you', 'recommend', '全部'].includes(tab);
      let page;
      let ranked = false;
      if (general) {
        const continuation = parseRankingCursor(cursor);
        if (continuation) {
          ranked = true;
          page = await sdk.shortRank({ content: 'human', ...continuation });
        } else {
          try {
            page = await sdk.discover({ channel: '真人剧', cursor });
            if (!pageItems(page).length && (!cursor || page.has_more)) throw Object.assign(new Error('Empty discovery'), { code: 'ANONYMOUS_LIMITED' });
          } catch (error) {
            if (error?.code !== 'ANONYMOUS_LIMITED') throw error;
            // A tab's continuation can be empty even when the SDK already parsed useful cards.
            // Read the SDK's separate, public human-drama ranking instead of changing identity.
            page = await sdk.shortRank({ content: 'human' });
            ranked = true;
          }
        }
      } else page = await categoryPage(sdk, tab, cursor);
      const result = normalizePage(page);
      result.catalogMode = ranked ? 'ranking' : general ? 'discover' : 'category';
      if (ranked) result.cursor = rankingCursor(page);
      if (page.category_applied) result.items = result.items.map((item) => ({ ...item, tags: item.tags.length ? item.tags : [tab] }));
      if (page.filter_mode) result.filterMode = page.filter_mode;
      return result;
    }),
    search: (query, cursor = '') => {
      const value = query.trim();
      const seriesId = shareSeriesId(value);
      return run(`search:${JSON.stringify([seriesId ? 'share' : 'query', seriesId || value, cursor])}`, async (sdk) => seriesId
        ? { items: [decorateDrama(await sdk.getSeries(seriesId))], cursor: '', hasMore: false }
        : normalizePage(await sdk.search(value, { cursor, pageSize: 24 })));
    },
    poster: (id) => run(`poster:${id}`, async (sdk) => decorateDrama(await sdk.getSeries(id)).cover),
    details: (id) => run(`drama:${id}`, async (sdk) => {
      const [drama, page] = await Promise.all([sdk.getSeries(id), sdk.listEpisodes(id, { pageSize: 500 })]);
      const episodes = pageItems(page).map(normalizeEpisode).filter((episode) => episode.id);
      return { drama: decorateDrama(drama), episodes, episodesHasMore: Boolean(page?.has_more), episodesCursor: String(page?.cursor ?? '') };
    }),
    episodes: (id, cursor) => run(`episodes:${id}:${cursor}`, async (sdk) => {
      const page = await sdk.listEpisodes(id, { cursor, pageSize: 500 });
      return { items: pageItems(page).map(normalizeEpisode), cursor: String(page?.cursor ?? ''), hasMore: Boolean(page?.has_more) };
    }),
    playback: async (id, { signal, quality = '' } = {}) => {
      if (quality && !/^q_[a-f0-9]{20}$/.test(quality)) throw new ApiError(400, 'INVALID_QUALITY', '清晰度选项无效，请重新选择。');
      // Cache the complete SDK model once per episode. Quality changes only select
      // a rendition from this private cached model, never resolve another device.
      const model = await run(`play:${id}`, async (sdk, operationSignal) => {
        const response = await resolvePlayback(sdk, id, operationSignal);
        const playback = response?.playback ?? response;
        const streams = (playback?.streams ?? []).map((stream) => ({
          url: text(stream.url, 12000), definition: text(stream.definition, 30), codec: text(stream.codec, 50),
          quality: text(stream.quality, 30), width: number(stream.width), height: number(stream.height),
          bitrate: number(stream.bitrate), protected: Boolean(stream.protected),
        })).filter((stream) => /^https?:\/\//.test(stream.url));
        if (!streams.length) throw new ApiError(503, 'NO_PLAYABLE_STREAM', '红果没有返回可播放的公开地址，请稍后再试。');
        return { options: playbackOptions(streams), protected: Boolean(playback?.protected), key: response?.contentKey?.key,
          duration: number(playback?.duration_seconds), expiresAt: number(playback?.expires_at) * 1000 };
      }, (value) => value.expiresAt ? Math.max(now(), value.expiresAt - 15000) : now() + 5 * 60 * 1000, signal);
      if (signal?.aborted) throw cancelledError();
      const compatible = model.options.filter((option) => !option.transcode);
      const candidates = compatible.length ? compatible : model.options;
      const preferred = quality ? model.options.find((option) => option.id === quality)
        : candidates.find((option) => Math.min(option.width, option.height) === 720 || /^(720p?|hd)$/i.test(option.definition)) ?? candidates[0];
      if (!preferred) throw new ApiError(422, 'INVALID_QUALITY', '当前分集没有这个清晰度，请重新选择可用选项。');
      const { stream, transcode, maxWidth, maxHeight } = preferred;
      const qualities = model.options.map(({ id, label, width, height, definition }) => ({ id, label, width, height, definition }));
      const common = { codec: stream.codec, definition: stream.definition, duration: model.duration, expiresAt: model.expiresAt,
        qualities, selectedQuality: preferred.id };
      if (model.protected || stream.protected) {
        if (!/^[a-f0-9]{32}$/i.test(model.key ?? '')) throw new ApiError(422, 'DRM_PROTECTED', 'SDK 未提供此分集的可用内容密钥，请在官方客户端观看。');
        return { ...common, protected: true, media: { url: stream.url, key: model.key, codec: stream.codec, definition: stream.definition, transcode, maxWidth, maxHeight } };
      }
      if (transcode) return { ...common, protected: false, media: { url: stream.url, codec: stream.codec, definition: stream.definition, transcode, maxWidth, maxHeight } };
      return { ...common, protected: false, url: stream.url, streams: [{ url: stream.url, definition: stream.definition }] };
    },
  };
}
