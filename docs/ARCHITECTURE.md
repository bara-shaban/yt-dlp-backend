# Architecture & Flow

This document explains how the yt-dlp backend is put together, how YouTube's bot
check is bypassed, and how to consume the resolved URLs from a browser, a mobile
app, or a local media player like VLC.

If you just need run/deploy commands, see [`RUNBOOK.md`](../RUNBOOK.md).

---

## 1. What the system does

YouTube (and the other sites yt-dlp supports) serve their videos via short-lived
signed CDN URLs. Those URLs cannot be discovered from the public HTML — they
require running YouTube's player JavaScript, decrypting signature ciphers, and
sometimes proving the request didn't come from a bot.

This backend wraps `yt-dlp` in a FastAPI service that:

1. Accepts a watch-page URL (`/resolve`, `/formats`, `/stream`, `/search`, …).
2. Drives `yt-dlp` to do the extraction, with cookies + a po_token sidecar so
   YouTube accepts the request even from a datacenter IP.
3. Returns a JSON payload with the temporary `direct_url`, or proxies the
   bytes through `/stream` for clients that can't follow the direct URL.

Clients (the `ui/` web app, the `mobile/` Expo app, VLC, browsers, etc.) never
touch yt-dlp themselves — they only call this API.

---

## 2. Container topology

```
              ┌────────────────────────────────────────────────┐
              │  Codespace / host                              │
              │                                                │
  request ──► │  ┌──────────────────┐    ┌──────────────────┐  │
              │  │  yt-dlp-backend  │◄──►│ bgutil-provider  │  │
              │  │  (FastAPI)       │    │ (pot HTTP server)│  │
              │  │  port 10000      │    │ port 4416        │  │
              │  └──────────────────┘    └──────────────────┘  │
              │           │                                    │
              │           └──► outbound to youtube.com,        │
              │                googlevideo CDN, etc.           │
              └────────────────────────────────────────────────┘
                          ▲
                          │ host port 10001 ──► container 10000
                          │
                     curl / UI / mobile / VLC
```

Two services, defined in `docker-compose.yml`:

### `yt-dlp-backend`
- Image is built from this repo's `Dockerfile` (Python 3.12 + Node 24 runtime + yt-dlp).
- Runs `uvicorn yt_dlp_api.main:app` on container port `10000`, published as
  `10001` on the host.
- Loads cookies from `YTDLP_COOKIES_BASE64` / `YTDLP_COOKIES_TEXT` /
  `YTDLP_COOKIES_FILE` at startup (see `init_cookie_file` in `main.py`).
- Talks to the sidecar via the compose-internal DNS name `bgutil-provider`.

### `bgutil-provider`
- Image: `brainicism/bgutil-ytdlp-pot-provider:latest`. Maintained upstream.
- Listens on port `4416` inside the compose network only — never published.
- Runs YouTube's BotGuard JavaScript via Node and exposes an HTTP endpoint that
  hands out **PO Tokens** (proof-of-origin tokens) on demand.
- Tokens are cached for `BGUTIL_TOKEN_TTL` hours (default 6).

The two containers share a private Docker network created by compose, so the
backend reaches the sidecar at `http://bgutil-provider:4416` and nothing else
on the network can.

---

## 3. The bot-check problem (and how this solves it)

When YouTube doesn't trust the requester it returns:

> Sign in to confirm you're not a bot.

It triggers this on:

- Requests from cloud / datacenter IP ranges (Codespaces, Render, Fly, AWS, …).
- Requests missing a valid session cookie.
- Requests to the GVS endpoint without a valid `po_token` bound to the
  visitor data.

The mitigation is three layers — each handles a different signal:

| Signal YouTube checks | Mitigation                                       | Env var                                  |
| --------------------- | ------------------------------------------------ | ---------------------------------------- |
| Logged-in session     | Pass real Netscape cookies from a browser session | `YTDLP_COOKIES_BASE64`                   |
| Proof-of-origin token | bgutil sidecar generates one per request          | `BGUTIL_POT_BASE_URL` (compose sets it)  |
| IP reputation         | Route yt-dlp through a residential proxy          | `YTDLP_PROXY`                            |

Cookies + pot-provider is enough from Codespaces today. The proxy slot exists
for when YouTube tightens the check again — it's the only durable answer.

### How the sidecar fits in

`bgutil-ytdlp-pot-provider` is a yt-dlp plugin (installed via
`requirements.txt`) that registers itself as a PO Token provider. When yt-dlp
needs a token for the YouTube extractor, the plugin makes an HTTP request to
the sidecar's `/get_pot` endpoint, the sidecar runs BotGuard against the
provided visitor data, and returns the token.

`main.py` passes the sidecar's URL through to the plugin with:

```python
ydl_opts["extractor_args"]["youtubepot-bgutilhttp"] = {"base_url": [BGUTIL_POT_BASE_URL]}
```

You can verify it's wired up by looking at the foreground compose logs — the
first resolve request should log:

```
[debug] [youtube] [pot] PO Token Providers: bgutil:http-1.3.x (external)
[debug] [youtube] [pot] Fetching ... PO Token via bgutil:http
```

---

