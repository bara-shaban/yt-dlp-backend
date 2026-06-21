# yt-dlp Media URL API

Small Dockerized FastAPI service for Render. It accepts a page URL supported by `yt-dlp` and returns the temporary direct media URL that `yt-dlp` resolves.

Use it only for media you own, control, or have permission to access. Returned URLs are usually signed or temporary, and some require the returned request headers to be used by your client.

## Endpoints

- `GET /health`
- `POST /resolve`
- `GET /resolve?url=...`
- `POST /formats`
- `GET /formats?url=...`
- `POST /search`
- `GET /search?q=...`
- `POST /channels/search`
- `GET /channels/search?q=...`
- `POST /channels/videos`
- `GET /channels/videos?url=...`
- `POST /playlist`
- `GET /playlist?url=...`
- `GET /stream?url=...`
- `GET /docs`

## Example request

```bash
curl -X POST "https://YOUR-RENDER-SERVICE.onrender.com/resolve" \
  -H "content-type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","video_format":"best[height<=720]/best"}'
```

Example response shape:

```json
{
  "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "requested_format_selector": "best[height<=720]/best",
  "id": "dQw4w9WgXcQ",
  "title": "Example title",
  "extractor": "Youtube",
  "format_id": "18",
  "ext": "mp4",
  "protocol": "https",
  "direct_url": "https://...",
  "expires_at": "2026-06-13T04:20:00Z",
  "headers": {
    "User-Agent": "..."
  }
}
```

## Optional request fields

```json
{
  "url": "https://example.com/watch/123",
  "format": "best[height<=720]/best",
  "user_agent": "Custom user agent if the source site needs it",
  "referer": "https://example.com/",
  "include_formats": false
}
```

Use only one of `format`, `video_format`, or `format_id` in the same request. They all map to the `yt-dlp` format selector, so these are equivalent ways to ask for a specific choice:

```json
{"url":"https://example.com/watch/123","video_format":"best[height<=720]/best"}
```

```json
{"url":"https://example.com/watch/123","format_id":"18"}
```

By default the service asks `yt-dlp` for a single audio+video URL:

```text
best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best
```

If you request a separate audio/video format such as `bestvideo+bestaudio`, `direct_url` may be absent and the response will contain a `streams` array instead.

For browser playback, use `/stream` instead of the raw `direct_url`. Some providers bind direct media URLs to the API server IP, so a browser on a different IP may fail to play them.

## Embedded video pages

The service first asks `yt-dlp` to resolve the URL exactly as provided. If that fails, it falls back to a conservative embed scan: it fetches the HTML page, looks for normal `iframe`, `embed`, `video`, `audio`, `source`, and direct media URLs such as `.m3u8`, `.mpd`, or `.mp4`, then asks `yt-dlp` to resolve those candidates.

This is meant for media you own, control, or have permission to access. It does not execute page JavaScript or bypass DRM/paywalls.

Example for an authorized embedded player page:

```bash
curl -X POST "http://localhost:10001/resolve" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/embed/player","video_format":"best","referer":"https://example.com/"}'
```

When the fallback resolves an embedded URL, the response includes:

```json
{
  "source_url": "https://example.com/embed/player",
  "resolved_from_url": "https://cdn.example.com/master.m3u8",
  "resolved_from_kind": "media-url",
  "direct_url": "https://..."
}
```

## YouTube cookies

Some YouTube videos return:

```text
Sign in to confirm you're not a bot
```

For those, export cookies from a browser account that can access the video, convert the Netscape cookies file to base64, and set it in Render as `YTDLP_COOKIES_BASE64`.

On macOS:

```bash
base64 -i cookies.txt | pbcopy
```

Then paste the copied value into Render:

```text
YTDLP_COOKIES_BASE64=...
```

Redeploy the service after setting it. `/health` will show `"cookies":"configured"` when the app loaded cookies.

To inspect available formats first:

```bash
curl "https://YOUR-RENDER-SERVICE.onrender.com/formats?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ" \
  -H "x-api-key: YOUR_API_KEY"
```

Then pass the chosen `format_id` back to `/resolve`:

```bash
curl -X POST "https://YOUR-RENDER-SERVICE.onrender.com/resolve" \
  -H "content-type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","format_id":"18"}'
```

## Local Docker run

```bash
docker build -t yt-dlp-media-url-api .
docker run --rm -p 10000:10000 -e API_KEY=dev-secret yt-dlp-media-url-api
```

Then:

```bash
curl -X POST "http://localhost:10000/resolve" \
  -H "content-type: application/json" \
  -H "x-api-key: dev-secret" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

To run on the same local URL used by the frontend and mount exported YouTube cookies:

```bash
docker run --rm -p 10001:10000 \
  --mount type=bind,src="$(pwd)/cookies.txt",dst=/run/secrets/youtube-cookies.txt,readonly \
  -e YTDLP_COOKIES_FILE=/run/secrets/youtube-cookies.txt \
  yt-dlp-media-url-api
