# yt-dlp API Backend Runbook

This runbook covers how to run the Docker backend locally and send requests to it.

Use this service only for media you own, control, or have permission to access.

## Files That Matter

- `Dockerfile`: builds the backend image.
- `main.py`: FastAPI app with the API endpoints.
- `requirements.txt`: Python dependencies.
- `render.yaml`: optional Render deployment config.
- `ui/`: separate static browser frontend.
- `cookies.txt`: local secret file if you need YouTube cookies. Do not commit it.

The Docker image runs the backend API only. The `ui/` browser frontend is separate and can be hosted anywhere static files are supported.

## Build The Image

Run from the `yt_dlp_api/` directory:

```bash
docker build -t yt-dlp-media-url-api .
```

If you are in the parent repo directory, run:

```bash
docker build -t yt-dlp-media-url-api ./yt_dlp_api
```

## Run The Backend

When running the backend directly with Python, it auto-loads a local `.env` file before reading secrets. In Docker, pass `.env` explicitly with `--env-file .env` or individual `-e` flags.

Without cookies:

```bash
docker run --rm --name yt-dlp-backend -p 10001:10000 yt-dlp-media-url-api
```

With cookies:

```bash
docker run --rm --name yt-dlp-backend -p 10001:10000 \
  --mount type=bind,src="$PWD/cookies.txt",dst=/run/secrets/youtube-cookies.txt,readonly \
  -e YTDLP_COOKIES_FILE=/run/secrets/youtube-cookies.txt \
  yt-dlp-media-url-api
```

With a Codespaces or hosted secret:

```bash
docker run --rm --name yt-dlp-backend -p 10001:10000 \
  -e API_KEY=dev-secret \
  -e YTDLP_COOKIES_BASE64 \
  yt-dlp-media-url-api
```

If you run the backend directly in the Codespaces shell, it can read `YTDLP_COOKIES_BASE64` from the process environment. If you run it inside Docker, pass the env var into the container as shown above or use `--env-file .env`.

The container listens on port `10000`. The host maps it to `10001`, so your local backend URL is:

```text
http://localhost:10001
```

## Run With An API Key

```bash
docker run --rm --name yt-dlp-backend -p 10001:10000 \
  -e API_KEY=dev-secret \
  yt-dlp-media-url-api
```

When `API_KEY` is set, send it as either:

```bash
-H "x-api-key: dev-secret"
```

or:

```bash
-H "Authorization: Bearer dev-secret"
```

## Stop The Backend

```bash
docker stop yt-dlp-backend
```

If you forgot the container name:

```bash
docker ps
docker stop <container-name-or-id>
```

If Docker says port `10001` is already allocated:

```bash
lsof -nP -iTCP:10001 -sTCP:LISTEN
docker ps
```

Then stop the container or process that is holding the port.

## Health Check

```bash
curl http://localhost:10001/health
```

Expected shape:

```json
{
  "ok": true,
  "yt_dlp_version": "...",
  "cookies": "configured",
  "js_runtimes": ["node"]
}
```

If cookies are not mounted, `cookies` will show `disabled`.

## API Docs

Open:

```text
http://localhost:10001/docs
```

FastAPI will show interactive docs for every endpoint.

## Resolve A Media URL

Use `POST /resolve` to ask `yt-dlp` for a direct media URL.

```bash
curl -X POST "http://localhost:10001/resolve" \
  -H "content-type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","video_format":"18"}'
```

With an API key:

```bash
curl -X POST "http://localhost:10001/resolve" \
  -H "content-type: application/json" \
  -H "x-api-key: dev-secret" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","video_format":"18"}'
```

Useful response fields:

- `title`: resolved media title.
- `format_id`: selected format.
- `direct_url`: temporary direct media URL.
- `headers`: request headers that may be needed by the player.
- `expires_at`: estimated expiration time if detectable.

Direct URLs are temporary. Re-resolve them when playback fails or after they expire.

## Resolve With GET

```bash
curl "http://localhost:10001/resolve?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&video_format=18"
```

Use URL encoding for query parameters.

## List Available Formats

```bash
curl "http://localhost:10001/formats?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ"
```

Then choose a `format_id` and pass it back to `/resolve` or `/stream`.

Common browser-friendly options:

- `18`: often MP4 with audio and video.
- `best[height<=720][vcodec!=none][acodec!=none]/best[height<=720]/best`: auto-pick a playable stream.

## Stream Through The Backend

Use `/stream` when the browser or another device should play through your backend instead of using the raw `direct_url`.

```bash
curl -I "http://localhost:10001/stream?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&video_format=18"
```

It supports range requests, so browsers can seek in the video when the upstream source supports it.

## Use The Browser Frontend

The `ui/` folder is static HTML/CSS/JS. It searches YouTube from the browser with the YouTube Data API, fetches suggestions from YouTube/Google's public suggestion endpoint, and only calls the backend when resolving a selected video link.

Run it separately with the frontend dev server. It reads the root `.env` file and exposes only frontend config to the browser:

```bash
node ui/dev-server.mjs
```

Open:

```text
http://localhost:8080/?api=http%3A%2F%2Flocalhost%3A10001
```

The search page is:

```text
http://localhost:8080/
```

The frontend looks for the YouTube key in `.env` using `YOUTUBE_API_KEY`, `YOUTUBE_DATA_API_KEY`, `YT_API_KEY`, `YT_PUBLIC_API_KEY`, or the first non-empty raw line. Hyphenated names are normalized too. If your backend uses `API_KEY`, enter that value in the resolver key field or set `RESOLVER_API_KEY` in `.env`.

