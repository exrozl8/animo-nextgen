import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';
import { config } from './config.js';

let SQL;
let db;

function int(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) throw new Error('expected integer');
  return n;
}

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

function findWasmPath() {
  try {
    const p = require.resolve('sql.js/dist/sql-wasm.wasm');
    if (fs.existsSync(p)) return p;
  } catch {}
  const candidate = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

export async function initDb() {
  try {
    // Prevent fatal Emscripten crashes in Vercel/serverless environments.
    // sql.js will forcefully abort the Node process if it cannot find its WASM file, bypassing try/catch.
    if (process.env.VERCEL || process.env.AWS_EXECUTION_ENV) {
      console.warn('[db] Running in serverless mode (Vercel/AWS). SQLite is disabled.');
      return null;
    }

    const wasmPath = findWasmPath();
    const opts = wasmPath ? { locateFile: () => wasmPath } : {};
    SQL = await initSqlJs(opts);

    let buf;
    if (fs.existsSync(config.db.file)) {
      try {
        buf = fs.readFileSync(config.db.file);
      } catch {}
    }
    db = new SQL.Database(buf);

    db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anime_id INTEGER NOT NULL,
        anilist_id INTEGER,
        episode INTEGER NOT NULL,
        version INTEGER DEFAULT 1,
        title TEXT,
        stream_url TEXT NOT NULL,
        resolution TEXT,
        codecs TEXT,
        group_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ep_anime ON episodes(anime_id, episode, version);
      CREATE INDEX IF NOT EXISTS idx_ep_anilist ON episodes(anilist_id, episode);
    `);

    return { db, SQL };
  } catch (err) {
    console.warn(`[db] Note: SQLite database disabled (${err.message}). Pipelines will run without local DB.`);
    return null;
  }
}

export function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const dir = path.dirname(config.db.file);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(config.db.file, Buffer.from(data));
  } catch (err) {
    console.warn(`[db] Note: could not persist database to disk: ${err.message}`);
  }
}

export function getDb() {
  return db || null;
}

export function getSQL() {
  if (!SQL) throw new Error('sql.js not initialised');
  return SQL;
}

export function insertEpisode(record) {
  const d = getDb();
  if (!d) return null;
  const stmt = d.prepare(`
    INSERT INTO episodes
      (anime_id, anilist_id, episode, version, title, stream_url, resolution, codecs, group_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `);
  stmt.bind([
    int(record.animeId),
    record.anilistId != null ? int(record.anilistId) : null,
    int(record.episode),
    record.version != null ? int(record.version) : 1,
    record.title || null,
    record.streamUrl,
    record.resolution || null,
    (record.codecs || []).join(','),
    record.groupName || null,
  ]);
  let id = null;
  if (stmt.step()) {
    const row = stmt.get();
    id = row ? row[0] : null;
  }
  stmt.free();
  saveDb();
  return id;
}

export function getEpisode(malId, episode, version = null) {
  const id = int(malId);
  const ep = int(episode);
  const d = getDb();
  if (!d) return null;
  const sql = version
    ? `SELECT * FROM episodes WHERE anime_id = ${id} AND episode = ${ep} AND version = ${int(version)} ORDER BY created_at DESC LIMIT 1`
    : `SELECT * FROM episodes WHERE anime_id = ${id} AND episode = ${ep} ORDER BY version DESC, created_at DESC LIMIT 1`;
  const rows = d.exec(sql);
  if (!rows.length || !rows[0].values.length) return null;
  const row = zip(rows[0]);
  return normalizeRow(row);
}

export function listEpisodes(malId) {
  const id = int(malId);
  const d = getDb();
  if (!d) return [];
  const rows = d.exec(`SELECT * FROM episodes WHERE anime_id = ${id} ORDER BY episode ASC, version DESC, created_at DESC`);
  if (!rows.length) return [];
  const cols = rows[0].columns;
  const vals = rows[0].values;
  return vals.map((v) => normalizeRow(zipObj(cols, v)));
}

function zip(res) {
  return zipObj(res.columns, res.values[0]);
}

function zipObj(cols, vals) {
  const obj = {};
  cols.forEach((c, i) => { obj[c] = vals[i]; });
  return obj;
}

function normalizeRow(row) {
  return {
    ...row,
    id: Number(row.id),
    codecs: row.codecs ? String(row.codecs).split(',').filter(Boolean) : [],
    episode: Number(row.episode),
    anime_id: Number(row.anime_id),
    anilist_id: row.anilist_id != null ? Number(row.anilist_id) : null,
    version: Number(row.version || 1),
  };
}
