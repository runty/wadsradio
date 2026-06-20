# WadsRadio

A fast, responsive internet radio web app with first-class YoRadio station list support.

## Features

- Touch-friendly player for desktop and mobile browsers
- Bundled station lists from `station-lists/` with search, local favorites, add, remove, reorder, and volume persistence
- HLS playback for `.m3u8` / `playlist.m3u8` station URLs, including Chrome support through `hls.js`
- Mobile lock-screen and notification controls through the Media Session API
- Rich now-playing panel with stream title, artist, station name, genre, bitrate, and audio format when the stream publishes ICY/Shoutcast metadata
- Station logos from playlist logo URLs, bundled local logo badges, favicon fallbacks, and initials fallbacks
- Import from YoRadio `playlist.csv`, YoRadio/KaRadio JSON-line station lists, M3U/M3U8 station lists, PLS, and simple CSV/text rows
- Export back to YoRadio-compatible `playlist.csv`
- Static build served by a small Node server for simple Linux Docker deployment

## Station lists and favorites

WadsRadio discovers bundled playlists from `station-lists/` through `/api/station-lists`. Add a `.tsv`, `.csv`, `.m3u`, `.m3u8`, `.pls`, or `.txt` station-list file to that directory and restart the server to make it available in the list picker.

Bundled lists are read-only in the browser. Tapping the heart on any station copies it to the user's local Favorites playlist. Favorites are stored in browser localStorage, can be reordered or removed, and can be exported as a YoRadio-compatible `playlist.csv`.

Bundled TSV lists use these columns:

```text
Station name	https://stream.example/radio	0	direct	/station-logos/example.svg
```

The fourth column is informational and may be `direct` or `hls`. The fifth column is optional and can be a local path under `public/`, an `https://` image URL, or a `data:image/...` URL. When a playlist does not provide a logo, WadsRadio tries a curated local badge for known stations, then a domain favicon, then station initials. Generic stream-host favicons are skipped so stations do not show low-quality hosting-provider icons.

## YoRadio playlist format

YoRadio `playlist.csv` rows are tab-separated:

```text
Station name	https://stream.example/radio	0
```

The third column is YoRadio's per-station output volume offset. WadsRadio preserves it on import/export even though browser playback uses the main volume slider.

## HLS and playlist.m3u8 streams

Add an HLS stream the same way as any other station:

```text
Station name	https://stream.example/live/playlist.m3u8	0
```

HLS station playback goes through WadsRadio's `/api/hls` proxy, which rewrites playlists and segment URLs to avoid common cross-origin failures. Safari can usually play the proxied playlist natively; other browsers use `hls.js`.

Station-list `.m3u8` files are supported for import. HLS media playlists with `#EXT-X-*` segment directives are playback sources, not station lists, so add the playlist URL as a station instead of importing the file contents.

## Local development

```bash
npm install
npm run dev
```

Vite prints the local URL, usually `http://localhost:5173`.

## Docker on Linux

```bash
docker compose up --build
```

Open `http://localhost:8080`.

To use another host port:

```bash
WADSRADIO_PORT=8090 docker compose up --build
```

## Production build

```bash
npm run build
npm start
```

The static files are written to `dist/`, and `npm start` serves them on `http://localhost:8080` by default. Set `PORT` to change the container or local server port.

## Now-playing metadata

Browser audio elements do not reliably expose radio stream metadata. WadsRadio includes a small server-side probe at `/api/metadata` that asks the stream for ICY/Shoutcast metadata and returns what is available. Many stations publish track title and artist; some only publish station-level headers; some publish nothing beyond the audio stream.

For known stations whose stream does not publish track titles, WadsRadio can use provider-specific fallbacks. KEXP is supported through its public playlist API, including title, artist, album, cover art, show, host, label, release date, and played time.

## Browser playback notes

Some stations reject browser playback, go offline, or only publish `http://` streams. If you serve WadsRadio over HTTPS, browsers can block plain HTTP audio as mixed content. The Docker setup serves over HTTP locally, which is usually best for private LAN use.