For another device on the same network, replace `localhost` with your computer's LAN IP:

```text
http://YOUR_LAN_IP:8080/?api=http%3A%2F%2FYOUR_LAN_IP%3A10001
```

## Host The UI On GitHub Pages

The `ui/` folder is static and can be published with GitHub Pages. The backend stays separate (Docker, Render, ngrok, etc.).

### Recommended: deploy from the `docs/` folder (no Actions, no billing)

This works on free GitHub accounts even when Actions is blocked for billing.

1. Sync the UI into `docs/`:

```bash
./scripts/sync-ui-docs.sh
```

2. Optionally edit `docs/config.js` with your public backend URL and keys, or use URL params instead (see below).

3. Commit and push:

```bash
git add docs/ scripts/sync-ui-docs.sh
git commit -m "Publish UI to GitHub Pages"
git push
```

4. Open **Settings → Pages** for the repo.
5. Under **Build and deployment → Source**, choose **Deploy from a branch**.
6. Set **Branch** to `main` and **Folder** to `/docs`.
7. Save.

Your site URL will be:

```text
https://bara-shaban.github.io/yt-dlp-backend/
```

After UI changes in `ui/`, run `./scripts/sync-ui-docs.sh` and push `docs/` again.

### Configure the live site

Do not commit live keys to `docs/config.js`. Prefer the GitHub Actions deploy workflow with repository secrets:

```text
YOUTUBE_API_KEY
RESOLVER_URL
RESOLVER_API_KEY
GOOGLE_CLIENT_ID
```

`RESOLVER_URL` may be the backend root or a resolver endpoint such as `https://organic-space-goggles-4jwg4v79r5rpc5qg5-10000.app.github.dev/resolve`; the UI normalizes it before calling `/search`, `/resolve`, `/formats`, and `/playlist`. If `RESOLVER_URL` is not set, the Pages workflow defaults to `https://organic-space-goggles-4jwg4v79r5rpc5qg5-10000.app.github.dev`.

`GOOGLE_CLIENT_ID` is the OAuth web client ID used by the Sign in buttons. It enables official YouTube Data API account reads such as subscriptions and playlists after the user grants `youtube.readonly`. YouTube does not expose the exact personalized Home, For You, or Shorts recommendation feeds through the public API.

For the branch-based `/docs` Pages method, keep `docs/config.js` empty and pass config in the URL when testing (values are visible in the browser):

```text
https://bara-shaban.github.io/yt-dlp-backend/?ytKey=YOUR_YT_KEY&api=https%3A%2F%2Fyour-backend.example.com%2Fresolve&apiKey=YOUR_RESOLVER_KEY&googleClientId=YOUR_GOOGLE_CLIENT_ID
```

### YouTube API key restrictions

Because the UI runs in the browser, the YouTube key is public. In Google Cloud Console, restrict the key by **HTTP referrer**:

```text
https://bara-shaban.github.io/*
```

### Backend CORS

The backend must allow browser requests from GitHub Pages. Default `CORS_ORIGINS=*` already allows this. For a locked-down backend, set:

```text
CORS_ORIGINS=https://bara-shaban.github.io
```

### Optional: GitHub Actions deploy

The workflow in `.github/workflows/deploy-ui.yml` can publish `ui/` automatically, but it requires GitHub Actions billing to be enabled. If your account is locked for billing, use the `docs/` method above instead.

## Deploy Backend From GitHub

Commit these backend files:

- `Dockerfile`
- `.dockerignore`
- `requirements.txt`
- `main.py`
- `__init__.py`
- `render.yaml` if using Render
- `README.yt-dlp-api.md`
- `RUNBOOK.md`

The `ui/` folder is deployed separately as static frontend assets.

Do not commit:

- `.venv/`
- `__pycache__/`
- `cookies.txt`
- `.env`
- real API keys

If the GitHub repo contains many folders, set the deployment root/build context to:

```text
yt_dlp_api
```

## Useful Environment Variables

- `PORT`: port inside the container. Defaults to `10000`.
- `API_KEY`: optional shared secret.
- `CORS_ORIGINS`: allowed browser origins. Defaults to `*`.
- `YTDLP_COOKIES_FILE`: path to mounted cookies file.
- `YTDLP_COOKIES_BASE64`: cookies as base64 text for hosted deployments.
- `YTDLP_COOKIES_TEXT`: raw Netscape cookies text.
- `YOUTUBE_COOKIES_FILE`, `YOUTUBE_COOKIES_BASE64`, `YOUTUBE_COOKIES_TEXT`: aliases for the same cookie inputs.
- `REQUEST_TIMEOUT_SECONDS`: yt-dlp timeout. Default is `90`.
- `MAX_CONCURRENT_REQUESTS`: concurrent extraction limit. Default is `2`.
- `DEFAULT_FORMAT`: default yt-dlp format selector.

## Quick Troubleshooting

Port already allocated:

```bash
docker ps
docker stop yt-dlp-backend
```

No cookies:

```bash
curl http://localhost:10001/health
```

Check that `cookies` says `configured`.

Unauthorized:

Send `x-api-key` or remove the `API_KEY` environment variable when running locally.

Video does not play:

Try `/formats`, then use a combined audio/video `format_id` such as `18`, or use `/stream` instead of `direct_url`.
