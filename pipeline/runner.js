import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createPipeline } from './index.js';
import { config } from './config.js';

async function main() {
  const downloader = process.env.DOWNLOAD_HOOK
    ? async (item) => {
        const { execFile } = await import('node:child_process');
        const out = await new Promise((resolve, reject) => {
          execFile(process.env.DOWNLOAD_HOOK, [item.link, config.download.dir], (err, stdout) => {
            if (err) return reject(err);
            resolve(stdout.trim());
          });
        });
        return out;
      }
    : null;

  const p = await createPipeline({
    downloader,
    feedUrl: process.env.NYAA_RSS_URL,
    intervalMs: parseInt(process.env.POLL_INTERVAL_MS || '300000', 10),
  });

  console.log(`[pipeline] listening to ${p.getFeedUrl()} every ${config.rss.pollIntervalMs}ms`);
  console.log(`[pipeline] upload strategy: ${config.upload.strategy}`);
  await p.start();
  console.log('[pipeline] started');

  const stop = () => {
    console.log('[pipeline] stopping...');
    p.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((e) => {
    console.error('[pipeline] fatal:', e);
    process.exit(1);
  });
}
