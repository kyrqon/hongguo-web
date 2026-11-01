import { createServer } from 'node:http';
import { randomBytes, scrypt as scryptCallback, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openStore } from './store.mjs';
import { ApiError, createProvider } from './provider.mjs';
import { createMediaBridge } from './media.mjs';
import { createPosterBridge } from './posters.mjs';

try { process.loadEnvFile?.(); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const scrypt = promisify(scryptCallback);
const directory = dirname(fileURLToPath(import.meta.url));
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = 'hongguo_session';
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
const publicUser = (user) => user ? { id: user.id, username: user.username } : null;
const safeString = (value, length = 200) => typeof value === 'string' ? value.trim().slice(0, length) : '';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };

function send(res, status, value) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
    throw new ApiError(415, 'JSON_REQUIRED', '请使用 JSON 格式提交数据。');
  }
  let size = 0;
  const buffers = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new ApiError(413, 'BODY_TOO_LARGE', '提交的数据过大。');
    buffers.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(buffers).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new ApiError(400, 'INVALID_JSON', '数据格式有误。'); }
}

function credentials(data) {
  const username = safeString(data.username, 100).normalize('NFKC');
  if (!/^[\p{L}\p{N}_-]{2,32}$/u.test(username)) {
    throw new ApiError(400, 'INVALID_USERNAME', '用户名需为 2–32 个文字、字母、数字、下划线或短横线。');
  }
  if (typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128) {
    throw new ApiError(400, 'INVALID_PASSWORD', '密码需为 8–128 个字符。');
  }
  return { username, key: username.toLocaleLowerCase('en-US'), password: data.password };
}

function safeDrama(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'INVALID_DRAMA', '缺少短剧信息。');
  const id = safeString(input.id, 200);
  const title = safeString(input.title);
  if (!id || !title) throw new ApiError(400, 'INVALID_DRAMA', '缺少短剧编号或名称。');
  const cover = safeString(input.cover, 4000);
  return {
    id, title, description: safeString(input.description, 2000),
    cover: /^(https?:\/\/|\/)/.test(cover) ? cover : '',
    episodeCount: Math.max(0, Math.min(100000, Number(input.episodeCount) || 0)),
    tags: Array.isArray(input.tags) ? input.tags.map((item) => safeString(item, 40)).filter(Boolean).slice(0, 12) : [],
    playCount: Math.max(0, Number(input.playCount) || 0),
    source: input.source === 'demo' ? 'demo' : 'hongguo',
    ...(Number.isInteger(input.payType) && input.payType >= 0 ? { payType: input.payType } : {}),
    ...(Number.isInteger(input.contentType) && input.contentType >= 0 ? { contentType: input.contentType } : {}),
  };
}

// A stable series-based URL also repairs old saved signed/HEIC URLs after a restart.
function publicDrama(drama) {
  return drama.source === 'hongguo' && /^[0-9]{1,30}$/.test(drama.id)
    ? { ...drama, cover: `/api/posters/${drama.id}.jpg` } : drama;
}
const publicFavorites = (user) => user.favorites.map(publicDrama);
const publicHistory = (user) => user.history.map((entry) => ({ ...entry, drama: publicDrama(entry.drama) }));