## 4. Request lifecycle

```
client                  backend                bgutil-provider       youtube + cdn
  │                        │                         │                   │
  │  POST /resolve {url}   │                         │                   │
  │ ─────────────────────► │                         │                   │
  │                        │  yt-dlp.extract_info(url)                   │
  │                        │  loads cookies, sets extractor_args         │
  │                        │ ──────────────────────────────────────────► │
  │                        │  (HTML, player JS, video metadata)          │
  │                        │ ◄────────────────────────────────────────── │
  │                        │                         │                   │
  │                        │  needs PO token         │                   │
  │                        │ ──────────────────────► │                   │
  │                        │                         │  run BotGuard JS  │
  │                        │  pot, visitor_data      │                   │
  │                        │ ◄────────────────────── │                   │
  │                        │                         │                   │
  │                        │  GVS request with cookies + pot             │
  │                        │ ──────────────────────────────────────────► │
  │                        │  signed direct_url (expires ~6h)            │
  │                        │ ◄────────────────────────────────────────── │
  │                        │                         │                   │
  │  200 JSON              │                         │                   │
  │  { direct_url, ... }   │                         │                   │
  │ ◄───────────────────── │                         │                   │
```

`/stream` follows the same lifecycle but instead of returning the URL, the
backend opens an httpx connection to `direct_url`, forwards range headers, and
streams the bytes back. Clients that can't follow `googlevideo.com` URLs
directly (some embedded players, mobile WebViews with strict CSP) should hit
`/stream`.

---

## 5. API surface — what clients consume

All endpoints accept the API key as `x-api-key`, `Authorization: Bearer`, or
`?api_key=`. CORS is open by default; lock it down with `CORS_ORIGINS`.

| Endpoint                | Use it for                                                |
| ----------------------- | --------------------------------------------------------- |
| `GET /health`           | Sanity check + see which mitigations are active           |
| `POST /resolve`         | Get the direct_url for one watch URL                      |
| `GET  /resolve?url=…`   | Same, GET form (easier from a browser)                    |
| `POST /formats`         | List all available formats so the client can pick one     |
| `GET  /stream?url=…`    | Proxy the bytes through the backend (supports range)      |
| `GET  /search?q=…`      | Search YouTube via yt-dlp's `ytsearch`                    |
| `GET  /channels/...`    | Channel search / channel videos                           |
| `GET  /playlist?url=…`  | Playlist contents                                         |

Resolve response shape (trimmed):

```json
{
  "title": "Charli xcx - Wink Wink (Official Video)",
  "format_id": "18",
  "ext": "mp4",
  "direct_url": "https://rr2---sn-...googlevideo.com/videoplayback?...",
  "expires_at": "2026-06-27T04:44:03Z",
  "headers": { "User-Agent": "...", "Accept": "..." }
}
```

The `headers` field matters: some googlevideo URLs reject requests whose
User-Agent doesn't match the one yt-dlp used to extract them. Pass them through
when you replay the URL on another client.

---

## 6. How each client consumes it

### 6.1 The browser UI (`ui/` → published to `docs/`)

The UI is a static SPA. It's deployed two ways:

- **GitHub Pages from `docs/`** — run `./scripts/sync-ui-docs.sh`, commit
  `docs/`, push. Pages serves it at `https://bara-shaban.github.io/yt-dlp-backend/`.
- **Local dev server** — `node ui/dev-server.mjs`, opens on `:8080`.

The UI calls the backend for `/search`, `/resolve`, `/formats`, and
`/playlist`. You point it at a backend by either:

1. Setting `RESOLVER_URL` in `.env` before building (`scripts/sync-ui-docs.sh`
   bakes config into `docs/config.js`).
2. Passing `?api=https%3A%2F%2Fyour-backend%2Fresolve&apiKey=...` in the URL.
3. Typing the resolver URL and key into the in-page settings view in
   `ui/home.html`.

For Codespaces backends the URL looks like
`https://<codespace>-10000.app.github.dev`. The port has to be set to
**Public** in the Codespaces Ports panel or browsers will get a
`401 www-authenticate: tunnel`.

### 6.2 The Expo mobile app (`mobile/`)

`mobile/App.js` reads `EXPO_PUBLIC_RESOLVER_URL` and
`EXPO_PUBLIC_RESOLVER_API_KEY` at build time, with a hardcoded fallback to the
current Codespaces URL. It uses `expo-video` for playback and AsyncStorage for
queue/history/subscriptions.

To run locally:

```bash
cd mobile
npm install
EXPO_PUBLIC_RESOLVER_URL=https://<your-backend>/resolve \
EXPO_PUBLIC_RESOLVER_API_KEY=<key> \
npx expo start
```

Then either scan the QR code with Expo Go, or build a dev client with EAS
(`eas.json` is checked in).

The mobile app calls `/resolve` directly with `format_id` chosen per item
(short-form vs. full video). It does *not* go through `/stream` — `expo-video`
follows the googlevideo URL itself.

### 6.3 VLC / mpv / direct download

Get the URL once with curl:

```bash
curl -s -X POST http://localhost:10001/resolve \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{"url":"https://www.youtube.com/watch?v=VIDEO_ID","format_id":"18"}' \
  | jq -r '.direct_url'
```

