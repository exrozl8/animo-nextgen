import { spawn } from 'child_process';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';

export function makeOutputDir(animeId, episode, hash = null) {
  const h = hash || crypto.randomBytes(8).toString('hex');
  return path.join(config.transcode.outputDir, String(animeId), String(episode), h);
}

export function buildIndexUrl(baseCdnUrl, animeId, episode, hash) {
  return `${baseCdnUrl}/${animeId}/${episode}/${hash}/index.m3u8`;
}

export function transcode(inputPath, outDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    const indexM3u8 = path.join(outDir, 'index.m3u8');

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-i', inputPath,
      '-c:v', config.transcode.videoCodec,
      '-preset', config.transcode.preset,
      '-c:a', config.transcode.audioCodec,
      '-f', 'hls',
      '-hls_time', String(config.transcode.hlsTime),
      '-hls_list_size', String(config.transcode.hlsListSize),
      '-hls_playlist_type', config.transcode.hlsPlaylistType,
      '-hls_segment_filename', path.join(outDir, 'seg_%03d.ts'),
      '-hls_base_file_path', outDir + '/',
      indexM3u8,
    ];

    const ff = spawn(config.transcode.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d.toString(); });

    ff.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`ffmpeg not found at "${config.transcode.ffmpegPath}". Install ffmpeg and ensure it is on your PATH.`));
      } else {
        reject(err);
      }
    });

    ff.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}${stderr ? ': ' + stderr.trim() : ''}`));
      } else if (!fs.existsSync(indexM3u8)) {
        reject(new Error('ffmpeg finished but index.m3u8 was not produced'));
      } else {
        resolve({ outDir, indexM3u8 });
      }
    });
  });
}
