import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fetch from 'node-fetch';
import { config } from './config.js';

export async function upload(outDir, opts = {}) {
  const strategy = opts.strategy || config.upload.strategy;
  switch (strategy) {
    case 'local':
      return uploadLocal(outDir);
    case 'sftp':
      return uploadSftp(outDir, opts);
    case 'rclone':
      return uploadRclone(outDir, opts);
    case 'http':
      return uploadHttp(outDir, opts);
    default:
      throw new Error(`unknown upload strategy: ${strategy}`);
  }
}

export async function uploadLocal(outDir, base = config.upload.localBase, root = config.upload.localRoot) {
  const hash = path.basename(outDir) || crypto.randomBytes(4).toString('hex');
  const dest = path.join(root, hash);
  fs.cpSync(outDir, dest, { recursive: true });
  return buildIndexUrl(base, dest);
}

function buildIndexUrl(base, dest) {
  const rel = path.relative(config.upload.localRoot, dest).split(path.sep).join('/');
  return `${base.replace(/\/$/, '')}/${rel}/index.m3u8`;
}

export async function uploadSftp(outDir, opts = {}) {
  const host = opts.host || config.upload.sftp.host;
  const remoteDir = opts.remoteDir || config.upload.sftp.remoteDir;
  const remote = `${remoteDir}/${path.basename(outDir)}`;
  const child = spawn(
    'ssh',
    [`-o`, `BatchMode=yes`, `${host}`, `mkdir -p ${remote}`],
    { stdio: 'pipe' }
  );
  await new Promise((res, rej) => {
    child.on('close', (c) => (c === 0 ? res() : rej(new Error('ssh mkdir failed'))));
    child.on('error', rej);
  });
  return new Promise((resolve, reject) => {
    const child = spawn('rsync', ['-az', '--remove-source-files', `${outDir}/`, `${host}:${remote}/`], {
      stdio: 'pipe',
    });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`rsync exit ${code}`));
      const cdnBase = opts.base || config.upload.localBase;
      resolve(`${cdnBase}/${path.basename(outDir)}/index.m3u8`);
    });
    child.on('error', reject);
  });
}

export async function uploadRclone(outDir, opts = {}) {
  const remote = opts.remote || config.upload.rclone.remote;
  const dest = opts.dest || config.upload.rclone.dest;
  const name = path.basename(outDir);
  const child = spawn(config.upload.rclone.binary, ['copy', outDir, `${remote}:${dest}/${name}`, '--progress'], {
    stdio: 'pipe',
  });
  return new Promise((resolve, reject) => {
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`rclone exit ${code}`));
      const cdnBase = opts.base || config.upload.localBase;
      resolve(`${cdnBase}/${dest}/${name}/index.m3u8`);
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error(`rclone not found at "${config.upload.rclone.binary}"`));
      else reject(err);
    });
  });
}

export async function uploadHttp(outDir, opts = {}) {
  const url = opts.url || config.upload.http.url;
  if (!url) throw new Error('no HTTP upload URL configured');
  const files = walk(outDir);
  const form = {};
  for (const f of files) form[f.name] = fs.createReadStream(f.path);
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...(opts.headers || config.upload.http.headers) },
    body: null,
  });
  if (!res.ok) throw new Error(`HTTP upload ${res.status}`);
  const json = await res.json().catch(() => ({}));
  return json.url || json.stream_url || json.index || `${url}/${path.basename(outDir)}/index.m3u8`;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push({ path: full, name: path.relative(dir, full) });
  }
  return out;
}
