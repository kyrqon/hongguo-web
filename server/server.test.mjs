import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createApp } from './index.mjs';
import { ApiError, createPlaybackResolver, createProvider, normalizeDrama } from './provider.mjs';

test('local accounts isolate favorites, persist history, and invalidate logout sessions', async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'hongguo-test-'));
  const provider = {
    status: () => ({ provider: 'openhongguo', providerReady: false, providerError: null }),
    feed: async () => { throw new ApiError(503, 'ANONYMOUS_LIMITED', '匿名访问受限'); },
  };
  const app = await createApp({ dataDirectory, staticDirectory: dataDirectory, provider });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { app.server.closeAllConnections(); await new Promise((resolve) => app.server.close(resolve)); await app.store.flush(); await rm(dataDirectory, { recursive: true, force: true }); });
  const request = async (path, { cookie, method = 'GET', data, origin } = {}) => {
    const response = await fetch(base + path, { method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { response, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  assert.equal((await request('/api/health')).data.ok, true);
  assert.equal((await request('/api/favorites')).response.status, 401);
  const registration = await request('/api/auth/register', { method: 'POST', data: { username: '测试观众', password: 'correct-secret-123' } });
  assert.equal(registration.response.status, 201);
  assert.equal(registration.data.user.username, '测试观众');
  assert.match(registration.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(registration.response.headers.get('set-cookie'), /SameSite=lax/);
  const cookie = registration.cookie;
  assert.equal((await request('/api/auth/me', { cookie })).data.user.username, '测试观众');
  assert.equal((await request('/api/auth/register', { method: 'POST', data: { username: '测试观众', password: 'different-secret-123' } })).response.status, 409);
  assert.equal((await request('/api/auth/login', { method: 'POST', data: { username: '测试观众', password: 'incorrect-secret' } })).response.status, 401);
  const drama = { id: 'demo-1', title: '示例短剧', cover: '/posters/one.webp', episodeCount: 80, tags: ['都市'], source: 'demo' };
  const saved = await request('/api/favorites', { method: 'POST', cookie, data: { drama } });
  assert.equal(saved.data.items[0].id, drama.id);
  await request('/api/favorites', { method: 'POST', cookie, data: { drama } });
  assert.equal((await request('/api/favorites', { cookie })).data.items.length, 1);
  const second = await request('/api/auth/register', { method: 'POST', data: { username: 'other-viewer', password: 'another-secret' } });
  assert.deepEqual((await request('/api/favorites', { cookie: second.cookie })).data.items, []);
  await request('/api/history', { method: 'POST', cookie, data: { drama, episodeId: 'ep-3', episodeIndex: 3, position: 12.5 } });
  const history = (await request('/api/history', { cookie })).data.items;
  assert.equal(history[0].episodeIndex, 3);
  assert.equal(history[0].position, 12.5);
  await app.store.flush();
  const persisted = JSON.parse(await readFile(join(dataDirectory, 'accounts.json'), 'utf8'));
  assert.equal(persisted.users[0].favorites[0].id, drama.id);
  assert.equal(persisted.users[0].history[0].episodeId, 'ep-3');
  assert.ok(!JSON.stringify(persisted).includes('correct-secret-123'));
  assert.ok(!JSON.stringify(persisted).includes(cookie.split('=')[1]));
  const denied = await request('/api/favorites', { method: 'POST', cookie, data: { drama }, origin: 'https://untrusted.example' });
  assert.equal(denied.response.status, 403);
  const allowed = await request('/api/auth/me', { cookie, origin: 'http://localhost:5173' });
  assert.equal(allowed.response.headers.get('access-control-allow-credentials'), 'true');
  assert.equal(allowed.data.user.username, '测试观众');
  assert.equal((await request('/api/feed')).response.status, 503);
  assert.equal((await request('/api/feed')).data.error.code, 'ANONYMOUS_LIMITED');
  assert.equal((await request(`/api/media/${'0'.repeat(48)}.mp4`)).response.status, 410);
  await request('/api/favorites/demo-1', { method: 'DELETE', cookie });
  assert.deepEqual((await request('/api/favorites', { cookie })).data.items, []);
  await request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal((await request('/api/auth/me', { cookie })).data.user, null);
  assert.equal((await request('/api/history', { cookie })).response.status, 401);
  const relogin = await request('/api/auth/login', { method: 'POST', data: { username: '测试观众', password: 'correct-secret-123' } });
  assert.equal(relogin.response.status, 200);
  assert.equal((await request('/api/history', { cookie: relogin.cookie })).data.items[0].episodeId, 'ep-3');
  await writeFile(join(dataDirectory, 'index.html'), '<!doctype html><title>Hongguo</title>');
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Hongguo/);
  assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
});

test('encrypted playback only returns an opaque local media capability, never SDK key material', async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'hongguo-media-test-'));
  const key = 'a'.repeat(32);
  const capability = `/api/media/${'b'.repeat(48)}.mp4`;
  const app = await createApp({
    dataDirectory,
    provider: { playback: async (_id, options) => {
      assert.equal(options.quality, 'q_' + 'c'.repeat(20));
      return { protected: true, definition: '720p', selectedQuality: options.quality,
        qualities: [{ id: options.quality, label: '720p', width: 720, height: 1280, definition: '720p' }],
        media: { url: 'https://example.com/video.mp4?signed=private', key } };
    } },
    media: { create: async (input) => { assert.equal(input.key, key); return capability; }, status: () => ({}), close() {} },
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); await new Promise((resolve) => app.server.close(resolve)); await app.store.flush(); await rm(dataDirectory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(`${base}/api/episodes/123/play?quality=q_${'c'.repeat(20)}`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.url, capability);
  assert.equal(result.converted, true);
  assert.equal(result.protected, false);
  assert.equal(result.selectedQuality, 'q_' + 'c'.repeat(20));
  assert.deepEqual(result.qualities, [{ id: 'q_' + 'c'.repeat(20), label: '720p', width: 720, height: 1280, definition: '720p' }]);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(!JSON.stringify(result).includes('signed=private'));
  const invalid = await fetch(`${base}/api/episodes/123/play?quality=https%3A%2F%2Fevil.example%2Fstream.mp4`);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, 'INVALID_QUALITY');
});