/** Exports an unbound server so tests can use isolated data and an ephemeral port. */
export async function createApp(options = {}) {
  const dataDirectory = resolve(options.dataDirectory ?? process.env.HONGGUO_DATA_DIR ?? join(directory, 'data'));
  const staticDirectory = resolve(options.staticDirectory ?? join(directory, '..', 'dist'));
  const store = await openStore(dataDirectory);
  const posters = options.posters ?? createPosterBridge();
  const provider = options.provider ?? createProvider(dataDirectory, {}, (id, url) => posters.register(id, url));
  const media = options.media ?? createMediaBridge();
  const secure = options.cookieSecure ?? process.env.COOKIE_SECURE === 'true';
  const sameSite = (options.cookieSameSite ?? process.env.COOKIE_SAME_SITE ?? 'lax').toLowerCase();
  if (!['lax', 'strict', 'none'].includes(sameSite) || (sameSite === 'none' && !secure)) {
    throw new Error('COOKIE_SAME_SITE must be lax, strict or none. none requires COOKIE_SECURE=true.');
  }
  const allowedOrigins = new Set((options.corsOrigins ?? process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173,http://localhost,capacitor://localhost,https://localhost').split(',').map((item) => item.trim()).filter(Boolean));
  const attempts = new Map();
  function cookie(res, token, clear = false) {
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${clear ? 0 : SESSION_TTL / 1000}${secure ? '; Secure' : ''}`);
  }
  function session(req) {
    const token = String(req.headers.cookie ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const record = store.state.sessions.find((entry) => entry.hash === tokenHash(token) && entry.expires > Date.now());
    const user = record && store.state.users.find((entry) => entry.id === record.userId);
    return user ? { user, record } : null;
  }
  function requireUser(req) {
    const found = session(req);
    if (!found) throw new ApiError(401, 'LOGIN_REQUIRED', '登录后即可保存收藏和观看记录。');
    return found.user;
  }
  function throttle(req) {
    const address = req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    if (attempts.size > 1000) for (const [key, value] of attempts) if (value.reset < now) attempts.delete(key);
    let record = attempts.get(address);
    if (!record || record.reset < now) { record = { count: 0, reset: now + 10 * 60 * 1000 }; attempts.set(address, record); }
    if (++record.count > 30) throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '登录尝试过多，请十分钟后重试。');
  }
  async function newSession(user, res) {
    const token = randomBytes(32).toString('hex');
    store.state.sessions = store.state.sessions.filter((entry) => entry.expires > Date.now());
    // Bound sessions per account while permitting several devices.
    const own = store.state.sessions.filter((entry) => entry.userId === user.id);
    if (own.length >= 20) store.state.sessions = store.state.sessions.filter((entry) => entry !== own[0]);
    store.state.sessions.push({ hash: tokenHash(token), userId: user.id, expires: Date.now() + SESSION_TTL });
    await store.save();
    cookie(res, token);
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
      const origin = req.headers.origin;
      const host = req.headers.host;
      const sameOrigin = origin === `http://${host}` || origin === `https://${host}`;
      if (origin && !sameOrigin && !allowedOrigins.has(origin)) {
        throw new ApiError(403, 'ORIGIN_REJECTED', '此网页来源未获允许，请检查 CORS_ORIGINS 配置。');
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
        res.end(); return;
      }
      const path = url.pathname;
      const method = req.method;
      if (method === 'GET' && path === '/api/health') {
        send(res, 200, { ok: true, ...provider.status(), ...media.status(), auth: 'local' }); return;
      }
      if (method === 'GET' && path === '/api/auth/me') { send(res, 200, { user: publicUser(session(req)?.user) }); return; }
      if (method === 'POST' && (path === '/api/auth/register' || path === '/api/auth/login')) {
        throttle(req);
        const { username, key, password } = credentials(await body(req));
        if (path.endsWith('/register')) {
          const salt = randomBytes(16).toString('hex');
          const hash = (await scrypt(password, salt, 64)).toString('hex');
          // Check after asynchronous hashing so simultaneous registrations cannot duplicate names.
          if (store.state.users.some((entry) => entry.key === key)) throw new ApiError(409, 'USERNAME_TAKEN', '这个用户名已经注册，请直接登录或换一个用户名。');
          const user = { id: randomBytes(16).toString('hex'), username, key, salt, hash, favorites: [], history: [], createdAt: new Date().toISOString() };
          store.state.users.push(user);
          await newSession(user, res);
          send(res, 201, { user: publicUser(user) }); return;
        }
        const user = store.state.users.find((entry) => entry.key === key);
        const calculated = await scrypt(password, user?.salt ?? 'nonexistent-account-padding-salt', 64);
        if (!user || !timingSafeEqual(Buffer.from(user.hash, 'hex'), calculated)) throw new ApiError(401, 'INVALID_CREDENTIALS', '用户名或密码不正确。');
        await newSession(user, res);
        send(res, 200, { user: publicUser(user) }); return;
      }
      if (method === 'POST' && path === '/api/auth/logout') {
        const current = session(req);
        if (current) { store.state.sessions = store.state.sessions.filter((entry) => entry !== current.record); await store.save(); }
        cookie(res, '', true); send(res, 200, { ok: true }); return;
      }
      if (path === '/api/favorites' && method === 'GET') { send(res, 200, { items: publicFavorites(requireUser(req)) }); return; }
      if (path === '/api/favorites' && method === 'POST') {
        const user = requireUser(req);
        const drama = safeDrama((await body(req)).drama);
        user.favorites = [drama, ...user.favorites.filter((entry) => entry.id !== drama.id)].slice(0, 1000);
        await store.save(); send(res, 200, { items: publicFavorites(user) }); return;
      }
      const favoriteMatch = path.match(/^\/api\/favorites\/([^/]+)$/);
      if (favoriteMatch && method === 'DELETE') {
        const user = requireUser(req);
        const id = decodeURIComponent(favoriteMatch[1]);
        user.favorites = user.favorites.filter((entry) => entry.id !== id);
        await store.save(); send(res, 200, { items: publicFavorites(user) }); return;
      }
      if (path === '/api/history' && method === 'GET') { send(res, 200, { items: publicHistory(requireUser(req)) }); return; }
      if (path === '/api/history' && method === 'POST') {
        const user = requireUser(req);
        const input = await body(req);
        const drama = safeDrama(input.drama);
        const episodeId = safeString(input.episodeId);
        if (!episodeId) throw new ApiError(400, 'INVALID_EPISODE', '缺少分集编号。');
        const item = { drama, episodeId, episodeIndex: Math.max(1, Math.min(100000, Number(input.episodeIndex) || 1)), position: Math.max(0, Math.min(10000000, Number(input.position) || 0)), updatedAt: new Date().toISOString() };
        user.history = [item, ...user.history.filter((entry) => entry.drama.id !== drama.id)].slice(0, 300);
        await store.save(); send(res, 200, { ok: true, item: { ...item, drama: publicDrama(item.drama) } }); return;
      }
      if (path === '/api/history' && method === 'DELETE') {
        const user = requireUser(req); user.history = []; await store.save(); send(res, 200, { ok: true }); return;
      }
      if (path === '/api/feed' && method === 'GET') {
        send(res, 200, await provider.feed({ tab: safeString(url.searchParams.get('tab'), 40), cursor: safeString(url.searchParams.get('cursor'), 1000) })); return;
      }
      if (path === '/api/search' && method === 'GET') {
        const query = safeString(url.searchParams.get('q'), 100);
        if (!query) throw new ApiError(400, 'QUERY_REQUIRED', '请输入想看的短剧名称。');
        send(res, 200, await provider.search(query, safeString(url.searchParams.get('cursor'), 1000))); return;
      }
      const dramaMatch = path.match(/^\/api\/dramas\/([^/]+)(\/episodes)?$/);
      if (dramaMatch && method === 'GET') {
        const id = decodeURIComponent(dramaMatch[1]);
        if (id.length > 200) throw new ApiError(400, 'INVALID_ID', '短剧编号过长。');
        send(res, 200, await (dramaMatch[2] ? provider.episodes(id, safeString(url.searchParams.get('cursor'), 1000)) : provider.details(id))); return;
      }
      const playMatch = path.match(/^\/api\/episodes\/([^/]+)\/play$/);
      if (playMatch && method === 'GET') {
        const id = decodeURIComponent(playMatch[1]);
        if (id.length > 200) throw new ApiError(400, 'INVALID_ID', '分集编号过长。');
        const controller = new AbortController();
        const cancel = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', cancel);
        try {
          const quality = url.searchParams.get('quality') || '';
          if (quality && !/^q_[a-f0-9]{20}$/.test(quality)) throw new ApiError(400, 'INVALID_QUALITY', '清晰度选项无效，请重新选择。');
          const startInput = url.searchParams.get('start');
          const requestedStart = startInput === null ? 0 : Number(startInput);
          if ((startInput !== null && !startInput.trim()) || !Number.isFinite(requestedStart) || requestedStart < 0 || requestedStart > 86400) {
            throw new ApiError(400, 'INVALID_START', '播放起点无效，请选择 0 到 86400 秒之间的位置。');
          }
          const playback = await provider.playback(id, { signal: controller.signal, quality });
          if (controller.signal.aborted) return;
          if (playback.media) {
            const end = Number.isFinite(playback.duration) && playback.duration > 0 ? Math.max(0, playback.duration - .1) : 86400;
            const timeOffset = Math.floor(Math.min(requestedStart, end) * 1000) / 1000;
            const selectedMedia = { ...playback.media, start: timeOffset, transcode: Boolean(playback.media.transcode) || timeOffset > 0 };
            const url = await media.create(selectedMedia);
            send(res, 200, { url, protected: false, converted: true, transcoded: selectedMedia.transcode, codec: selectedMedia.transcode ? 'h264' : playback.codec, duration: playback.duration ?? 0,
              timeOffset, streams: [{ url, definition: playback.definition }], qualities: playback.qualities || [], selectedQuality: playback.selectedQuality || '' });
          } else send(res, 200, { ...playback, timeOffset: 0 });
        } finally { res.off('close', cancel); }
        return;
      }
      const mediaMatch = path.match(/^\/api\/media\/([a-f0-9]{48})\.mp4$/);
      if (mediaMatch && ['GET', 'HEAD'].includes(method)) { media.stream(mediaMatch[1], req, res); return; }
      const posterMatch = path.match(/^\/api\/posters\/([0-9]{1,30})\.jpg$/);
      if (posterMatch && ['GET', 'HEAD'].includes(method)) {
        const id = posterMatch[1];
        await posters.serve(id, req, res, () => provider.poster(id)); return;
      }
      if (path.startsWith('/api/')) throw new ApiError(404, 'NOT_FOUND', '没有找到这个接口。');
      if (!['GET', 'HEAD'].includes(method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', '不支持这个请求方式。');
      let relative;
      try { relative = decodeURIComponent(path).replace(/^\/+/, ''); } catch { throw new ApiError(400, 'INVALID_PATH', '网址格式有误。'); }
      let file = resolve(staticDirectory, relative || 'index.html');
      if (file !== staticDirectory && !file.startsWith(staticDirectory + sep)) throw new ApiError(403, 'INVALID_PATH', '无法访问此路径。');
      try {
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
        await stat(file);
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
        if (extname(relative)) throw new ApiError(404, 'NOT_FOUND', '没有找到这个文件。');
        file = join(staticDirectory, 'index.html');
      }
      let content;
      try { content = await readFile(file); }
      catch (error) {
        if (error.code === 'ENOENT') throw new ApiError(404, 'BUILD_REQUIRED', '网页尚未构建。开发时请运行 npm run dev，或先执行 npm run build。');
        throw error;
      }
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
      res.end(method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (!(error instanceof ApiError)) console.error(`[hongguo] ${error.code || error.name || 'InternalError'}`);
      const retryAfterMs = Math.max(0, Number(error.retryAfterMs) || 0);
      if (retryAfterMs && !res.headersSent) res.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)));
      send(res, error.status ?? 500, { error: { code: error.code ?? 'INTERNAL_ERROR', message: error instanceof ApiError ? error.message : '服务暂时出现问题，请稍后再试。', ...(retryAfterMs ? { retryAfterMs } : {}) } });
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.on('close', () => { void media.close(); void posters.close(); });
  let shutdownPromise;
  const shutdown = () => {
    if (!shutdownPromise) shutdownPromise = (async () => {
      // Stop our subprocesses before closing their client connections.
      await media.close();
      await posters.close();
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      });
      await store.flush();
    })();
    return shutdownPromise;
  };
  return { server, store, provider, shutdown };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server, shutdown } = await createApp();
  const port = Number(process.env.PORT || 8787);
  const host = process.env.HOST || '127.0.0.1';
  // Only the standalone process owns signal handlers; embedded/test servers do not.
  const stop = () => { void shutdown().catch((error) => { console.error(`[hongguo] Shutdown failed: ${error.code ?? error.name}`); process.exitCode = 1; }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  server.on('error', (error) => { console.error(`[hongguo] Could not start: ${error.code ?? error.message}`); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Hongguo Web: http://${host}:${port}`));
}
