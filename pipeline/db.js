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

export async function initDb() {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(import.meta.dirname, '..', 'node_modules', 'sql.js', 'dist', file),
  });

  let buf;
  if (fs.existsSync(config.db.file)) {
    buf = fs.readFileSync(config.db.file);
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
}

export function saveDb() {
  if (!db) throw new Error('db not initialised');
  const data = db.export();
  const dir = path.dirname(config.db.file);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(config.db.file, Buffer.from(data));
}

export function getDb() {
  if (!db) throw new Error('db not initialised');
  return db;
}

export function getSQL() {
  if (!SQL) throw new Error('sql.js not initialised');
  return SQL;
}

export function insertEpisode(record) {
  const d = getDb();
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