Pipe it into a player or downloader:

```bash
# VLC
vlc "$(curl -s ... | jq -r '.direct_url')"

# mpv
mpv "$(curl -s ... | jq -r '.direct_url')"

# Download
URL=$(curl -s ... | jq -r '.direct_url')
curl -L -o video.mp4 "$URL"
```

URLs expire in ~6 hours. If playback stops mid-stream, re-resolve.

For players that won't follow `googlevideo.com` redirects, use the stream
proxy instead:

```bash
vlc "http://localhost:10001/stream?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DVIDEO_ID&format_id=18&api_key=$API_KEY"
```

`/stream` supports HTTP range requests, so seeking works.

### 6.4 Picking a format

`format_id=18` is the safe default: a single MP4 with audio+video baked in.
It's 360p though. For higher quality YouTube serves video and audio in
separate streams that the client has to mux (DASH/HLS); the backend exposes
that via the `format` selector:

```json
{"url": "...", "format": "best[height<=720][vcodec!=none][acodec!=none]/best"}
```

Use `POST /formats` to see what's available for a given video.

---

## 7. Configuration reference

The full list is in [`RUNBOOK.md`](../RUNBOOK.md). The ones that matter for the
bot-check workflow:

| Env var                  | What it does                                                |
| ------------------------ | ----------------------------------------------------------- |
| `YTDLP_COOKIES_BASE64`   | Netscape cookies, base64-encoded. Source of session auth.   |
| `BGUTIL_POT_BASE_URL`    | URL of the bgutil sidecar. Compose sets this automatically. |
| `BGUTIL_TOKEN_TTL`       | Hours to cache PO tokens (default 6).                       |
| `YTDLP_PROXY`            | Optional residential proxy URL.                             |
| `YTDLP_YT_PLAYER_CLIENT` | Override which YouTube clients yt-dlp impersonates.         |
| `API_KEY`                | Shared secret required on every request.                    |
| `CORS_ORIGINS`           | Comma-separated allowlist. Default `*`.                     |

Check what's live with `GET /health`:

```json
{
  "cookies": "configured",
  "cookie_file": { "state": "configured", "rows": 21 },
  "pot_provider": "http://bgutil-provider:4416",
  "proxy": "disabled"
}
```

---

## 8. Failure modes & where to look

| Symptom                                                  | Likely cause                                             | First thing to check                                   |
| -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| `Sign in to confirm you're not a bot`                    | Cookies stale or sidecar not reachable                   | `/health` → are `cookies` and `pot_provider` both set? |
| `cookies: disabled` in health                            | Secret not exported into the shell                       | `echo "${YTDLP_COOKIES_BASE64:+set}"`                  |
| `cookies: configured` but `rows: 14` (or any stale count) | Older `YTDLP_COOKIES_TEXT` secret still set, taking precedence | `gh secret list --app codespaces`                  |
| `pot_provider: disabled`                                 | Started backend without compose, or sidecar didn't come up | `docker compose ps`                                  |
| `direct_url` returns 403 when played                     | Replaying without the matching User-Agent header         | Pass back the `headers` block from the response        |
| `401 www-authenticate: tunnel` from Codespaces           | Forwarded port is private                                | Set port 10000 to Public in the Ports panel            |
| Container builds but `bgutil-provider` keeps restarting  | Node version drift, upstream image change                | `docker compose logs bgutil-provider`                  |

---

## 9. Why this stack (and not the alternatives)

- **Why a sidecar instead of baking BotGuard into the backend?** BotGuard
  changes frequently. Pulling the upstream image keeps you current without
  rebuilding the backend, and a crash in the JS runtime can't take down
  FastAPI.

- **Why HTTP-server pot-provider instead of script mode?** The HTTP server
  caches tokens across requests. Script mode spawns a Node subprocess per
  call, which is slow under load and gives YouTube a fresh fingerprint each
  time (worse, not better).

- **Why FastAPI?** yt-dlp is sync-and-blocking; FastAPI's threadpool +
  semaphore (`MAX_CONCURRENT_REQUESTS`) gives a clean way to cap concurrency
  without rewriting yt-dlp.

- **Why ship the UI separately on Pages?** The UI is fully static and the
  backend's CORS allows it. Hosting them apart means the backend can move
  (Codespaces → home server → VPS) without breaking the public URL.

---

## 10. Where the important code lives

- `main.py` — the entire FastAPI app. `base_ytdlp_opts()` is where cookies,
  proxy, player_client, po_token, and the bgutil URL all get wired into
  yt-dlp's options dict.
- `Dockerfile` — Python 3.12 image with a copy of the Node binary from
  `node:24-bookworm-slim` (used by yt-dlp's player JS evaluation).
- `docker-compose.yml` — backend + sidecar, shared private network.
- `scripts/run-stack-docker.sh` — guarded compose-up entrypoint.
- `scripts/encode-cookies-base64.sh` — turns a `cookies.txt` into the secret
  value.
- `ui/` — static frontend, mirrored into `docs/` for Pages.
- `mobile/` — Expo client.
