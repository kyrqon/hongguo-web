import { spawn } from 'node:child_process';
import { ApiError } from './provider.mjs';

const MAX_BYTES = 8 * 1024 * 1024;
const CACHE_BYTES = 64 * 1024 * 1024;

/** Only SDK-returned covers are registered; the route accepts series IDs, never a URL. */
export function createPosterBridge(options = {}) {
  const ffmpeg = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const sources = new Map();
  const cache = new Map();
  const pending = new Map();
  const children = new Set();
  const waiting = [];
  let cacheSize = 0;
  let active = 0;
  let closed = false;
  async function acquire() {
    while (active >= 4 && !closed) await new Promise((resolve) => waiting.push(resolve));
    if (closed) throw new ApiError(503, 'SHUTTING_DOWN', '服务正在关闭。');
    active++;
  }
  function release() { active--; waiting.shift()?.(); }
  function convert(input) {
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-threads', '1', '-i', 'pipe:0', '-frames:v', '1', '-vf', 'scale=640:-2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-threads', '1', '-q:v', '3', 'pipe:1'], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      children.add(child);
      const chunks = [];
      let size = 0;
      let settled = false;
      const fail = () => { if (!settled) { settled = true; reject(new ApiError(502, 'POSTER_CONVERSION_FAILED', '真实封面暂时无法转换，请稍后刷新。')); } };
      const timer = setTimeout(() => { fail(); if (!child.killed) child.kill('SIGKILL'); }, 15000);
      timer.unref();
      child.stdout.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) { fail(); if (!child.killed) child.kill('SIGKILL'); }
        else chunks.push(chunk);
      });
      child.stderr.resume();
      child.stdin.on('error', () => {});
      child.on('error', fail);
      child.on('close', (code) => {
        children.delete(child); clearTimeout(timer);
        if (code !== 0 || !size) fail();
        else if (!settled) { settled = true; resolve(Buffer.concat(chunks)); }
      });
      child.stdin.end(input);
    });
  }
  async function load(id, resolveMissing) {
    const now = Date.now();
    const cached = cache.get(id);
    if (cached?.expires > now) return cached;
    if (pending.has(id)) return pending.get(id);
    if (pending.size > 100) throw new ApiError(503, 'POSTER_BUSY', '封面加载繁忙，请稍后刷新。');
    const operation = (async () => {
      await acquire();
      try {
        if (!sources.has(id) || sources.get(id).expires < now) await resolveMissing();
        const source = sources.get(id);
        if (!source) throw new ApiError(404, 'POSTER_UNAVAILABLE', '这部短剧暂时没有可用封面。');
        const response = await fetch(source.url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new ApiError(502, 'POSTER_UNAVAILABLE', '红果封面暂时不可用。');
        const type = (response.headers.get('content-type') ?? '').split(';')[0].toLowerCase();
        if (!type.startsWith('image/')) { await response.body?.cancel(); throw new ApiError(502, 'INVALID_POSTER', '封面接口未返回图片。'); }
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > MAX_BYTES) throw new ApiError(413, 'POSTER_TOO_LARGE', '封面图片超过大小限制。');
          chunks.push(chunk);
        }
        let bytes = Buffer.concat(chunks);
        let contentType = type;
        const brand = bytes.subarray(8, 12).toString('ascii');
        if (/hei[cf]/.test(type) || ['heic', 'heix', 'hevc', 'hevx', 'mif1'].includes(brand)) {
          bytes = await convert(bytes); contentType = 'image/jpeg';
        }
        const entry = { bytes, contentType, expires: Date.now() + 60 * 60 * 1000 };
        if (cache.has(id)) { cacheSize -= cache.get(id).bytes.length; cache.delete(id); }
        while (cache.size && (cache.size >= 120 || cacheSize + bytes.length > CACHE_BYTES)) {
          const oldest = cache.keys().next().value;
          cacheSize -= cache.get(oldest).bytes.length; cache.delete(oldest);
        }
        cache.set(id, entry); cacheSize += bytes.length;
        return entry;
      } finally { release(); }
    })().finally(() => pending.delete(id));
    pending.set(id, operation);
    return operation;
  }
  return {
    register(id, url) {
      if (!/^[0-9]{1,30}$/.test(id) || !/^https?:\/\//.test(url)) return '';
      if (sources.size > 1000) sources.delete(sources.keys().next().value);
      sources.set(id, { url, expires: Date.now() + 60 * 60 * 1000 });
      return `/api/posters/${id}.jpg`;
    },
    async serve(id, req, res, resolveMissing) {
      let entry;
      try { entry = await load(id, resolveMissing); }
      catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(502, 'POSTER_UNAVAILABLE', '真实封面暂时无法加载，请稍后刷新。');
      }
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': entry.contentType, 'Content-Length': entry.bytes.length, 'Cache-Control': 'public, max-age=3600' });
      res.end(req.method === 'HEAD' ? undefined : entry.bytes);
    },
    close() {
      closed = true;
      for (const resume of waiting.splice(0)) resume();
      return Promise.all([...children].map((child) => new Promise((resolve) => {
        child.once('close', resolve);
        if (!child.killed) child.kill('SIGKILL');
      })));
    },
  };
}