test('quality changes select real renditions while sharing one signed model and keeping option IDs stable', async () => {
  let clock = 1_000_000;
  let calls = 0;
  const key = 'd'.repeat(32);
  const provider = createProvider('unused', {}, undefined, {
    now: () => clock,
    createClient: async () => ({ resolvePlayback: async () => {
      calls++;
      return { contentKey: { key }, playback: { protected: true, duration_seconds: 90, expires_at: (clock + 120_000) / 1000,
        streams: [
          { url: `https://example.com/1080.mp4?signed=${calls}`, definition: '1080p', codec: 'bytevc1', width: 1080, height: 1920, bitrate: calls * 4000 },
          { url: `https://example.com/720.mp4?signed=${calls}`, definition: '720p', codec: 'bytevc1', width: 720, height: 1280 },
          { url: `https://example.com/480.mp4?signed=${calls}`, definition: '480p', codec: 'bytevc1', width: 480, height: 854 },
        ] } };
    } }),
  });
  const initial = await provider.playback('quality-episode');
  assert.equal(initial.definition, '720p');
  assert.equal(initial.qualities.length, 3);
  assert.deepEqual(initial.qualities.map(option => option.label), ['1080p', '720p', '480p']);
  assert.equal(initial.selectedQuality, initial.qualities[1].id);
  assert.ok(initial.qualities.every(option => /^q_[a-f0-9]{20}$/.test(option.id)));
  assert.ok(!JSON.stringify(initial.qualities).includes('signed='));
  assert.ok(!JSON.stringify(initial.qualities).includes(key));
  const full = await provider.playback('quality-episode', { quality: initial.qualities[0].id });
  assert.equal(full.selectedQuality, initial.qualities[0].id);
  assert.match(full.media.url, /\/1080\.mp4\?/);
  assert.equal(full.media.maxWidth, 1080);
  assert.equal(full.media.maxHeight, 1920);
  assert.equal(full.media.transcode, true);
  const smaller = await provider.playback('quality-episode', { quality: initial.qualities[2].id });
  assert.match(smaller.media.url, /\/480\.mp4\?/);
  assert.equal(calls, 1);
  await assert.rejects(provider.playback('quality-episode', { quality: 'q_' + '0'.repeat(20) }), { code: 'INVALID_QUALITY', status: 422 });
  await assert.rejects(provider.playback('quality-episode', { quality: 'https://evil.example/video.mp4' }), { code: 'INVALID_QUALITY', status: 400 });
  assert.equal(calls, 1);
  clock += 121_000;
  const refreshed = await provider.playback('quality-episode', { quality: initial.qualities[0].id });
  assert.equal(calls, 2);
  assert.match(refreshed.media.url, /signed=2$/);
  assert.deepEqual(refreshed.qualities.map(option => option.id), initial.qualities.map(option => option.id));
});

