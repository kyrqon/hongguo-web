import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMediaBridge } from './media.mjs';

const execute = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || (process.env.FFMPEG_PATH ? join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : 'ffprobe');

test('HEVC SDK media is actually transcoded to browser-compatible H.264/yuv420p/AAC without enlarging the frame', { timeout: 30000 }, async (t) => {
  try {
    const { stdout } = await execute(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 });
    if (!/\blibx265\b/.test(stdout) || !/\blibx264\b/.test(stdout) || !/\baac\b/.test(stdout)) { t.skip('FFmpeg test fixture requires libx265, libx264 and AAC encoders'); return; }
    await execute(ffprobe, ['-version'], { windowsHide: true, timeout: 5000 });
  } catch (error) {
    if (error.code === 'ENOENT') { t.skip('FFmpeg/ffprobe are not installed'); return; }
    throw error;
  }
  const directory = await mkdtemp(join(tmpdir(), 'hongguo-compatible-media-'));
  const source = join(directory, 'synthetic-hevc.mp4');
  const output = join(directory, 'compatible.mp4');
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Entirely synthetic picture and sound; no upstream content or account is involved.
  await execute(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '1.5', '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1:log-level=error',
    '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac', '-movflags', '+faststart', source],
  { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 });
  const input = await readFile(source);
  const bridge = createMediaBridge();
  let sourceRequests = 0;
  const server = createServer((req, res) => {
    if (req.url === '/synthetic.mp4') {
      sourceRequests++;
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': input.length }); res.end(input); return;
    }
    const token = req.url?.match(/^\/api\/media\/([a-f0-9]{48})\.mp4$/)?.[1];
    try { if (token) bridge.stream(token, req, res); else { res.writeHead(404); res.end(); } }
    catch (error) { res.writeHead(error.status || 500); res.end(error.code || 'error'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await bridge.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // An unencrypted non-AVC SDK stream must work without a fabricated content key.
  const capability = await bridge.create({ url: `${base}/synthetic.mp4`, codec: 'bytevc1', transcode: true });
  assert.match(capability, /^\/api\/media\/[a-f0-9]{48}\.mp4$/);
  const response = await fetch(base + capability, { headers: { Range: 'bytes=0-31' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('accept-ranges'), 'none');
  assert.equal(response.headers.get('x-hongguo-media-mode'), 'transcode');
  assert.equal(response.headers.get('content-type'), 'video/mp4');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 1000);
  await writeFile(output, bytes);
  const { stdout } = await execute(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output], { windowsHide: true, timeout: 5000 });
  const metadata = JSON.parse(stdout);
  const video = metadata.streams.find((stream) => stream.codec_type === 'video');
  const audio = metadata.streams.find((stream) => stream.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.codec_tag_string, 'avc1');
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(video.width, 320);
  assert.equal(video.height, 180);
  assert.equal(audio.codec_name, 'aac');
  assert.equal(audio.channels, 2);
  assert.equal(audio.sample_rate, '48000');
  assert.ok(Number(metadata.format.duration) > 1);
  assert.ok(sourceRequests >= 1);
  await bridge.close();
  assert.equal(bridge.status().activeStreams, 0);
});

test('media capabilities reject malformed optional keys and non-HTTP sources before starting FFmpeg', async () => {
  const bridge = createMediaBridge({ ffmpegPath: 'must-not-be-started' });
  for (const media of [
    { url: 'file:///private/video.mp4', codec: 'h264' },
    { url: 'https://example.invalid/video.mp4', key: '' },
    { url: 'https://example.invalid/video.mp4', key: 'not-a-content-key' },
  ]) await assert.rejects(bridge.create(media), { code: 'INVALID_MEDIA' });
  for (const start of [-1, NaN, Infinity, 86400.01, '2']) {
    await assert.rejects(bridge.create({ url: 'https://example.invalid/video.mp4', codec: 'h264', start }), { code: 'INVALID_START' });
  }
  assert.equal(bridge.status().activeStreams, 0);
});

test('a selected 1080p rendition retains its actual resolution while a smaller selection uses its own bounds', { timeout: 30000 }, async (t) => {
  try {
    const { stdout } = await execute(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 });
    if (!/\blibx265\b/.test(stdout) || !/\blibx264\b/.test(stdout)) { t.skip('FFmpeg test fixture requires libx265 and libx264'); return; }
    await execute(ffprobe, ['-version'], { windowsHide: true, timeout: 5000 });
  } catch (error) { if (error.code === 'ENOENT') { t.skip('FFmpeg/ffprobe are not installed'); return; } throw error; }
  const directory = await mkdtemp(join(tmpdir(), 'hongguo-quality-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, '1080-source.mp4');
  await execute(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=blue:size=1080x1920:rate=6', '-t', '0.5',
    '-c:v', 'libx265', '-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1:log-level=error',
    '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart', source],
  { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 });
  const input = await readFile(source);
  const bridge = createMediaBridge();
  const server = createServer((req, res) => {
    if (req.url === '/source.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': input.length }); res.end(input); return; }
    const token = req.url?.match(/^\/api\/media\/([a-f0-9]{48})\.mp4$/)?.[1];
    try { if (token) bridge.stream(token, req, res); else { res.writeHead(404); res.end(); } }
    catch (error) { res.writeHead(error.status || 500); res.end(error.code || 'error'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await bridge.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [width, height] of [[1080, 1920], [360, 640]]) {
    const capability = await bridge.create({ url: `${base}/source.mp4`, codec: 'bytevc1', transcode: true, maxWidth: width, maxHeight: height });
    const response = await fetch(base + capability);
    assert.equal(response.status, 200);
    const output = join(directory, `${width}.mp4`);
    await writeFile(output, Buffer.from(await response.arrayBuffer()));
    const { stdout } = await execute(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', output], { windowsHide: true, timeout: 5000 });
    const stream = JSON.parse(stdout).streams[0];
    assert.equal(stream.codec_name, 'h264');
    assert.equal(stream.width, width);
    assert.equal(stream.height, height);
  }
});

test('a resumed media capability starts near the requested source frame and resets its output timeline', { timeout: 30000 }, async (t) => {
  try {
    const { stdout } = await execute(ffmpeg, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024 });
    if (!/\blibx264\b/.test(stdout)) { t.skip('FFmpeg test fixture requires libx264'); return; }
    await execute(ffprobe, ['-version'], { windowsHide: true, timeout: 5000 });
  } catch (error) { if (error.code === 'ENOENT') { t.skip('FFmpeg/ffprobe are not installed'); return; } throw error; }
  const directory = await mkdtemp(join(tmpdir(), 'hongguo-start-media-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'timeline.mp4');
  // One long GOP makes a copy-based keyframe seek observably incorrect. The
  // picture changes from red to blue at t=2, while a requested t=2.2 must be blue.
  await execute(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=red:size=160x90:rate=10:duration=2',
    '-f', 'lavfi', '-i', 'color=c=blue:size=160x90:rate=10:duration=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '100', '-keyint_min', '100', '-sc_threshold', '0',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', source],
  { windowsHide: true, timeout: 15000, maxBuffer: 256 * 1024 });
  const input = await readFile(source);
  const bridge = createMediaBridge();
  const server = createServer((req, res) => {
    if (req.url === '/source.mp4') { res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': input.length }); res.end(input); return; }
    const token = req.url?.match(/^\/api\/media\/([a-f0-9]{48})\.mp4$/)?.[1];
    try { if (token) bridge.stream(token, req, res); else { res.writeHead(404); res.end(); } }
    catch (error) { res.writeHead(error.status || 500); res.end(error.code || 'error'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { await bridge.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // Even AVC with transcode:false must be accurately decoded when start > 0.
  const capability = await bridge.create({ url: `${base}/source.mp4`, codec: 'h264', transcode: false, start: 2.2, maxWidth: 160, maxHeight: 90 });
  const response = await fetch(base + capability);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-hongguo-media-mode'), 'transcode');
  const output = join(directory, 'resumed.mp4');
  await writeFile(output, Buffer.from(await response.arrayBuffer()));
  const { stdout } = await execute(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,start_time,duration:format=start_time,duration', '-of', 'json', output], { windowsHide: true, timeout: 5000 });
  const metadata = JSON.parse(stdout);
  assert.equal(metadata.streams[0].codec_name, 'h264');
  assert.ok(Number(metadata.format.duration) > 1.6 && Number(metadata.format.duration) < 2.1, `Expected remaining ~1.8 seconds, received ${metadata.format.duration}`);
  assert.ok(Math.abs(Number(metadata.format.start_time)) < .11, `Output must start near zero, received ${metadata.format.start_time}`);
  const frame = await execute(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', output, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'], { windowsHide: true, timeout: 5000, encoding: 'buffer', maxBuffer: 1024 });
  const [red, green, blue] = frame.stdout;
  assert.ok(blue > 180 && red < 60 && green < 60, `First output frame must be from t=2.2 (blue), received RGB ${red},${green},${blue}`);
});
