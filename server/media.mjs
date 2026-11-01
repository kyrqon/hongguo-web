import { spawn, execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { ApiError } from './provider.mjs';

const execute = promisify(execFile);

const isAvc = (codec) => /h264|avc/i.test(String(codec ?? ''));

/** Capability URLs can only reference media already returned by the SDK. */
export function createMediaBridge(options = {}) {
  const ffmpeg = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? 'ffmpeg';
  const maximum = 3;
  const ttl = 10 * 60 * 1000;
  const tickets = new Map();
  const processes = new Map();
  let availability;
  let encoders;
  async function check(transcode) {
    if (!availability) {
      availability = execute(ffmpeg, ['-version'], { timeout: 5000, windowsHide: true, maxBuffer: 16384 }).then(() => true).catch(() => { availability = undefined; throw new ApiError(503, 'FFMPEG_REQUIRED', '这个片源需要 FFmpeg 转为网页格式。请安装 FFmpeg 并加入 PATH，或设置 FFMPEG_PATH。'); });
    }
    await availability;
    if (transcode) {
      if (!encoders) {
        encoders = execute(ffmpeg, ['-hide_banner', '-encoders'], { timeout: 5000, windowsHide: true, maxBuffer: 256 * 1024 })
          .then(({ stdout }) => {
            if (!/\blibx264\b/.test(stdout) || !/\baac\b/.test(stdout)) {
              throw new ApiError(503, 'FFMPEG_CODEC_REQUIRED', '当前 FFmpeg 缺少 H.264 或 AAC 编码器，请使用包含 libx264 和 AAC 的完整版本。');
            }
          }).catch((error) => { encoders = undefined; throw error instanceof ApiError ? error : new ApiError(503, 'FFMPEG_CODEC_REQUIRED', '无法检查 FFmpeg 的 H.264 和 AAC 编码器，请检查 FFmpeg 配置。'); });
      }
      await encoders;
    }
  }
  return {
    async create(media) {
      if (!media || typeof media.url !== 'string' || !/^https?:\/\//.test(media.url)
        || (media.key !== undefined && !/^[a-f0-9]{32}$/i.test(media.key))) {
        throw new ApiError(422, 'INVALID_MEDIA', '当前片源无法转换为网页播放格式。');
      }
      try { new URL(media.url); } catch { throw new ApiError(422, 'INVALID_MEDIA', '当前片源地址无效。'); }
      const start = media.start ?? 0;
      if (!Number.isFinite(start) || start < 0 || start > 86400) throw new ApiError(422, 'INVALID_START', '视频转换起点无效。');
      // Remuxing preserves HEVC/AV1 and does not make those codecs browser-compatible.
      // A resumed stream also needs decoding to discard frames before the exact
      // requested point instead of resuming from an earlier copyable keyframe.
      const transcode = Boolean(media.transcode) || !isAvc(media.codec) || start > 0;
      await check(transcode);
      const now = Date.now();
      for (const [token, value] of tickets) if (value.expires < now) tickets.delete(token);
      if (tickets.size >= 100) tickets.delete(tickets.keys().next().value);
      const token = randomBytes(24).toString('hex');
      const bound = (value, fallback, maximum) => Number.isInteger(value) && value >= 2 && value <= maximum ? value : fallback;
      const landscape = Number(media.maxWidth) > Number(media.maxHeight);
      const maxWidth = bound(media.maxWidth, 720, landscape ? 1920 : 1080);
      const maxHeight = bound(media.maxHeight, 1280, landscape ? 1080 : 1920);
      tickets.set(token, { ...media, start, transcode, maxWidth, maxHeight, expires: now + ttl });
      return `/api/media/${token}.mp4`;
    },
    stream(token, req, res) {
      const media = tickets.get(token);
      if (!media || media.expires < Date.now()) {
        tickets.delete(token);
        throw new ApiError(410, 'MEDIA_EXPIRED', '播放地址已过期，请重新点击播放。');
      }
      if (processes.size >= maximum) throw new ApiError(429, 'MEDIA_BUSY', '同时播放的分集过多，请关闭其他播放窗口后重试。');
      // fMP4 is streamed from the beginning. Range is deliberately ignored with HTTP 200,
      // as permitted by HTTP; we do not advertise seek ranges or return a false 206.
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'none', 'Cache-Control': 'no-store', 'X-Hongguo-Media-Mode': media.transcode ? 'transcode' : 'remux' });
        res.end(); return;
      }
      const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-rw_timeout', '15000000',
        '-protocol_whitelist', 'http,https,tcp,tls,crypto', '-threads', '2'];
      if (media.key !== undefined) args.push('-decryption_key', media.key);
      if (media.start > 0) args.push('-ss', media.start.toFixed(6));
      args.push('-i', media.url, '-map', '0:v:0', '-map', '0:a:0?');
      if (media.transcode) {
        args.push('-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-crf', '23',
          '-threads:v', '2', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-tag:v', 'avc1',
          '-vf', `scale=w=min(${media.maxWidth}\\,iw):h=min(${media.maxHeight}\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2`,
          '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
          '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000');
      } else args.push('-c', 'copy');
      args.push('-avoid_negative_ts', 'make_zero', '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-frag_duration', '1000000', '-flush_packets', '1', '-f', 'mp4', 'pipe:1');
      const child = spawn(ffmpeg, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      processes.set(child, media.transcode);
      let started = false;
      let ended = false;
      const fail = (status, code, message) => {
        if (ended || res.destroyed) return;
        ended = true;
        child.stdout.unpipe(res);
        if (res.headersSent) { res.destroy(); return; }
        res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { code, message } }));
      };
      const stop = () => { if (!child.killed && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
      const firstByte = setTimeout(() => { fail(504, 'MEDIA_TIMEOUT', '视频片源响应超时，请重新播放。'); stop(); }, 30000);
      const lifetime = setTimeout(() => { fail(504, 'MEDIA_TIMEOUT', '视频连接超时，请重新播放。'); stop(); }, ttl);
      firstByte.unref(); lifetime.unref();
      // Drain diagnostics without printing signed URLs or key-bearing process arguments.
      child.stderr.resume();
      child.stdout.once('data', () => {
        if (ended || res.destroyed || res.writableEnded) { stop(); return; }
        started = true;
        clearTimeout(firstByte);
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'none', 'Cache-Control': 'no-store', 'X-Hongguo-Media-Mode': media.transcode ? 'transcode' : 'remux' });
      });
      child.stdout.pipe(res, { end: false });
      child.on('error', () => { fail(503, 'MEDIA_PROCESS_ERROR', '视频格式转换未能启动，请检查 FFmpeg 配置。'); });
      child.on('close', (code) => {
        processes.delete(child);
        clearTimeout(firstByte); clearTimeout(lifetime);
        req.off('aborted', stop); res.off('close', stop);
        if (code !== 0 || !started) fail(502, 'MEDIA_CONVERSION_FAILED', '当前视频片源未能转换，请重试或选择其他分集。');
        else if (!res.destroyed && !res.writableEnded) { ended = true; res.end(); }
      });
      req.once('aborted', stop);
      res.once('close', stop);
    },
    close() {
      const stopped = [...processes.keys()].map((child) => new Promise((resolve) => {
        child.once('close', resolve);
        if (!child.killed) child.kill('SIGKILL');
      }));
      tickets.clear();
      return Promise.all(stopped);
    },
    status: () => ({ mediaMode: 'ffmpeg-compatible', activeStreams: processes.size,
      activeTranscodes: [...processes.values()].filter(Boolean).length,
      activeRemuxes: [...processes.values()].filter((value) => !value).length }),
  };
}