test('playback offsets validate before resolving, clamp to the model duration, and leave direct AVC seeking to the browser', async (t) => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'hongguo-offset-test-'));
  const capability = `/api/media/${'e'.repeat(48)}.mp4`;
  const converted = [];
  let resolutions = 0;
  const app = await createApp({
    dataDirectory,
    provider: { playback: async (id) => {
      resolutions++;
      return id === 'direct' ? { url: 'https://example.com/direct-avc.mp4', codec: 'h264', duration: 10 }
        : { protected: true, codec: 'h264', duration: 10, media: { url: 'https://example.com/encrypted.mp4', key: 'f'.repeat(32), codec: 'h264', transcode: false } };
    } },
    media: { create: async (input) => { converted.push(input); return capability; }, status: () => ({}), close() {} },
  });
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { app.server.closeAllConnections(); await new Promise((resolve) => app.server.close(resolve)); await app.store.flush(); await rm(dataDirectory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  for (const input of ['', '-1', 'NaN', 'Infinity', '86400.01', 'not-a-time']) {
    const response = await fetch(`${base}/api/episodes/converted/play?start=${encodeURIComponent(input)}`);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'INVALID_START');
  }
  assert.equal(resolutions, 0);
  const resumed = await (await fetch(`${base}/api/episodes/converted/play?start=2.75`)).json();
  assert.equal(resumed.timeOffset, 2.75);
  assert.equal(resumed.transcoded, true);
  assert.equal(resumed.codec, 'h264');
  assert.equal(converted[0].start, 2.75);
  assert.equal(converted[0].transcode, true);
  const clipped = await (await fetch(`${base}/api/episodes/converted/play?start=86400`)).json();
  assert.equal(clipped.timeOffset, 9.9);
  assert.equal(converted[1].start, 9.9);
  const beginning = await (await fetch(`${base}/api/episodes/converted/play`)).json();
  assert.equal(beginning.timeOffset, 0);
  assert.equal(converted[2].start, 0);
  assert.equal(converted[2].transcode, false);
  const direct = await (await fetch(`${base}/api/episodes/direct/play?start=2.75`)).json();
  assert.equal(direct.timeOffset, 0);
  assert.equal(direct.url, 'https://example.com/direct-avc.mp4');
  assert.equal(converted.length, 3);
});

test('provider normalization preserves SDK snake_case fields without exposing raw data', () => {
  const result = normalizeDrama({ id: '123', title: '短剧', cover_url: 'https://example.com/poster.jpg', episode_count: 60, abstract: '剧情介绍', play_count: 1200, tags: ['都市', { name: '爱情' }], secret: 'excluded' });
  assert.equal(result.episodeCount, 60);
  assert.equal(result.cover, 'https://example.com/poster.jpg');
  assert.equal(result.description, '剧情介绍');
  assert.deepEqual(result.tags, ['都市', '爱情']);
  assert.equal(result.source, 'hongguo');
  assert.equal(result.secret, undefined);
  assert.equal(normalizeDrama({ id: '123', title: 'Unknown count', total: 1000 }).episodeCount, 0);
  assert.equal(normalizeDrama({ id: '123', pay_type: 0 }).payType, 0);
  assert.equal(normalizeDrama({ id: '123', pay_type: 1, content_type: 1004 }).contentType, 1004);
  assert.equal('payType' in normalizeDrama({ id: '123' }), false);
});

