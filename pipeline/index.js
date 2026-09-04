import { config } from './config.js';
import * as detector from './detector.js';
import { parseFilename } from './parser.js';
import { resolveAnime } from './anilist.js';
import { initDb, insertEpisode, saveDb, getEpisode } from './db.js';
import { makeOutputDir, transcode } from './transcoder.js';
import { upload } from './uploader.js';

export class Pipeline {
  constructor(opts = {}) {
    this.opts = opts;
    this.seen = new Set();
    this.running = false;
    this.timer = null;
    this.status = {
      startedAt: null,
      lastTick: null,
      processed: 0,
      failed: 0,
      lastItem: null,
      lastError: null,
    };
    // injectable dependencies (default to the real implementations)
    this.fetchFeed = opts.fetchFeed || detector.fetchFeed;
    this.transcodeFn = opts.transcodeFn || transcode;
    this.anilistResolver = opts.anilistResolver || resolveAnime;
    this.downloader = opts.downloader || null;
  }

  async init() {
    await initDb();
    if (this.opts.feedUrl) config.rss.url = this.opts.feedUrl;
    if (this.opts.intervalMs != null) config.rss.pollIntervalMs = this.opts.intervalMs;
  }

  getFeedUrl() {
    return config.rss.url;
  }

  async start() {
    if (!this.running) {
      this.running = true;
      this.status.startedAt = new Date().toISOString();
      this.status.lastError = null;
      await this.tick();
      this.timer = setInterval(() => this.tick(), config.rss.pollIntervalMs);
    }
    return this.status;
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.status;
  }

  async tick() {
    this.status.lastTick = new Date().toISOString();
    try {
      const items = await this.fetchFeed();
      const trusted = detector.filterTrusted(items);
      const novel = trusted.filter((it) => it.guid && !this.seen.has(it.guid));
      for (const item of novel) {
        this.seen.add(item.guid);
        try {
          const res = await this.processItem(item);
          this.status.processed++;
          this.status.lastItem = item.title;
        } catch (e) {
          this.status.failed++;
          this.status.lastError = `${item.title}: ${e.message}`;
          console.error('[pipeline] processItem failed:', e);
        }
      }
    } catch (e) {
      this.status.lastError = e.message;
      console.error('[pipeline] tick failed:', e);
    }
  }

  async processItem(item) {
    if (this.opts.onItem) await this.opts.onItem(item);

    const parsed = parseFilename(item.title);
    if (!parsed.title) throw new Error(`could not parse title from "${item.title}"`);

    const anime = await this.anilistResolver(parsed.title);
    const malId = anime ? anime.malId : null;
    if (!malId) throw new Error(`AniList could not resolve "${parsed.title}"`);

    if (getEpisode(malId, parsed.episode, parsed.version)) {
      return { status: 'exists', malId, episode: parsed.episode };
    }

    const inputPath = await this.download(item, parsed);
    if (!inputPath) throw new Error('no input path returned from downloader');

    const outDir = makeOutputDir(malId, parsed.episode);
    const produced = await this.transcodeFn(inputPath, outDir);
    const outDirResolved = produced.outDir || outDir;

    const streamUrl = await upload(outDirResolved, this.opts.upload);

    const id = insertEpisode({
      animeId: parseInt(malId, 10),
      anilistId: anime.anilistId,
      episode: parsed.episode,
      version: parsed.version,
      title: anime.title?.romaji || anime.title?.english || parsed.title,
      streamUrl,
      resolution: parsed.resolution,
      codecs: parsed.codecs,
      groupName: parsed.group,
    });

    return { status: 'ok', id, streamUrl, animeId: malId, episode: parsed.episode };
  }

  async download(item, parsed) {
    if (typeof this.downloader === 'function') return this.downloader(item, parsed);
    if (typeof this.opts.downloadPath === 'function') return this.opts.downloadPath(item, parsed);
    const msg = `No downloader configured. Set opts.downloader(fn) or DOWNLOAD_HOOK. ` +
      `Got item "${item.title}" link "${item.link}".`;
    throw new Error(msg);
  }

  getStatus() {
    return { ...this.status, running: this.running, seen: this.seen.size, feedUrl: config.rss.url };
  }
}

export async function createPipeline(opts = {}) {
  const p = new Pipeline(opts);
  await p.init();
  return p;
}

