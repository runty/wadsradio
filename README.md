# WadsRadio

A fast, responsive internet radio web app with first-class YoRadio station list support.

## Features

- Touch-friendly player for desktop and mobile browsers
- Local station library with search, favorites, add, remove, and volume persistence
- Rich now-playing panel with stream title, artist, station name, genre, bitrate, and audio format when the stream publishes ICY/Shoutcast metadata
- Import from YoRadio `playlist.csv`, YoRadio/KaRadio JSON-line station lists, M3U, PLS, and simple CSV/text rows
- Export back to YoRadio-compatible `playlist.csv`
- Static build served by a small Node server for simple Linux Docker deployment

## YoRadio playlist format

YoRadio `playlist.csv` rows are tab-separated:

```text
Station name	https://stream.example/radio	0
```

The third column is YoRadio's per-station output volume offset. WadsRadio preserves it on import/export even though browser playback uses the main volume slider.

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