test('anonymous playback resets are bounded, playback-only, and serialized between episodes', async () => {
  const resolve = createPlaybackResolver();
  const events = [];
  let rejected = false;
  const sdk = {
    async resolvePlayback(id) {
      events.push(`play:${id}`);
      if (!rejected) { rejected = true; throw Object.assign(new Error(), { code: 'ANONYMOUS_LIMITED' }); }
      return { id };
    },
    async resetDevice() { events.push('reset'); },
  };
  const results = await Promise.all([resolve(sdk, 'A'), resolve(sdk, 'B')]);
  assert.deepEqual(results, [{ id: 'A' }, { id: 'B' }]);
  assert.deepEqual(events, ['play:A', 'reset', 'play:A', 'play:B']);
  let resets = 0;
  let attempts = 0;
  const limited = { resolvePlayback: async () => { attempts++; throw Object.assign(new Error(), { code: 'ANONYMOUS_LIMITED' }); }, resetDevice: async () => { resets++; } };
  await assert.rejects(resolve(limited, 'C'), { code: 'ANONYMOUS_LIMITED' });
  assert.equal(attempts, 3);
  assert.equal(resets, 2);
  const unauthorized = { resolvePlayback: async () => { throw Object.assign(new Error(), { code: 'AUTHENTICATION_REQUIRED' }); }, resetDevice: async () => { assert.fail('Other errors must never reset devices'); } };
  await assert.rejects(resolve(unauthorized, 'D'), { code: 'AUTHENTICATION_REQUIRED' });
});

test('empty human discovery falls back to a real human ranking with an isolated ranking cursor', async () => {
  const requests = [];
  const sdk = {
    discover: async (options) => { requests.push(['discover', options]); throw Object.assign(new Error(), { code: 'ANONYMOUS_LIMITED' }); },
    shortRank: async (options) => {
      requests.push(['ranking', options]);
      return { items: [{ series_id: options.cursor ? '2' : '1', title: '真实短剧' }], has_more: !options.cursor, cursor: options.cursor ? '' : 'upstream-next', board: 'human_hot_sc' };
    },
    search: async (_query, options) => { requests.push(['search', options]); return { items: [], has_more: false }; },
    resetDevice: async () => assert.fail('A catalogue read must not rotate devices'),
  };
  const provider = createProvider('unused', {}, undefined, { createClient: async () => sdk });
  const first = await provider.feed();
  assert.equal(first.catalogMode, 'ranking');
  assert.equal(first.items[0].source, 'hongguo');
  assert.match(first.cursor, /^rank\./);
  const next = await provider.feed({ cursor: first.cursor });
  assert.equal(next.items[0].id, '2');
  assert.equal(next.hasMore, false);
  assert.equal(next.cursor, '');
  assert.deepEqual(requests.slice(0, 3), [
    ['discover', { channel: '真人剧', cursor: '' }],
    ['ranking', { content: 'human' }],
    ['ranking', { content: 'human', board: 'human_hot_sc', cursor: 'upstream-next' }],
  ]);
  await provider.search('测试');
  assert.equal('filters' in requests.at(-1)[1], false);
  await assert.rejects(provider.feed({ cursor: 'rank.invalid' }), { code: 'INVALID_CURSOR' });
  for (const code of ['RATE_LIMITED', 'AUTHENTICATION_REQUIRED', 'CHALLENGE_REQUIRED']) {
    const restricted = createProvider('unused', {}, undefined, { createClient: async () => ({
      discover: async () => { throw Object.assign(new Error(), { code }); },
      shortRank: async () => assert.fail('Access or rate restrictions must not use fallback requests'),
    }) });
    await assert.rejects(restricted.feed(), { code });
  }
});

