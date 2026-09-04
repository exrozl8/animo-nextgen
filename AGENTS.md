# Agent instructions for animo-backend

## Project layout
- `server.js` — Express API server (metadata, streaming proxies, embedded player helpers).
- `pipeline/` — automated episode ingestion pipeline (detection → transcode → upload → DB).
- `pipeline/config.js` — all runtime options are driven by environment variables.
- `pipeline/db.js` — sql.js-backed SQL database persisted to `data/animo.db`.
- `test/integration.test.mjs` — end-to-end pipeline test (mocked external steps).

## Commands
| Task | Command |
|------|---------|
| Start the API server | `npm start` (or `node server.js`) |
| Run the ingestion pipeline (standalone) | `npm run pipeline` (or `node pipeline/runner.js`) |
| Run tests | `npm test` |
| Lint (none configured yet) | `npm run lint` (add a linter to enable) |

## Pipeline (auto-ingest) overview
1. **Detect** — `pipeline/detector.js` polls the Nyaa RSS feed every `POLL_INTERVAL_MS`.
2. **Parse** — `pipeline/parser.js` regex-parses the release filename → group/title/episode/resolution/codecs.
3. **Resolve** — `pipeline/anilist.js` asks the AniList GraphQL API for the canonical anime + MAL id.
4. **Transcode** — `pipeline/transcoder.js` runs `ffmpeg` to split the file into HLS segments.
5. **Upload** — `pipeline/uploader.js` copies to CDN (local / sftp / rclone / http).
6. **Store** — `pipeline/db.js` upserts a row in the `episodes` table.
7. **Serve** — `GET /api/episode/:mal_id/:ep` returns `stream_url` to the frontend player.

## Environment
- Copy `.env.example` → `.env` and fill in values.
- `ENABLE_PIPELINE=true` makes `server.js` auto-start the polling loop on boot.
- `ffmpeg` must be on PATH (or set `FFMPEG_PATH`).
- `PIPELINE_TOKEN` is required to start/stop the pipeline via HTTP (`POST /api/pipeline/start`).

## Notes
- The default server runs the metadata/streaming API only. The ingest pipeline is opt-in
  via `ENABLE_PIPELINE=true` or `npm run pipeline`.
- This is an educational integration template. Provide your own `downloader`
  (torrent client / Sonarr hook) — see `pipeline/runner.js`.
