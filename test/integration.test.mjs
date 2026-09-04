import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const TEST_DB = path.join(process.cwd(), 'data-test', 'pipeline.db');
fs.rmSync(path.dirname(TEST_DB), { recursive: true, force: true });
process.env.DB_FILE = TEST_DB;
process.env.TRUSTED_GROUPS = 'subsplease,erai,mtbb,chibiki,deadfish';
process.env.HLS_OUTPUT_DIR = path.join(process.cwd(), 'data-test', 'hls');
process.env.CDN_LOCAL_ROOT = path.join(process.cwd(), 'data-test', 'cdn');
process.env.CDN_BASE_URL = 'https://cdn.test.host/anime';

const { createPipeline } = await import('../pipeline/index.js');
const { getEpisode, listEpisodes } = await import('../pipeline/db.js');

const FEED_ITEMS = [
  {
    title: '[DeadFish] Bleach - 366 [720p][AAC].mp4',
    link: 'magnet:?xt=urn:btih:deadfish366',
    guid: 'urn:btih:deadfish366',
  },
  {
    title: 'SubsPlease [Naruto Shippuden] - 001 [1080p][HEVC].mkv',
    link: 'magnet:?xt=urn:btih:subsplease001',
    guid: 'urn:btih:subsplease001',
  },
  {
    title: 'Erai - Naruto Shippuden - 001 [1080p].mkv',
    link: 'magnet:?xt=urn:btih:erai001',
    guid: 'urn:btih:erai001',
  },
];

let feedCalls = 0;
const fetchFeed = async () => {
  feedCalls++;
  return FEED_ITEMS;
};

const TITLE_TO_ANIME = {
  'Bleach': { anilistId: 30, malId: 30, title: { romaji: 'Bleach' } },
  'Naruto Shippuden': { anilistId: 12345, malId: 16497, title: { romaji: 'Naruto: Shippuden' } },
};
const anilistResolver = async (title) => TITLE_TO_ANIME[title];

const downloader = async (item) => {
  const tmp = path.join(process.cwd(), 'data-test', 'downloads', crypto.randomBytes(4).toString('hex') + '.mkv');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.writeFileSync(tmp, 'fake-mkv-stream');
  return tmp;
};

const transcodeFn = async (inputPath, outDir) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.m3u8'), '#EXTM3U\n#EXTINF:6.0,\nseg_000.ts\n');
  fs.writeFileSync(path.join(outDir, 'seg_000.ts'), 'fake-ts-segment');
  return { outDir, indexM3u8: path.join(outDir, 'index.m3u8') };
};

const p = await createPipeline({
  feedUrl: 'https://example.test/fake-rss',
  intervalMs: 60000,
  fetchFeed,
  downloader,
  transcodeFn,
  anilistResolver,
  upload: { strategy: 'local' },
});

process.stdout.write('[test] running first tick...\n');
await p.tick();

assert.equal(p.status.processed, 3, 'first tick should process all 3 (Bleach, Naruto001, Naruto001 dup)');
process.stdout.write('[test] processed=' + p.status.processed + ' failed=' + p.status.failed + '\n');

const row1 = getEpisode(16497, 1, 1);
assert.ok(row1, 'expected Naruto ep 1 v1 to be stored');
assert.equal(row1.anime_id, 16497);
assert.equal(row1.episode, 1);
assert.equal(row1.group_name, 'SubsPlease');
assert.equal(row1.resolution, '1080p');
assert.deepEqual(row1.codecs, ['hevc']);
assert.ok(row1.stream_url.endsWith('/index.m3u8'), row1.stream_url);
process.stdout.write('[test] naruto ep1 stored: ' + row1.stream_url + '\n');

const rowBleach = getEpisode(30, 366, 1);
assert.ok(rowBleach, 'expected Bleach ep 366 to be stored');
assert.equal(rowBleach.anime_id, 30);
assert.equal(rowBleach.group_name, 'DeadFish');
assert.equal(rowBleach.episode, 366);
assert.equal(rowBleach.resolution, '720p');
process.stdout.write('[test] bleach 366 stored: ' + rowBleach.stream_url + '\n');

assert.equal(listEpisodes(16497).length, 1, 'first-seen wins for Naruto ep1');

process.stdout.write('[test] running second tick (dedup)...\n');
await p.tick();
assert.equal(p.status.processed, 3, 'second tick should process nothing new (seen)');
assert.equal(feedCalls, 2);

FEED_ITEMS.push({
  title: 'SubsPlease [Naruto Shippuden] - 002 [1080p][HEVC].mkv',
  link: 'magnet:?xt=urn:btih:subsplease002',
  guid: 'urn:btih:subsplease002',
});
process.stdout.write('[test] running third tick with new episode 2...\n');
await p.tick();
assert.equal(p.status.processed, 4, 'third tick should process the new episode 2');
const rowEp2 = getEpisode(16497, 2, 1);
assert.ok(rowEp2, 'expected episode 2 to be stored');
assert.equal(rowEp2.group_name, 'SubsPlease');
assert.deepEqual(rowEp2.codecs, ['hevc']);
process.stdout.write('[test] episode 2 stored: ' + rowEp2.stream_url + '\n');

process.stdout.write('[test] ALL INTEGRATION TESTS PASSED\n');
process.exit(0);
