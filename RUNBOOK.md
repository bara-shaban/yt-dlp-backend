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
./scripts/run-backend-docker.sh
```

The helper refuses to start if no cookie env var is visible in the shell. If you run the backend directly in the Codespaces shell, it can read `YTDLP_COOKIES_BASE64` from the process environment. If you run it inside Docker, pass the env var into the container as shown above or use `--env-file .env`.

To generate a valid base64 cookie secret from a Netscape `cookies.txt` export:

```bash
./scripts/encode-cookies-base64.sh cookies.txt
```

Use the one-line output as `YTDLP_COOKIES_BASE64`. Do not paste the raw cookies file into `YTDLP_COOKIES_BASE64`; raw text belongs in `YTDLP_COOKIES_TEXT`.

For convenience, the backend also detects raw Netscape cookies accidentally placed in `YTDLP_COOKIES_BASE64` and treats them as cookie text. It normalizes tab-separated or whitespace-separated Netscape rows before writing `/tmp/yt-dlp-cookies.txt`. Base64 is still preferred for hosted secrets because it survives copy/paste and multiline secret handling better.

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

If a forwarded Codespaces backend URL returns `HTTP/2 401` with `www-authenticate: tunnel`, the request is being blocked by Codespaces before it reaches FastAPI. Open the Codespaces Ports panel and set port `10001` to public, or use a normal hosted backend URL for GitHub Pages/mobile clients.

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
- `YTDLP_PROXY`: proxy URL passed to yt-dlp (`http://user:pass@host:port` or `socks5://...`). Also reads `HTTPS_PROXY`/`HTTP_PROXY` as fallbacks. Use a residential proxy when running from Codespaces/Render to bypass YouTube's datacenter-IP bot check.
- `YTDLP_YT_PLAYER_CLIENT`: comma-separated YouTube clients passed to the extractor (e.g. `web,default` or `tv,web_safari`). Empty means yt-dlp's default.
- `YTDLP_YT_PO_TOKEN`: comma-separated `client.context+TOKEN` entries (e.g. `web.gvs+XXXX,web.player+YYYY`). Needed alongside cookies on datacenter IPs.
- `YTDLP_YT_VISITOR_DATA`: visitor data string bound to the po_token batch.
- `BGUTIL_POT_BASE_URL`: base URL of a running `bgutil-ytdlp-pot-provider` HTTP server (e.g. `http://bgutil-provider:4416` when using docker-compose). When set, yt-dlp asks that server for po_tokens automatically and you no longer need `YTDLP_YT_PO_TOKEN`/`YTDLP_YT_VISITOR_DATA`.
- `REQUEST_TIMEOUT_SECONDS`: yt-dlp timeout. Default is `90`.
- `MAX_CONCURRENT_REQUESTS`: concurrent extraction limit. Default is `2`.
- `DEFAULT_FORMAT`: default yt-dlp format selector.

## Quick Troubleshooting

Port or container name already allocated:

```bash
docker ps
docker rm -f yt-dlp-backend
```

Rebuild after backend code changes:

```bash
docker build -t yt-dlp-media-url-api .
```

Then start it again with the Codespaces cookie secret:

```bash
./scripts/run-backend-docker.sh
```

If `YTDLP_COOKIES_BASE64` was added after the codespace started, restart/rebuild the codespace or export it manually before running Docker. Check whether the current shell can see it:

```bash
echo "${YTDLP_COOKIES_BASE64:+set}"
```

Check whether the running container received it:

```bash
docker exec yt-dlp-backend sh -lc 'test -n "$YTDLP_COOKIES_BASE64" && echo cookie-env-present || echo cookie-env-missing'
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

## YouTube "Sign in to confirm you're not a bot"

This error means YouTube classified the outbound IP as a datacenter / shared range and is requiring a verified session. GitHub Codespaces, Render, Fly, and most cloud VMs are affected. There is no single fix — combine the steps below until extraction succeeds.

### 1. Provide real browser cookies (mandatory)

Export YouTube cookies from a logged-in browser using a Netscape-format exporter (the yt-dlp wiki "Exporting YouTube cookies" page covers the current method). Tips that matter:

- Use a fresh **incognito/private** window, log in, export, then close the window without browsing further. Browsing after export rotates the session and invalidates the file.
- Prefer a low-value Google account dedicated to this. YouTube can lock accounts that show automated patterns.

Then store the cookies as a Codespaces secret:

```bash
gh secret set YTDLP_COOKIES_BASE64 --body "$(base64 -w0 cookies.txt)"
```

Restart the codespace so the secret is exported into the shell, then run the backend.

### 2. Add a `po_token` (often required from datacenter IPs)

Cookies alone are usually not enough from a Codespaces IP — YouTube's GVS endpoint also wants a `po_token`. The reliable way to generate one is the `bgutil-ytdlp-pot-provider` plugin (runs a small HTTP server in a sidecar container that yt-dlp queries automatically).

**Recommended: run the full stack with docker-compose**

`docker-compose.yml` already wires the sidecar in. The backend image now ships the `bgutil-ytdlp-pot-provider` Python plugin (see `requirements.txt`). Bring everything up with:

```bash
./scripts/run-stack-docker.sh
```

This brings up two containers:

- `yt-dlp-bgutil-provider` — `brainicism/bgutil-ytdlp-pot-provider`, listens on `bgutil-provider:4416` inside the compose network.
- `yt-dlp-backend` — this app, with `BGUTIL_POT_BASE_URL=http://bgutil-provider:4416` already set.

Cookie env vars (`YTDLP_COOKIES_BASE64`, etc.) are read from your shell and passed through. Optional: set `YTDLP_PROXY`, `YTDLP_YT_PLAYER_CLIENT`, `BGUTIL_TOKEN_TTL` before running.

To verify the plugin loaded, look for these lines in container logs:

```
[debug] [youtube] [pot] PO Token Providers: bgutil:http-... (external)
[debug] [youtube] [pot] Fetching ... PO Token via bgutil:http
```

**Fallback: pass tokens manually**

If you generate tokens externally instead, set:

```bash
YTDLP_YT_PLAYER_CLIENT=web,default
YTDLP_YT_PO_TOKEN=web.gvs+POT_GVS_TOKEN,web.player+POT_PLAYER_TOKEN
YTDLP_YT_VISITOR_DATA=THE_VISITOR_DATA_THE_TOKEN_WAS_BOUND_TO
```

`po_token` is bound to **visitor data + video id**, so externally-generated tokens expire quickly. The sidecar is the durable option.

### 3. Route through a residential proxy (most reliable)

YouTube's datacenter-IP block is the actual root cause. Cookies and po_tokens are workarounds that YouTube tightens every few months. A residential proxy bypasses the issue entirely:

```bash
YTDLP_PROXY=http://user:pass@residential.example.com:8000
```

The backend also picks up standard `HTTPS_PROXY` / `HTTP_PROXY` env vars.

### 4. Run the backend off Codespaces

A home server, a Tailscale exit node pointing at your home, or a small VPS on a less-blacklisted ASN will often work with cookies alone. For anything close to production, this plus #3 is the only durable path.

### Verifying configuration

`GET /health` now reports the relevant state without leaking secrets:

```json
{
  "cookies": "configured",
  "proxy": "configured",
  "youtube_player_client": ["web", "default"],
  "youtube_po_token": "configured",
  "youtube_visitor_data": "configured",
  "pot_provider": "http://bgutil-provider:4416"
}
```

If you still get `Sign in to confirm you're not a bot` after all four, the cookies have rotated — re-export them.
