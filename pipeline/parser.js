const CODEC_ALIASES = {
  'h264': 'h264', 'x264': 'h264', 'avc': 'h264',
  'h265': 'hevc', 'x265': 'hevc', 'hev': 'hevc', 'hevc': 'hevc',
  'av1': 'av1', 'av01': 'av1',
  'vp9': 'vp9', 'vp8': 'vp8',
};
const AUDIO_CODECS = new Set(['aac', 'flac', 'opus', 'mp3', 'ac3', 'eac3', 'truehd', 'vorbis', 'pcm', 'wav']);

export function parseFilename(filename) {
  const result = {
    group: null,
    title: null,
    episode: null,
    episodeRaw: null,
    season: null,
    version: 1,
    resolution: null,
    codecs: [],
    audio: [],
    container: null,
    raw: filename,
  };

  const extMatch = filename.match(/\.([a-zA-Z0-9]{1,6})$/);
  if (extMatch) result.container = extMatch[1].toLowerCase();
  const base = filename.replace(/\.[a-zA-Z0-9]{1,6}$/, '').replace(/^\s+|\s+$/g, '');

  // 1. Peel trailing [tags] (e.g. [1080p][HEVC][AAC]).
  //    A bracketed *title* (format 1: `Group [Title] - EP [tags]`) is never
  //    trailing, so it is left intact for the group/title split below.
  let s = base;
  const tags = [];
  let m;
  while ((m = s.match(/\s*\[([^\]]*)\]$/))) {
    tags.unshift(m[1]);
    s = s.slice(0, m.index).trim();
  }
  const main = s;

  // 2. Locate the episode marker within main:
  //    a) plain numeric ending: "Title - 001" / "Title - 101"
  //    b) seasonal: "Title - S01E01"
  //    c) loose: last numeric run (2-4 digits)
  let prefix = null;
  let episodeRaw = null;

  let em = main.match(/^(.*?)\s*[-–]\s*(\d{1,4})(?:[vV](\d+))?$/);
  if (em) {
    prefix = em[1];
    episodeRaw = em[2];
    if (em[3]) result.version = parseInt(em[3], 10);
  }

  if (!em) {
    const se = main.match(/^(.*?)\s*[-–]\s*[Ss](\d{1,2})[Ee](\d{1,3})(?:[vV](\d+))?$/);
    if (se) {
      prefix = se[1];
      result.season = parseInt(se[2], 10);
      episodeRaw = se[3].padStart(2, '0');
      if (se[4]) result.version = parseInt(se[4], 10);
    }
  }

  if (!em && !result.season) {
    const loose = main.match(/^(.*?)\D(\d{2,4})(?:[vV](\d+))?$/);
    if (loose) {
      prefix = loose[1];
      episodeRaw = loose[2];
      if (loose[3]) result.version = parseInt(loose[3], 10);
    }
  }

  if (!prefix) prefix = main;
  result.episode = episodeRaw != null ? parseInt(episodeRaw, 10) : null;
  result.episodeRaw = episodeRaw;

  // 3. Split prefix into group + title.
  let group = null;
  let title = null;
  prefix = prefix.replace(/^\s+|\s+$/g, '');

  // leading single-token bracket = fansub group  e.g. [SubsPlease] Naruto ...
  let g = prefix.match(/^\[([^\[\]\s]+)\]\s*(.*)$/);
  if (g) {
    group = g[1];
    prefix = g[2].replace(/^\s+|\s+$/g, '');
  }

  if (prefix) {
    // format 1: `Group [Title]`  (single token before a bracketed title)
    g = prefix.match(/^([A-Za-z0-9.]+)\s+\[(.+)\](?:\s.*)?$/);
    if (g) {
      group = group || g[1];
      title = g[2];
    } else {
      // format 2: `Group - Title` (dash-separated, first part is a bare token)
      const parts = prefix.split(/\s*[-–]\s*/).filter(Boolean);
      if (parts.length >= 2 && /^[A-Za-z0-9.]+$/.test(parts[0]) && parts[0].length <= 24) {
        group = group || parts[0];
        title = parts.slice(1).join(' - ');
      } else {
        // no group — entire prefix is the title
        title = prefix;
      }
    }
  }

  result.group = group || null;
  result.title = cleanTitle(title);

  // 4. Classify tags into resolution / codecs / audio
  for (const tag of tags) {
    if (!tag) continue;
    const tokens = tag.toLowerCase().replace(/[._+]/g, ' ').split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      if (!result.resolution && /^\d{3,4}p$/.test(tok)) {
        result.resolution = tok;
      } else if (AUDIO_CODECS.has(tok)) {
        if (!result.audio.includes(tok)) result.audio.push(tok);
      } else if (CODEC_ALIASES[tok]) {
        if (!result.codecs.includes(CODEC_ALIASES[tok])) result.codecs.push(CODEC_ALIASES[tok]);
      }
    }
  }

  return result;
}

function cleanTitle(t) {
  if (!t) return null;
  return t
    .replace(/^\[[^\]]*\]/, '')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
}
