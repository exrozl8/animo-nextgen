import express from 'express';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import http from 'http';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static('public'));
import { config } from './pipeline/config.js';
import { initDb, getEpisode, listEpisodes } from './pipeline/db.js';
app.use('/hls', express.static(config.upload.localRoot));
let dbReady = initDb().catch((e) => console.error('db init failed:', e));

async function ensureDb() {
  try { await dbReady; } catch {}
  return dbReady;
}

let pipelineRunner = null;
if (config.processing.autostart) {
  dbReady.then(() => import('./pipeline/index.js')).then((m) => {
    m.createPipeline().then((p) => { pipelineRunner = p; }).catch((e) => console.error('pipeline init failed:', e));
  });
}

const ANILIST = 'https://graphql.anilist.co';
const JIKAN   = 'https://api.jikan.moe/v4';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
};

// ─── AniList GraphQL ──────────────────────────────────────────────────────────
async function gql(query, variables = {}) {
  const res = await fetch(ANILIST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data;
}

const MEDIA_FIELDS = `
  id idMal
  title { romaji english native }
  coverImage { extraLarge large }
  bannerImage
  episodes status averageScore popularity
  genres description(asHtml:false)
  season seasonYear format
  studios(isMain:true){ nodes{ name } }
  nextAiringEpisode { episode airingAt }
`;

// ─── 1. Home / Trending ───────────────────────────────────────────────────────
app.get('/api/home', async (req, res) => {
  const Q = `query {
    trending: Page(page:1,perPage:20){ media(type:ANIME,sort:TRENDING_DESC,isAdult:false){ ${MEDIA_FIELDS} } }
    popular:  Page(page:1,perPage:20){ media(type:ANIME,sort:POPULARITY_DESC,isAdult:false){ ${MEDIA_FIELDS} } }
    top:      Page(page:1,perPage:20){ media(type:ANIME,sort:SCORE_DESC,isAdult:false){ ${MEDIA_FIELDS} } }
  }`;
  try {
    const d = await gql(Q);
    res.json({
      trending:  d.trending.media,
      popular:   d.popular.media,
      top:       d.top.media,
    });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── 2. Seasonal ─────────────────────────────────────────────────────────────
app.get('/api/seasonal', async (req, res) => {
  const now = new Date();
  const m = now.getMonth() + 1;
  const seasons = ['WINTER','SPRING','SUMMER','FALL'];
  const season = seasons[Math.floor((m - 1) / 3)];
  const year = now.getFullYear();
  const Q = `query($s:MediaSeason,$y:Int){
    Page(page:1,perPage:20){ media(type:ANIME,season:$s,seasonYear:$y,sort:POPULARITY_DESC,isAdult:false){ ${MEDIA_FIELDS} } }
  }`;
  try {
    const d = await gql(Q, { s: season, y: year });
    res.json({ media: d.Page.media, season, year });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── 3. Search ────────────────────────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const { q, genre, page = 1 } = req.query;
  let filter = 'sort:SEARCH_MATCH';
  if (genre) filter = 'sort:POPULARITY_DESC';
  const Q = `query($q:String,$genre:String,$page:Int){
    Page(page:$page,perPage:24){
      pageInfo{ total currentPage lastPage hasNextPage }
      media(search:$q,genre:$genre,type:ANIME,isAdult:false,${filter}){ ${MEDIA_FIELDS} }
    }
  }`;
  try {
    const d = await gql(Q, { q: q || null, genre: genre || null, page: +page });
    res.json(d.Page);
  } catch (e) {
    // fallback jikan
    try {
      const jr = await fetch(`${JIKAN}/anime?q=${encodeURIComponent(q||'')}&sfw&limit=20`);
      const jd = await jr.json();
      res.json({ media: mapJikan(jd.data || []), pageInfo: {} });
    } catch { res.status(502).json({ error: e.message }); }
  }
});

function mapJikan(arr) {
  return arr.map(a => ({
    id: null, idMal: a.mal_id,
    title: { romaji: a.title, english: a.title_english, native: a.title_japanese },
    coverImage: { extraLarge: a.images?.jpg?.large_image_url, large: a.images?.jpg?.image_url },
    bannerImage: a.trailer?.images?.maximum_image_url || null,
    episodes: a.episodes || 0, status: a.status,
    averageScore: a.score ? Math.round(a.score * 10) : null,
    popularity: a.members,
    genres: (a.genres || []).map(g => g.name),
    description: a.synopsis || '', season: a.season, seasonYear: a.year,
    format: a.type, studios: { nodes: [] }, nextAiringEpisode: null,
  }));
}

// ─── 4. Anime detail ──────────────────────────────────────────────────────────
app.get('/api/anime/:id', async (req, res) => {
  const Q = `query($id:Int){
    Media(id:$id,type:ANIME){
      ${MEDIA_FIELDS}
      trailer{ id site }
      recommendations(sort:RATING_DESC){ nodes{ mediaRecommendation{ id title{ romaji english } coverImage{ large } } } }
    }
  }`;
  try {
    const d = await gql(Q, { id: +req.params.id });
    res.json(d.Media);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── 5. Airing schedule (for notifications) ───────────────────────────────────
app.get('/api/schedule', async (req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const week = now + 7 * 86400;
  const Q = `query($from:Int,$to:Int){
    Page(page:1,perPage:50){
      airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){
        id episode airingAt
        media{ id idMal title{ romaji english } coverImage{ large } }
      }
    }
  }`;
  try {
    const d = await gql(Q, { from: now, to: week });
    res.json({ schedule: d.Page.airingSchedules });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── 6. News (AniList activity feed as news) ─────────────────────────────────
app.get('/api/news', async (req, res) => {
  // Use recently released & airing anime as "news"
  const Q = `query{
    Page(page:1,perPage:10){
      media(type:ANIME,status:RELEASING,sort:UPDATED_AT_DESC,isAdult:false){
        id idMal title{ romaji english }
        coverImage{ large }
        nextAiringEpisode{ episode airingAt }
        averageScore episodes seasonYear
        description(asHtml:false)
      }
    }
  }`;
  try {
    const d = await gql(Q);
    res.json({ news: d.Page.media });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── 7. Episodes list (from Jikan) ───────────────────────────────────────────
app.get('/api/episodes/:mal_id', async (req, res) => {
  try {
    const resp = await fetch(`${JIKAN}/anime/${req.params.mal_id}/episodes?page=1`, {
      headers: { 'User-Agent': 'animo/1.0' }
    });
    const data = await resp.json();
    res.json(data);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// ─── 7b. Ad Configuration ───────────────────────────────────────────────────
app.get('/api/ads/config', (req, res) => {
  res.json({
    popunder: {
      enabled: process.env.AD_POPUNDER_ENABLED !== 'false',
      url: process.env.AD_POPUNDER_URL || '',
      intervalMinutes: parseInt(process.env.AD_POPUNDER_INTERVAL_MIN || '30', 10),
    },
    socialBar: {
      enabled: process.env.AD_SOCIALBAR_ENABLED === 'true',
      scriptUrl: process.env.AD_SOCIALBAR_SCRIPT || '',
    },
    banners: {
      playerBottom: {
        enabled: process.env.AD_BANNER_BOTTOM_ENABLED !== 'false',
        html: process.env.AD_BANNER_BOTTOM_HTML || '',
      },
      sidebar: {
        enabled: process.env.AD_BANNER_SIDEBAR_ENABLED !== 'false',
        html: process.env.AD_BANNER_SIDEBAR_HTML || '',
      },
    },
  });
});

// ─── 8. Stream sources ────────────────────────────────────────────────────────
// All providers go through /api/embed-proxy which strips X-Frame-Options headers
// ─── 8. Stream sources ────────────────────────────────────────────────────────
const streamCache = new Map();

async function resolveAnilistId(mId) {
  if (!mId) return null;
  try {
    const data = await gql(`query($mId:Int){ Media(idMal:$mId,type:ANIME){ id } }`, { mId });
    return data?.Media?.id || null;
  } catch {
    return null;
  }
}

async function fetchProviderStreams(anilistId, epNum, mode) {
  const providers = ['anikoto', 'anineko', 'animegg'];
  const fetchPromises = providers.map(async (provider) => {
    try {
      const url = `https://anivexa-api-nine.vercel.app/watch/${provider}/${anilistId}/${mode}/${provider}-${epNum}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) return null;

      const data = await res.json();
      const streamList = data.streams || (mode === 'dub' ? data.sdub?.streams : data.ssub?.streams) || [];
      const subtitleList = data.subtitles || (mode === 'dub' ? data.sdub?.subtitles : data.ssub?.subtitles) || [];
      if (Array.isArray(streamList) && streamList.length > 0) {
        return { provider, streams: streamList, subtitles: subtitleList };
      }
    } catch {}
    return null;
  });

  const results = await Promise.allSettled(fetchPromises);
  const successful = results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value);

  return successful;
}

app.get('/api/stream', async (req, res) => {
  const { mal_id, anilist_id, ep, mode, title } = req.query;
  const epNum = parseInt(ep, 10) || 1;
  const audioMode = (mode === 'dub') ? 'dub' : 'sub';
  const mId = parseInt(mal_id, 10) || null;
  let aId = parseInt(anilist_id, 10) || null;

  if (!aId && mId) {
    aId = await resolveAnilistId(mId);
  }

  const cacheKey = `${aId || mId}_${epNum}_${audioMode}`;
  if (streamCache.has(cacheKey)) {
    const cached = streamCache.get(cacheKey);
    if (Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return res.json(cached.data);
    }
  }

  const sources = [];
  const subtitles = [];
  const seenUrls = new Set();
  const makeProxy = (rawUrl) => `/api/embed-proxy?url=${encodeURIComponent(rawUrl)}`;

  // 1. Direct Embed Servers (Instant, Zero Server Bandwidth, 100% Ban-Proof)
  if (aId) {
    sources.push({
      name: 'VidSrc HD',
      provider: 'vidsrc',
      type: 'embed',
      url: makeProxy(`https://vidsrc.pm/embed/anime?anilist=${aId}&episode=${epNum}`),
      directUrl: `https://vidsrc.pm/embed/anime?anilist=${aId}&episode=${epNum}`
    });
    sources.push({
      name: '2Embed Prime',
      provider: '2embed',
      type: 'embed',
      url: makeProxy(`https://2embed.cc/embed/anime/${aId}/${epNum}`),
      directUrl: `https://2embed.cc/embed/anime/${aId}/${epNum}`
    });
  }
  if (mId) {
    sources.push({
      name: 'VidSrc (MAL)',
      provider: 'vidsrc-mal',
      type: 'embed',
      url: makeProxy(`https://vidsrc.pm/embed/anime?mal=${mId}&episode=${epNum}`),
      directUrl: `https://vidsrc.pm/embed/anime?mal=${mId}&episode=${epNum}`
    });
  }

  // 2. Fetch HLS streams as secondary direct options
  if (aId) {
    try {
      const providerResults = await fetchProviderStreams(aId, epNum, audioMode);
      for (const resItem of providerResults) {
        for (const s of (resItem.streams || [])) {
          if (!s.url || seenUrls.has(s.url)) continue;
          if (s.server && s.server.toLowerCase().includes('vidwish')) continue;
          seenUrls.add(s.url);
          let baseName = s.server || resItem.provider.toUpperCase();
          sources.push({
            name: `${baseName} (Stream)`,
            provider: resItem.provider,
            type: s.type || 'hls',
            url: s.url,
            proxy: false,
            referer: s.referer || s.url
          });
        }
      }
    } catch {}
  }

  if (sources.length === 0) {
    return res.status(404).json({ error: 'No stream sources found.' });
  }

  const responsePayload = { sources, episode: epNum, mode: audioMode, subtitles };
  streamCache.set(cacheKey, { timestamp: Date.now(), data: responsePayload });
  res.json(responsePayload);
});

// ─── 9. Embed Proxy — THE MAGIC ───────────────────────────────────────────────
// Fetches embed pages server-side and strips X-Frame-Options / CSP headers
// and neutralizes popups / redirects so they can render safely in <iframe>.
app.get('/api/embed-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send('url required');

  const target = decodeURIComponent(url);
  let originBase;
  try { originBase = new URL(target).origin; } catch { return res.status(400).send('invalid url'); }

  try {
    const upstream = await fetch(target, {
      headers: {
        ...BROWSER_HEADERS,
        'Referer': originBase + '/',
        'Origin': originBase,
      },
      redirect: 'follow',
    });

    const ct = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
    const bodyBuf = await upstream.arrayBuffer();
    const bodyText = new TextDecoder('utf-8').decode(bodyBuf);

    // ── Strip ALL iframe-blocking headers ──
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval' data: blob: mediastream:; frame-ancestors *;");

    // Rewrite relative URLs to absolute so assets load correctly
    let rewritten = bodyText
      .replace(/(src|href|action)=(['"])\//gi, `$1=$2${originBase}/`)
      .replace(/url\(\//gi, `url(${originBase}/`);

    // Neutralize popup scripts and redirect hijackers
    const antiAdScript = `<script>
      window.open = function() { return null; };
      window.alert = function() {};
      window.confirm = function() { return true; };
    </script>`;

    if (rewritten.includes('<head>')) {
      rewritten = rewritten.replace('<head>', '<head>' + antiAdScript);
    } else {
      rewritten = antiAdScript + rewritten;
    }

    res.send(rewritten);
  } catch (e) {
    res.status(502).send(`<!DOCTYPE html><html><body style="background:#0a0a0a;color:#ff4466;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px">
      <div style="font-size:48px">⚠️</div>
      <div style="font-size:18px;font-weight:bold">Provider Unavailable</div>
      <div style="font-size:13px;color:#888;text-align:center;max-width:320px">${e.message}<br><br>Try switching to a different server.</div>
    </body></html>`);
  }
});

// ─── 10. HLS & Subtitle Proxy (bypasses CORS, rewrites playlists, streams binary segments) ────────────────
app.get('/api/proxy', async (req, res) => {
  const { url, referer } = req.query;
  if (!url) return res.status(400).send('url required');

  const target = decodeURIComponent(url);
  const ref = referer ? decodeURIComponent(referer) : 'https://megaplay.buzz/';

  try {
    let originBase;
    try { originBase = new URL(ref).origin; } catch { originBase = 'https://megaplay.buzz'; }

    const upstream = await fetch(target, {
      headers: {
        Referer: ref,
        Origin: originBase,
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Accept: '*/*',
      },
    });

    if (!upstream.ok) return res.status(upstream.status).send('Upstream error: ' + upstream.status);

    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    const isM3u8 = ct.includes('mpegurl') || target.includes('.m3u8');
    const isVtt = target.includes('.vtt') || ct.includes('vtt');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (isM3u8) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      const text = await upstream.text();
      const baseUrl = target.substring(0, target.lastIndexOf('/') + 1);
      const rewritten = text.split('\n').map(line => {
        const trimmed = line.trim();
        if (trimmed.startsWith('#EXT-X-KEY')) {
          return trimmed.replace(/URI="([^"]+)"/, (_, uri) => {
            const absUri = uri.startsWith('http') ? uri : (baseUrl + uri);
            return `URI="/api/proxy?url=${encodeURIComponent(absUri)}&referer=${encodeURIComponent(ref)}"`;
          });
        }
        if (!trimmed || trimmed.startsWith('#')) return line;
        const absolute = trimmed.startsWith('http') ? trimmed : (baseUrl + trimmed);
        return `/api/proxy?url=${encodeURIComponent(absolute)}&referer=${encodeURIComponent(ref)}`;
      }).join('\n');
      res.send(rewritten);
    } else if (isVtt) {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      const text = await upstream.text();
      res.send(text);
    } else {
      res.setHeader('Content-Type', ct);
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    }
  } catch (e) {
    res.status(502).send('Proxy error: ' + e.message);
  }
});

// ─── 11. Processed episodes (pipeline DB) ────────────────────────────────────
// Returns the locally-transcoded HLS stream_url for a given anime + episode.
app.get('/api/episode/:mal_id/:ep', async (req, res) => {
  await ensureDb();
  const malId = parseInt(req.params.mal_id, 10);
  const ep = parseInt(req.params.ep, 10);
  const version = req.query.v ? parseInt(req.query.v, 10) : null;
  if (Number.isNaN(malId) || Number.isNaN(ep)) {
    return res.status(400).json({ error: 'mal_id and ep are required' });
  }
  try {
    const row = getEpisode(malId, ep, version);
    if (!row) return res.status(404).json({ error: 'no processed stream found' });
    res.json({
      anime_id: row.anime_id,
      anilist_id: row.anilist_id,
      episode: row.episode,
      title: row.title,
      stream_url: row.stream_url,
      resolution: row.resolution,
      codecs: row.codecs,
      group: row.group_name,
      created_at: row.created_at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/pipeline/episodes/:mal_id', async (req, res) => {
  await ensureDb();
  const malId = parseInt(req.params.mal_id, 10);
  if (Number.isNaN(malId)) return res.status(400).json({ error: 'mal_id required' });
  try {
    res.json(listEpisodes(malId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 12. Pipeline control (optional, disabled unless ENABLE_PIPELINE=true) ───
const AUTH_TOKEN = process.env.PIPELINE_TOKEN || null;
function authOk(req) {
  if (!AUTH_TOKEN) return false;
  const h = req.headers.authorization || '';
  return h === `Bearer ${AUTH_TOKEN}` || req.query.token === AUTH_TOKEN;
}

app.get('/api/pipeline/status', async (req, res) => {
  const running = pipelineRunner?.running ?? (config.processing.autostart === true);
  await ensureDb();
  res.json({
    running,
    autostart: config.processing.autostart,
    feedUrl: config.rss.url,
    pollIntervalMs: config.rss.pollIntervalMs,
    trustedGroups: config.processing.trustedGroups,
    status: pipelineRunner ? pipelineRunner.getStatus() : { processed: 0, lastTick: null },
  });
});

app.post('/api/pipeline/start', async (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!pipelineRunner) {
    const m = await import('./pipeline/index.js');
    pipelineRunner = await m.createPipeline();
  }
  if (!pipelineRunner.running) await pipelineRunner.start();
  res.json({ started: true, status: pipelineRunner.getStatus() });
});

app.post('/api/pipeline/stop', async (req, res) => {
  if (!authOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (pipelineRunner) pipelineRunner.stop();
  res.json({ stopped: true });
});

const PORT = process.env.PORT || 3000;
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🎌 Animo engine → http://localhost:${PORT}`);
  });
}

export default app;