test('successful playback models remain cached until their real expiry instead of expiring after 30 seconds', async () => {
  let clock = 1_000_000;
  let calls = 0;
  const provider = createProvider('unused', {}, undefined, {
    now: () => clock,
    createClient: async () => ({ resolvePlayback: async () => {
      calls++;
      return { playback: { expires_at: (clock + 120_000) / 1000, streams: [{ url: 'https://example.com/stream.mp4', codec: 'h264' }] } };
    } }),
  });
  await provider.playback('episode');
  clock += 31_000;
  await provider.playback('episode');
  assert.equal(calls, 1);
  clock += 90_000;
  await provider.playback('episode');
  assert.equal(calls, 2);
});

test('the real HTTP Retry-After window is preserved and prevents repeated catalogue calls', async (t) => {
  let calls = 0;
  let clock = 1_000_000;
  const server = createServer((_req, res) => { calls++; res.writeHead(429, { 'Retry-After': '2' }); res.end(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const provider = createProvider('unused', {}, undefined, {
    now: () => clock,
    createClient: async ({ transport }) => ({ search: async () => {
      const response = await transport({ method: 'GET', url: `http://127.0.0.1:${server.address().port}/catalog`, headers: {}, body: new Uint8Array() });
      assert.equal(response.status, 429);
      throw Object.assign(new Error(), { code: 'RATE_LIMITED', retryAfterMs: 0 });
    } }),
  });
  await assert.rejects(provider.search('query'), (error) => error.code === 'RATE_LIMITED' && error.retryAfterMs === 2000);
  await assert.rejects(provider.search('query'), { code: 'RATE_LIMITED' });
  assert.equal(calls, 1);
  clock += 2001;
  await assert.rejects(provider.search('query'), { code: 'RATE_LIMITED' });
  assert.equal(calls, 2);
});

test('playback deadlines abort sockets and cancelled queued episodes never consume a playback model', async (t) => {
  let calls = 0;
  let socketAborted = false;
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  const server = createServer((req, res) => {
    started();
    req.once('aborted', () => { socketAborted = true; });
    const timer = setTimeout(() => res.end('unused'), 1000);
    res.once('close', () => clearTimeout(timer));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const provider = createProvider('unused', {}, undefined, {
    timeouts: { play: 60 },
    createClient: async ({ transport }) => ({ resolvePlayback: async () => {
      calls++;
      await transport({ method: 'GET', url: `http://127.0.0.1:${server.address().port}/play`, headers: {}, body: new Uint8Array() });
      throw new Error('The request should already have been aborted');
    } }),
  });
  const first = assert.rejects(provider.playback('first'), { code: 'TIMEOUT' });
  await requestStarted;
  const controller = new AbortController();
  const queued = assert.rejects(provider.playback('queued', { signal: controller.signal }), { code: 'REQUEST_ABORTED' });
  controller.abort();
  await Promise.all([first, queued]);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(socketAborted, true);
});

test('cancelling one coalesced playback caller does not abort another active viewer', async (t) => {
  let calls = 0;
  let started;
  const requestStarted = new Promise((resolve) => { started = resolve; });
  const server = createServer((_req, res) => { started(); setTimeout(() => res.end('ok'), 30); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const provider = createProvider('unused', {}, undefined, {
    createClient: async ({ transport }) => ({ resolvePlayback: async () => {
      calls++;
      await transport({ method: 'GET', url: `http://127.0.0.1:${server.address().port}/play`, headers: {}, body: new Uint8Array() });
      return { playback: { streams: [{ url: 'https://example.com/stream.mp4', codec: 'h264' }] } };
    } }),
  });
  const controller = new AbortController();
  const first = assert.rejects(provider.playback('shared', { signal: controller.signal }), { code: 'REQUEST_ABORTED' });
  const second = provider.playback('shared');
  await requestStarted;
  controller.abort();
  await first;
  assert.equal((await second).protected, false);
  assert.equal(calls, 1);
});

test('episode availability is preserved without inventing access status for missing metadata', async () => {
  const provider = createProvider('unused', {}, undefined, { createClient: async () => ({
    getSeries: async () => ({ id: 'series', title: '短剧', content_type: 1004 }),
    listEpisodes: async () => ({ items: [{ id: 'one', number: 1, playable: true }, { id: 'two', number: 2, playable: false }, { id: 'three', number: 3 }], has_more: false }),
  }) });
  const result = await provider.details('series');
  assert.equal(result.episodes[0].playable, true);
  assert.equal(result.episodes[1].playable, false);
  assert.equal('playable' in result.episodes[2], false);
  assert.equal('payType' in result.drama, false);
  assert.equal(result.drama.contentType, 1004);
});

test('HEVC and unknown streams take the compatibility path while an available AVC stream is preferred', async () => {
  const playback = async (streams, protectedVideo = false) => {
    const provider = createProvider('unused', {}, undefined, { createClient: async () => ({ resolvePlayback: async () => ({
      playback: { streams, protected: protectedVideo }, ...(protectedVideo ? { contentKey: { key: 'a'.repeat(32) } } : {}),
    }) }) });
    return provider.playback('episode');
  };
  const hevc = await playback([{ url: 'https://example.com/720.mp4', codec: 'bytevc1', definition: '720p' }]);
  assert.equal(hevc.protected, false);
  assert.equal(hevc.media.transcode, true);
  assert.equal(hevc.media.codec, 'bytevc1');
  assert.equal('key' in hevc.media, false);
  const unknown = await playback([{ url: 'https://example.com/unknown.mp4' }], true);
  assert.equal(unknown.media.transcode, true);
  assert.equal(unknown.media.key, 'a'.repeat(32));
  const avc = await playback([
    { url: 'https://example.com/hevc.mp4', codec: 'bytevc1', definition: '1080p' },
    { url: 'https://example.com/avc.mp4', codec: 'h264', definition: '480p' },
  ]);
  assert.equal(avc.url, 'https://example.com/avc.mp4');
  assert.equal('media' in avc, false);
});

test('search includes comic results and resolves only validated official share links by series ID', async () => {
  const calls = [];
  const provider = createProvider('unused', {}, undefined, { createClient: async () => ({
    getSeries: async (id) => { calls.push(['series', id]); return { id, title: '用户分享的漫剧', content_type: 1004 }; },
    search: async (query, options) => { calls.push(['search', query, options]); return { items: [{ id: '100', title: '综合搜索结果' }], has_more: false }; },
  }) });
  const first = await provider.search('https://hongguoduanju.com/player/7697622096326708286?from=share');
  assert.equal(first.items[0].id, '7697622096326708286');
  assert.equal(first.items[0].contentType, 1004);
  assert.equal(first.hasMore, false);
  const second = await provider.search('https://novelquickapp.com/player/123456/987654');
  assert.equal(second.items[0].id, '123456');
  assert.deepEqual(calls, [['series', '7697622096326708286'], ['series', '123456']]);
  await provider.search('漫剧关键词');
  assert.deepEqual(calls.at(-1), ['search', '漫剧关键词', { cursor: '', pageSize: 24 }]);
  await provider.search('123456');
  assert.deepEqual(calls.at(-1), ['search', '123456', { cursor: '', pageSize: 24 }]);
  const before = calls.length;
  for (const link of [
    'https://evil.example/player/123',
    'https://hongguoduanju.com.evil.example/player/123',
    'http://hongguoduanju.com/player/123',
    'https://user:password@hongguoduanju.com/player/123',
    'https://hongguoduanju.com:8443/player/123',
    'https://hongguoduanju.com/player/not-a-number',
    'https://novelquickapp.com/player/123/not-a-number',
  ]) assert.throws(() => provider.search(link), { code: 'INVALID_SHARE_URL' });
  assert.equal(calls.length, before);
});
