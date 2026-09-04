import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const parseList = (val, fallback) => {
  if (!val) return fallback;
  return val.split(',').map(s => s.trim()).filter(Boolean);
};

export const config = {
  rss: {
    url: process.env.NYAA_RSS_URL || 'https://nyaa.si/?page=rss',
    userAgent: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '300000', 10),
  },

  anilist: {
    endpoint: process.env.ANILIST_ENDPOINT || 'https://graphql.anilist.co',
  },

  download: {
    dir: process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads'),
    // hook executed once a release is detected; receives the rss item.
    // must return an absolute path to the downloaded media file.
    downloadHook: process.env.DOWNLOAD_HOOK || null,
    qbittorrent: {
      host: process.env.QBITTORRENT_HOST || null,
      username: process.env.QBITTORRENT_USERNAME || null,
      password: process.env.QBITTORRENT_PASSWORD || null,
      label: process.env.QBITTORRENT_LABEL || 'anime',
    },
  },

  transcode: {
    outputDir: process.env.HLS_OUTPUT_DIR || path.join(process.cwd(), 'hls'),
    hlsTime: parseInt(process.env.HLS_TIME || '6', 10),
    hlsPlaylistType: process.env.HLS_PLAYLIST_TYPE || 'vod',
    videoCodec: process.env.FFMPEG_VIDEO_CODEC || 'libx264',
    audioCodec: process.env.FFMPEG_AUDIO_CODEC || 'aac',
    preset: process.env.FFMPEG_PRESET || 'veryfast',
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  },

  upload: {
    strategy: process.env.UPLOAD_STRATEGY || 'local',
    localBase: process.env.CDN_BASE_URL || 'http://localhost:3000/hls',
    localRoot: process.env.CDN_LOCAL_ROOT || path.join(process.cwd(), 'cdn'),
    sftp: {
      host: process.env.SFTP_HOST || null,
      port: parseInt(process.env.SFTP_PORT || '22', 10),
      user: process.env.SFTP_USER || null,
      keyPath: process.env.SFTP_KEY_PATH || null,
      remoteDir: process.env.SFTP_REMOTE_DIR || '/var/www/cdn',
    },
    rclone: {
      remote: process.env.RCLONE_REMOTE || 'cdn',
      dest: process.env.RCLONE_DEST || 'anime',
      binary: process.env.RCLONE_PATH || 'rclone',
    },
    http: {
      url: process.env.CDN_UPLOAD_URL || null,
      headers: parseList(process.env.CDN_UPLOAD_HEADERS, []).reduce((acc, h) => {
        const [k, v] = h.split(':');
        if (k && v) acc[k.trim()] = v.trim();
        return acc;
      }, {}),
    },
  },

  db: {
    file: process.env.DB_FILE || path.join(process.cwd(), 'data', 'animo.db'),
  },

  processing: {
    // only process releases from these groups (lowercase, no spaces)
    trustedGroups: parseList(process.env.TRUSTED_GROUPS, ['subsplease', 'erai', 'mtbb', 'chibiki']),
    // auto-start the polling loop on boot
    autostart: process.env.ENABLE_PIPELINE?.toLowerCase() === 'true',
  },
};

fs.mkdirSync(path.dirname(config.db.file), { recursive: true });
fs.mkdirSync(config.download.dir, { recursive: true });
fs.mkdirSync(config.transcode.outputDir, { recursive: true });
fs.mkdirSync(config.upload.localRoot, { recursive: true });