```

## Render deploy

This directory contains:

- `Dockerfile`
- `.dockerignore`
- `render.yaml`
- `requirements.txt`
- `main.py`
- `__init__.py`

Deploy from Render as a Docker web service or use the included Blueprint. If this folder is inside a larger repo, set Render's root directory to `yt_dlp_api`. The app binds to `0.0.0.0` and reads Render's `PORT` environment variable.

## Standalone frontend

The `ui/` folder is a separate static frontend. It is not copied into the API Docker image. It uses the YouTube Data API from the browser for search results, thumbnails, titles, durations, and view counts. Search suggestions are fetched directly by the browser from YouTube/Google's public suggestion endpoint.

Run it locally with the frontend dev server. It reads the root `.env` file and serves a generated `config.js` to the browser:

```bash
node ui/dev-server.mjs
```

Then open:

```text
http://localhost:8080/
```

Enter a YouTube Data API key in the frontend. To resolve a selected video into a direct media link, also enter your resolver backend URL, for example `http://localhost:10001`, plus the resolver API key if your backend uses one. Pasting a YouTube playlist URL into search loads the playlist from the resolver backend and shows it in the watch-page playlist rail.

For local `.env` config, the frontend dev server recognizes `YOUTUBE_API_KEY`, `YOUTUBE_DATA_API_KEY`, `YT_API_KEY`, `YT_PUBLIC_API_KEY`, or the first non-empty raw line. Hyphenated names are normalized too. It also recognizes `RESOLVER_URL` and `RESOLVER_API_KEY` for the optional resolver fields.

You can prefill values with query parameters:

```text
http://localhost:8080/?ytKey=YOUR_YOUTUBE_API_KEY&api=http%3A%2F%2Flocalhost%3A10001&apiKey=dev-secret
```

The frontend stores these values in browser `localStorage`.

## React Native mobile app

The `mobile/` folder is an Expo React Native app for phones. It uses the same resolver endpoints as the browser frontend, separates regular videos from Shorts, stores queue/history/playlists on the device, supports swipe-up fullscreen on the video, and includes a Chromecast handoff path through `react-native-google-cast`.

```bash
cd mobile
npm install
npm start
```

Chromecast requires a development or release build because the Cast module is native and is not available in Expo Go. A physical phone cannot use your computer's `localhost`, so set the in-app resolver URL to your computer's LAN address, for example:

```text
http://192.168.1.25:10001
```

or use your Render service URL.

## Push an image for Render to pull

Set the image name to your Docker Hub or GHCR repository, then build and push an amd64 image:

```bash
docker buildx build --platform linux/amd64 \
  -t docker.io/YOUR_DOCKERHUB_USER/yt-dlp-media-url-api:0.1.0 \
  --push .
```

In Render, create a web service from an existing image and use:

```text
docker.io/YOUR_DOCKERHUB_USER/yt-dlp-media-url-api:0.1.0
```

Render does not automatically redeploy image-backed services when a tag changes. Trigger a manual deploy or use the deploy hook after each push.

Set `API_KEY` in Render. If `API_KEY` is empty, the API is public.

Useful environment variables:

- `API_KEY`: optional shared secret for `x-api-key` or `Authorization: Bearer ...`
- `CORS_ORIGINS`: comma-separated browser origins, default `*`
- `DEFAULT_FORMAT`: default yt-dlp format selector
- `YTDLP_COOKIES_BASE64`: base64-encoded Netscape cookies file for sources that require cookies
- `YTDLP_COOKIES_FILE`: path to a cookies file already present in the container
- `YTDLP_JS_RUNTIMES`: JavaScript runtimes for yt-dlp challenge solving, default `node`
- `YTDLP_REMOTE_COMPONENTS`: remote yt-dlp challenge components to allow, default `ejs:github`
- `REQUEST_TIMEOUT_SECONDS`: default `90`
- `SOCKET_TIMEOUT_SECONDS`: default `20`
- `STREAM_TIMEOUT_SECONDS`: default `30`
- `ENABLE_EMBED_FALLBACK`: inspect simple HTML embeds when the original URL fails, default `true`
- `EMBED_PAGE_TIMEOUT_SECONDS`: default `15`
- `EMBED_PAGE_MAX_BYTES`: default `2000000`
- `MAX_EMBED_CANDIDATES`: default `8`
- `DEFAULT_USER_AGENT`: browser-like user agent used by embed fallback when no `user_agent` is supplied
- `MAX_CONCURRENT_REQUESTS`: default `2`
- `MAX_SEARCH_RESULTS`: default `15`
- `MAX_CHANNEL_SEARCH_RESULTS`: default `12`
- `MAX_CHANNEL_VIDEO_RESULTS`: default `18`
- `MAX_PLAYLIST_RESULTS`: default `50`
- `ALLOW_PRIVATE_URLS`: default disabled; set `true` only for trusted private deployments
