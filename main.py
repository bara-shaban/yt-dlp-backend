import asyncio
import base64
import ipaddress
import os
import re
import socket
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urljoin, urlparse

import httpx
import yt_dlp
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from yt_dlp.utils import DownloadError, ExtractorError
from yt_dlp.version import __version__ as YT_DLP_VERSION


def env_int(name: str, default: int, minimum: int | None = None) -> int:
    value = os.getenv(name)
    if value is None:
        return default

    try:
        parsed = int(value)
    except ValueError:
        return default

    return max(minimum, parsed) if minimum is not None else parsed


def env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def env_first(*names: str) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value
    return None


def env_first_pair(*names: str) -> tuple[str, str] | tuple[None, None]:
    for name in names:
        value = os.getenv(name)
        if value:
            return name, value
    return None, None


def load_env_file() -> None:
    env_path = Path(os.getenv("ENV_FILE", ".env"))
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[7:].strip()
        if not key or key in os.environ:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        os.environ[key] = value


NETSCAPE_COOKIE_HEADER = "# Netscape HTTP Cookie File"


def looks_like_netscape_cookies(value: str) -> bool:
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    if not lines:
        return False
    if any(line.startswith(NETSCAPE_COOKIE_HEADER) for line in lines):
        return True
    return any(
        not line.startswith("#") and len(line.split()) >= 7
        for line in lines
    )


def normalize_netscape_cookies(cookie_text: str, source_name: str) -> str:
    normalized_lines: list[str] = []
    has_header = False
    has_cookie = False

    for line_number, raw_line in enumerate(cookie_text.replace("\r\n", "\n").replace("\r", "\n").split("\n"), 1):
        stripped = raw_line.strip()
        if not stripped:
            continue
        if stripped.startswith("#"):
            has_header = has_header or stripped.startswith(NETSCAPE_COOKIE_HEADER)
            normalized_lines.append(stripped)
            continue

        parts = raw_line.rstrip("\n").split("\t")
        if len(parts) < 7:
            parts = stripped.split(None, 6)
        if len(parts) > 7:
            parts = parts[:6] + ["\t".join(parts[6:])]
        if len(parts) != 7:
            raise RuntimeError(
                f"{source_name} line {line_number} is not a Netscape cookie row. "
                "Expected 7 columns: domain, include_subdomains, path, secure, expires, name, value."
            )

        domain, include_subdomains, path, secure, expires, name, value = [
            part.strip() for part in parts[:6]
        ] + [parts[6].strip()]
        include_subdomains = include_subdomains.upper()
        secure = secure.upper()
        if include_subdomains not in {"TRUE", "FALSE"} or secure not in {"TRUE", "FALSE"}:
            raise RuntimeError(
                f"{source_name} line {line_number} is not a Netscape cookie row. "
                "Columns 2 and 4 must be TRUE or FALSE."
            )
        if not domain or not path or not expires or not name:
            raise RuntimeError(
                f"{source_name} line {line_number} is not a Netscape cookie row. "
                "Domain, path, expires, and name are required."
            )
        if not expires.isdigit():
            raise RuntimeError(
                f"{source_name} line {line_number} is not a Netscape cookie row. "
                "Column 5 must be a numeric expiration timestamp."
            )

        normalized_lines.append("\t".join([domain, include_subdomains, path, secure, expires, name, value]))
        has_cookie = True

    if not has_cookie:
        raise RuntimeError(f"{source_name} does not contain any usable Netscape cookie rows.")
    if not has_header:
        normalized_lines.insert(0, NETSCAPE_COOKIE_HEADER)

    return "\n".join(normalized_lines).rstrip() + "\n"


def count_netscape_cookie_rows(cookie_text: str) -> int:
    return sum(
        1
        for line in cookie_text.splitlines()
        if line.strip() and not line.lstrip().startswith("#") and len(line.split("\t")) >= 7
    )


def init_cookie_file() -> str | None:
    cookie_file_name, cookie_file = env_first_pair("YTDLP_COOKIES_FILE", "YOUTUBE_COOKIES_FILE")
    if cookie_file:
        source_path = Path(cookie_file)
        if not source_path.exists():
            raise RuntimeError(f"{cookie_file_name} points to a missing cookies file: {source_path}")
        cookie_path = Path(os.getenv("YTDLP_COOKIES_PATH", "/tmp/yt-dlp-cookies.txt"))
        cookie_text = normalize_netscape_cookies(source_path.read_text(encoding="utf-8"), str(source_path))
        cookie_path.write_text(cookie_text, encoding="utf-8")
        cookie_path.chmod(0o600)
        return str(cookie_path)

    cookie_text_name, cookie_text = env_first_pair("YTDLP_COOKIES_TEXT", "YOUTUBE_COOKIES_TEXT")
    cookie_base64_name, cookie_base64 = env_first_pair("YTDLP_COOKIES_BASE64", "YOUTUBE_COOKIES_BASE64")
    if not cookie_text and not cookie_base64:
        return None

    cookie_source_name = cookie_text_name or cookie_base64_name or "cookie secret"
    if cookie_base64:
        try:
            cookie_text = base64.b64decode(cookie_base64.strip(), validate=True).decode("utf-8")
        except Exception as exc:
            if looks_like_netscape_cookies(cookie_base64):
                cookie_text = cookie_base64
            else:
                raise RuntimeError(
                    f"{cookie_base64_name} must be base64-encoded UTF-8 Netscape cookies text. "
                    "Generate it with: base64 -w0 cookies.txt, or put raw cookies in YTDLP_COOKIES_TEXT."
                ) from exc
        cookie_source_name = cookie_base64_name or cookie_source_name

    cookie_path = Path(os.getenv("YTDLP_COOKIES_PATH", "/tmp/yt-dlp-cookies.txt"))
    cookie_path.write_text(normalize_netscape_cookies(cookie_text or "", cookie_source_name), encoding="utf-8")
    cookie_path.chmod(0o600)
    return str(cookie_path)


def cookie_file_status(cookie_file: str | None) -> dict[str, Any]:
    if not cookie_file:
        return {"state": "disabled", "rows": 0}
    try:
        cookie_text = Path(cookie_file).read_text(encoding="utf-8")
    except OSError:
        return {"state": "missing", "rows": 0}

    rows = count_netscape_cookie_rows(cookie_text)
    first_line = next((line.strip() for line in cookie_text.splitlines() if line.strip()), "")
    if rows <= 0:
        return {"state": "invalid", "rows": 0}
    if not first_line.startswith(NETSCAPE_COOKIE_HEADER):
        return {"state": "missing-header", "rows": rows}
    return {"state": "configured", "rows": rows}


load_env_file()

APP_NAME = "yt-dlp media URL resolver"
DEFAULT_FORMAT = os.getenv(
    "DEFAULT_FORMAT",
    "best[ext=mp4][vcodec!=none][acodec!=none]/best[vcodec!=none][acodec!=none]/best",
)
API_KEY = os.getenv("API_KEY")
CORS_ORIGINS = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "*").split(",") if origin.strip()]
YTDLP_COOKIES_FILE = init_cookie_file()
YTDLP_JS_RUNTIMES = [item.strip() for item in os.getenv("YTDLP_JS_RUNTIMES", "node").split(",") if item.strip()]
YTDLP_REMOTE_COMPONENTS = [
    item.strip()
    for item in os.getenv("YTDLP_REMOTE_COMPONENTS", "ejs:github").split(",")
    if item.strip()
]
REQUEST_TIMEOUT_SECONDS = env_int("REQUEST_TIMEOUT_SECONDS", 90, minimum=1)
SOCKET_TIMEOUT_SECONDS = env_int("SOCKET_TIMEOUT_SECONDS", 20, minimum=1)
STREAM_TIMEOUT_SECONDS = env_int("STREAM_TIMEOUT_SECONDS", 30, minimum=1)
EMBED_PAGE_TIMEOUT_SECONDS = env_int("EMBED_PAGE_TIMEOUT_SECONDS", 15, minimum=1)
EMBED_PAGE_MAX_BYTES = env_int("EMBED_PAGE_MAX_BYTES", 2_000_000, minimum=10_000)
MAX_EMBED_CANDIDATES = env_int("MAX_EMBED_CANDIDATES", 8, minimum=1)
MAX_CONCURRENT_REQUESTS = env_int("MAX_CONCURRENT_REQUESTS", 2, minimum=1)
MAX_SEARCH_RESULTS = env_int("MAX_SEARCH_RESULTS", 15, minimum=1)
MAX_CHANNEL_SEARCH_RESULTS = env_int("MAX_CHANNEL_SEARCH_RESULTS", 12, minimum=1)
MAX_CHANNEL_VIDEO_RESULTS = env_int("MAX_CHANNEL_VIDEO_RESULTS", 18, minimum=1)
MAX_PLAYLIST_RESULTS = env_int("MAX_PLAYLIST_RESULTS", 50, minimum=1)
SHORTS_MAX_SECONDS = env_int("SHORTS_MAX_SECONDS", 180, minimum=1)
SHORTS_LEGACY_MAX_SECONDS = env_int("SHORTS_LEGACY_MAX_SECONDS", 65, minimum=1)
EMBED_FALLBACK_PARALLELISM = env_int("EMBED_FALLBACK_PARALLELISM", 3, minimum=1)
ALLOW_PRIVATE_URLS = env_bool("ALLOW_PRIVATE_URLS")
ENABLE_EMBED_FALLBACK = env_bool("ENABLE_EMBED_FALLBACK", True)
DEFAULT_USER_AGENT = os.getenv(
    "DEFAULT_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
)

ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
YOUTUBE_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
SHORTS_TAG_RE = re.compile(r"(^|\W)#shorts?\b", re.IGNORECASE)
ABSOLUTE_MEDIA_URL_RE = re.compile(
    r"https?:\\?/\\?/[^\s\"'<>]+?\.(?:m3u8|mpd|mp4|m4v|webm|mov|mp3|m4a|aac)(?:\?[^\s\"'<>]*)?",
    re.IGNORECASE,
)
MEDIA_PATH_RE = re.compile(r"\.(?:m3u8|mpd|mp4|m4v|webm|mov|mp3|m4a|aac)(?:[?#]|$)", re.IGNORECASE)
EMBED_ATTRS = ("src", "data-src", "data-url", "data-file", "data-hls", "data-mp4", "href")
EMBED_INFO_KEY = "__yt_dlp_api_embed"
FORMAT_SELECTOR_INFO_KEY = "__yt_dlp_api_format_selector"
FORMAT_FALLBACK_INFO_KEY = "__yt_dlp_api_format_fallback"
SENSITIVE_HEADERS = {"authorization", "cookie", "x-api-key"}

extractor_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

app = FastAPI(
    title=APP_NAME,
    description="Resolve a supported page URL into yt-dlp's temporary direct media URL.",
    version="0.1.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["accept-ranges", "content-length", "content-range", "content-type"],
    max_age=86400,
)


class ResolveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(..., min_length=8, max_length=4096)
    format: str | None = Field(default=None, min_length=1, max_length=300)
    video_format: str | None = Field(default=None, min_length=1, max_length=300)
    format_id: str | None = Field(default=None, min_length=1, max_length=100)
    user_agent: str | None = Field(default=None, min_length=1, max_length=500)
    referer: str | None = Field(default=None, min_length=1, max_length=4096)
    include_formats: bool = False

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("url must be an absolute http or https URL")
        return value

    @model_validator(mode="after")
    def validate_format_aliases(self) -> "ResolveRequest":
        selectors = [self.format, self.video_format, self.format_id]
        distinct_selectors = {selector for selector in selectors if selector}
        if len(distinct_selectors) > 1:
            raise ValueError("Use only one of format, video_format, or format_id")
        return self

    @property
    def format_selector(self) -> str:
        return self.format or self.video_format or self.format_id or DEFAULT_FORMAT

    @property
    def has_custom_format_selector(self) -> bool:
        return bool(self.format or self.video_format or self.format_id)

    def with_default_format_selector(self) -> "ResolveRequest":
        return self.model_copy(update={"format": DEFAULT_FORMAT, "video_format": None, "format_id": None})


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(..., min_length=1, max_length=300)
    limit: int = Field(default=12, ge=1, le=50)


class ChannelVideosRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(..., min_length=8, max_length=4096)
    limit: int = Field(default=12, ge=1, le=50)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("url must be an absolute http or https URL")
        return value


class PlaylistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    url: str = Field(..., min_length=8, max_length=4096)
    limit: int = Field(default=25, ge=1, le=100)

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("url must be an absolute http or https URL")
        return value


async def require_api_key(request: Request) -> None:
    if not API_KEY:
        return

    authorization = request.headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    bearer_token = token.strip() if scheme.lower() == "bearer" else ""
    header_key = request.headers.get("x-api-key")
    query_key = request.query_params.get("api_key")

    if API_KEY not in {bearer_token, header_key, query_key}:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid API key",
        )


@app.get("/")
def root() -> dict[str, Any]:
    return {
        "service": APP_NAME,
        "status": "ok",
        "auth": "enabled" if API_KEY else "disabled",
        "endpoints": {
            "health": "/health",
            "resolve": "POST /resolve or GET /resolve?url=...",
            "formats": "POST /formats or GET /formats?url=...",
            "search": "GET /search?q=...",
            "channels_search": "GET /channels/search?q=...",
            "channels_videos": "GET /channels/videos?url=...",
            "playlist": "GET /playlist?url=...",
            "stream": "GET /stream?url=...",
            "docs": "/docs",
        },
    }


@app.get("/health")
def health() -> dict[str, Any]:
    cookie_status = cookie_file_status(YTDLP_COOKIES_FILE)
    return {
        "ok": True,
        "yt_dlp_version": YT_DLP_VERSION,
        "cookies": cookie_status["state"],
        "cookie_file": cookie_status,
        "js_runtimes": YTDLP_JS_RUNTIMES,
        "remote_components": YTDLP_REMOTE_COMPONENTS,
        "embed_fallback": "enabled" if ENABLE_EMBED_FALLBACK else "disabled",
        "max_embed_candidates": MAX_EMBED_CANDIDATES,
    }


@app.post("/resolve", dependencies=[Depends(require_api_key)])
async def resolve_post(payload: ResolveRequest) -> dict[str, Any]:
    return await resolve_media_url(payload)


@app.get("/resolve", dependencies=[Depends(require_api_key)])
async def resolve_get(
    url: str = Query(..., min_length=8, max_length=4096),
    format: str | None = Query(default=None, min_length=1, max_length=300),
    video_format: str | None = Query(default=None, min_length=1, max_length=300),
    format_id: str | None = Query(default=None, min_length=1, max_length=100),
    user_agent: str | None = Query(default=None, min_length=1, max_length=500),
    referer: str | None = Query(default=None, min_length=1, max_length=4096),
    include_formats: bool = Query(default=False),
) -> dict[str, Any]:
    payload = ResolveRequest(
        url=url,
        format=format,
        video_format=video_format,
        format_id=format_id,
        user_agent=user_agent,
        referer=referer,
        include_formats=include_formats,
    )
    return await resolve_media_url(payload)


@app.post("/formats", dependencies=[Depends(require_api_key)])
async def formats_post(payload: ResolveRequest) -> dict[str, Any]:
    response = await resolve_media_url(payload.model_copy(update={"include_formats": True}))
    return {
        "source_url": response.get("source_url"),
        "title": response.get("title"),
        "extractor": response.get("extractor"),
        "formats": response.get("formats", []),
    }


@app.get("/formats", dependencies=[Depends(require_api_key)])
async def formats_get(
    url: str = Query(..., min_length=8, max_length=4096),
    user_agent: str | None = Query(default=None, min_length=1, max_length=500),
    referer: str | None = Query(default=None, min_length=1, max_length=4096),
) -> dict[str, Any]:
    payload = ResolveRequest(
        url=url,
        user_agent=user_agent,
        referer=referer,
        include_formats=True,
    )
    return await formats_post(payload)


@app.post("/search", dependencies=[Depends(require_api_key)])
async def search_post(payload: SearchRequest) -> dict[str, Any]:
    return await search_youtube(payload.query, payload.limit)


@app.get("/search", dependencies=[Depends(require_api_key)])
async def search_get(
    q: str = Query(..., min_length=1, max_length=300),
    limit: int = Query(default=12, ge=1, le=50),
) -> dict[str, Any]:
    return await search_youtube(q, limit)


@app.post("/channels/search", dependencies=[Depends(require_api_key)])
async def channels_search_post(payload: SearchRequest) -> dict[str, Any]:
    return await search_channels(payload.query, payload.limit)


@app.get("/channels/search", dependencies=[Depends(require_api_key)])
async def channels_search_get(
    q: str = Query(..., min_length=1, max_length=300),
    limit: int = Query(default=8, ge=1, le=50),
) -> dict[str, Any]:
    return await search_channels(q, limit)


@app.post("/channels/videos", dependencies=[Depends(require_api_key)])
async def channels_videos_post(payload: ChannelVideosRequest) -> dict[str, Any]:
    return await channel_videos(payload.url, payload.limit)


@app.get("/channels/videos", dependencies=[Depends(require_api_key)])
async def channels_videos_get(
    url: str = Query(..., min_length=8, max_length=4096),
    limit: int = Query(default=12, ge=1, le=50),
) -> dict[str, Any]:
    payload = ChannelVideosRequest(url=url, limit=limit)
    return await channel_videos(payload.url, payload.limit)


@app.post("/playlist", dependencies=[Depends(require_api_key)])
async def playlist_post(payload: PlaylistRequest) -> dict[str, Any]:
    return await playlist_videos(payload.url, payload.limit)


@app.get("/playlist", dependencies=[Depends(require_api_key)])
async def playlist_get(
    url: str = Query(..., min_length=8, max_length=4096),
    limit: int = Query(default=25, ge=1, le=100),
) -> dict[str, Any]:
    payload = PlaylistRequest(url=url, limit=limit)
    return await playlist_videos(payload.url, payload.limit)


@app.get("/stream", dependencies=[Depends(require_api_key)])
async def stream_get(
    request: Request,
    url: str = Query(..., min_length=8, max_length=4096),
    format: str | None = Query(default=None, min_length=1, max_length=300),
    video_format: str | None = Query(default=None, min_length=1, max_length=300),
    format_id: str | None = Query(default=None, min_length=1, max_length=100),
    user_agent: str | None = Query(default=None, min_length=1, max_length=500),
    referer: str | None = Query(default=None, min_length=1, max_length=4096),
) -> StreamingResponse:
    payload = ResolveRequest(
        url=url,
        format=format,
        video_format=video_format,
        format_id=format_id,
        user_agent=user_agent,
        referer=referer,
    )
    info = await extract_info_async(payload)
    result = first_media_result(info)
    media_url = result.get("url")

    if not media_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Selected format does not resolve to one playable stream. Try format_id 18 or best[height<=720]/best.",
        )

    upstream_headers = proxy_request_headers(result.get("http_headers") or info.get("http_headers") or {})
    if request.headers.get("range"):
        upstream_headers["Range"] = request.headers["range"]

    return await proxy_stream(media_url, upstream_headers)


async def resolve_media_url(payload: ResolveRequest) -> dict[str, Any]:
    info = await extract_info_async(payload)
    return build_response(payload.url, info, payload.include_formats, payload.format_selector)


async def search_youtube(query: str, limit: int) -> dict[str, Any]:
    result_limit = min(limit, MAX_SEARCH_RESULTS)
    source_limit = min(max(result_limit * 3, result_limit), 50)
    try:
        async with extractor_semaphore:
            info = await asyncio.wait_for(
                asyncio.to_thread(extract_search_results, query, source_limit),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"yt-dlp search timed out after {REQUEST_TIMEOUT_SECONDS} seconds",
        ) from exc
    except (DownloadError, ExtractorError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=clean_error(str(exc)),
        ) from exc

    entries = [entry for entry in info.get("entries") or [] if isinstance(entry, dict)]
    return {
        "query": query,
        "limit": result_limit,
        "results": [video for video in (search_result_from_entry(entry) for entry in entries) if video][
            :result_limit
        ],
    }


async def search_channels(query: str, limit: int) -> dict[str, Any]:
    result_limit = min(limit, MAX_CHANNEL_SEARCH_RESULTS)
    source_limit = min(max(result_limit * 4, result_limit), 50)
    try:
        async with extractor_semaphore:
            info = await asyncio.wait_for(
                asyncio.to_thread(extract_search_results, query, source_limit),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"yt-dlp channel search timed out after {REQUEST_TIMEOUT_SECONDS} seconds",
        ) from exc
    except (DownloadError, ExtractorError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=clean_error(str(exc)),
        ) from exc

    channels = []
    seen_urls = set()
    for entry in (entry for entry in info.get("entries") or [] if isinstance(entry, dict)):
        channel = channel_result_from_entry(entry)
        if not channel:
            continue
        key = channel["url"].rstrip("/")
        if key in seen_urls:
            continue
        seen_urls.add(key)
        channels.append(channel)
        if len(channels) >= result_limit:
            break

    return {
        "query": query,
        "limit": result_limit,
        "results": channels,
    }


async def channel_videos(channel_url: str, limit: int) -> dict[str, Any]:
    if not ALLOW_PRIVATE_URLS:
        validate_public_url(channel_url)

    result_limit = min(limit, MAX_CHANNEL_VIDEO_RESULTS)
    videos_url = channel_videos_url(channel_url)
    try:
        async with extractor_semaphore:
            info = await asyncio.wait_for(
                asyncio.to_thread(extract_channel_videos, videos_url, result_limit),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"yt-dlp channel videos timed out after {REQUEST_TIMEOUT_SECONDS} seconds",
        ) from exc
    except (DownloadError, ExtractorError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=clean_error(str(exc)),
        ) from exc

    entries = [entry for entry in info.get("entries") or [] if isinstance(entry, dict)]
    return {
        "channel": compact(
            {
                "id": info.get("channel_id") or info.get("id"),
                "title": info.get("channel") or info.get("uploader") or info.get("title"),
                "url": channel_url,
                "videos_url": videos_url,
                "thumbnail": best_thumbnail(info),
            }
        ),
        "limit": result_limit,
        "results": [video for video in (search_result_from_entry(entry) for entry in entries) if video],
    }


async def playlist_videos(playlist_url: str, limit: int) -> dict[str, Any]:
    if not ALLOW_PRIVATE_URLS:
        validate_public_url(playlist_url)

    result_limit = min(limit, MAX_PLAYLIST_RESULTS)
    try:
        async with extractor_semaphore:
            info = await asyncio.wait_for(
                asyncio.to_thread(extract_playlist, playlist_url, result_limit),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=f"yt-dlp playlist timed out after {REQUEST_TIMEOUT_SECONDS} seconds",
        ) from exc
    except (DownloadError, ExtractorError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=clean_error(str(exc)),
        ) from exc

    entries = [entry for entry in info.get("entries") or [] if isinstance(entry, dict)]
    return {
        "playlist": playlist_result_from_info(info, playlist_url),
        "limit": result_limit,
        "results": [video for video in (search_result_from_entry(entry) for entry in entries) if video],
    }


async def extract_info_async(payload: ResolveRequest) -> dict[str, Any]:
    primary_error: asyncio.TimeoutError | DownloadError | ExtractorError | ValueError | None = None
    active_payload = payload
    format_fallback_detail: str | None = None
    try:
        info = await extract_info_once(payload)
        return annotate_format_result(info, payload.format_selector)
    except (asyncio.TimeoutError, DownloadError, ExtractorError, ValueError) as exc:
        primary_error = exc

        if payload.has_custom_format_selector:
            active_payload = payload.with_default_format_selector()
            format_fallback_detail = f"selected format failed; retried Auto: {clean_extraction_error(exc)}"
            try:
                info = await extract_info_once(active_payload)
                return annotate_format_result(
                    info,
                    active_payload.format_selector,
                    fallback={
                        "requested": payload.format_selector,
                        "used": active_payload.format_selector,
                        "reason": clean_extraction_error(exc),
                    },
                )
            except (asyncio.TimeoutError, DownloadError, ExtractorError, ValueError) as fallback_exc:
                primary_error = fallback_exc

        if not ENABLE_EMBED_FALLBACK:
            raise extraction_http_exception(primary_error, fallback_detail=format_fallback_detail) from primary_error

    assert primary_error is not None

    try:
        candidates = await discover_embed_candidates(active_payload)
    except ValueError as discovery_error:
        detail = join_details(format_fallback_detail, str(discovery_error))
        raise extraction_http_exception(primary_error, fallback_detail=detail) from primary_error
    except httpx.HTTPError as discovery_error:
        detail = join_details(format_fallback_detail, f"embed fallback page fetch failed: {discovery_error}")
        raise extraction_http_exception(primary_error, fallback_detail=detail) from primary_error

    fallback_errors = []
    for candidate in candidates:
        try:
            info = await extract_info_once(payload_for_embed_candidate(active_payload, candidate))
        except (asyncio.TimeoutError, DownloadError, ExtractorError, ValueError) as candidate_error:
            fallback_errors.append(f"{candidate['kind']} {candidate['url']}: {clean_extraction_error(candidate_error)}")
            continue

        info[EMBED_INFO_KEY] = candidate
        return annotate_format_result(info, active_payload.format_selector)

    fallback_detail = "embed fallback found no candidate URLs"
    if fallback_errors:
        visible_errors = "; ".join(fallback_errors[:3])
        fallback_detail = f"embed fallback tried {len(fallback_errors)} candidate(s): {visible_errors}"
    fallback_detail = join_details(format_fallback_detail, fallback_detail)
    raise extraction_http_exception(primary_error, fallback_detail=fallback_detail) from primary_error


def annotate_format_result(
    info: dict[str, Any],
    format_selector: str,
    fallback: dict[str, str] | None = None,
) -> dict[str, Any]:
    info[FORMAT_SELECTOR_INFO_KEY] = format_selector
    if fallback:
        info[FORMAT_FALLBACK_INFO_KEY] = fallback
    return info


def join_details(*details: str | None) -> str | None:
    visible = [detail for detail in details if detail]
    return "; ".join(visible) if visible else None


async def extract_info_once(payload: ResolveRequest) -> dict[str, Any]:
    if not ALLOW_PRIVATE_URLS:
        validate_public_url(payload.url)

    async with extractor_semaphore:
        return await asyncio.wait_for(
            asyncio.to_thread(extract_with_ytdlp, payload),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )


async def discover_embed_candidates(payload: ResolveRequest) -> list[dict[str, str]]:
    if not ALLOW_PRIVATE_URLS:
        validate_public_url(payload.url)

    timeout = httpx.Timeout(
        connect=SOCKET_TIMEOUT_SECONDS,
        read=EMBED_PAGE_TIMEOUT_SECONDS,
        write=SOCKET_TIMEOUT_SECONDS,
        pool=SOCKET_TIMEOUT_SECONDS,
    )
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": payload.user_agent or DEFAULT_USER_AGENT,
    }
    if payload.referer:
        headers["Referer"] = payload.referer

    async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
        async with client.stream("GET", payload.url, headers=headers) as response:
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            if content_type and not any(
                allowed in content_type for allowed in ("text/html", "application/xhtml", "application/xml", "text/plain")
            ):
                return []

            chunks = []
            total = 0
            async for chunk in response.aiter_bytes():
                if total >= EMBED_PAGE_MAX_BYTES:
                    break
                remaining = EMBED_PAGE_MAX_BYTES - total
                chunks.append(chunk[:remaining])
                total += min(len(chunk), remaining)

            base_url = str(response.url)
            encoding = response.encoding or "utf-8"

    html = b"".join(chunks).decode(encoding, errors="replace")
    candidates = extract_embed_candidates_from_html(html, base_url)
    filtered_candidates = []
    original_url = normalized_url_without_fragment(payload.url)
    seen = {original_url}

    for candidate in candidates:
        candidate_url = normalized_url_without_fragment(candidate["url"])
        if candidate_url in seen:
            continue
        seen.add(candidate_url)
        if not ALLOW_PRIVATE_URLS:
            validate_public_url(candidate_url)
        filtered_candidates.append({**candidate, "url": candidate_url})
        if len(filtered_candidates) >= MAX_EMBED_CANDIDATES:
            break

    return filtered_candidates


def extract_embed_candidates_from_html(html: str, base_url: str) -> list[dict[str, str]]:
    parser = EmbedCandidateParser(base_url)
    parser.feed(html)

    for match in ABSOLUTE_MEDIA_URL_RE.finditer(html):
        parser.add_candidate(match.group(0), "media-url")

    return parser.candidates


class EmbedCandidateParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.candidates: list[dict[str, str]] = []
        self.seen: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        attr_map = {name.lower(): value for name, value in attrs if value}

        if normalized_tag in {"iframe", "embed"}:
            for attr in ("src", "data-src", "data-url"):
                self.add_candidate(attr_map.get(attr), f"{normalized_tag}:{attr}")

        if normalized_tag in {"video", "audio", "source"}:
            for attr in ("src", "data-src"):
                self.add_candidate(attr_map.get(attr), f"{normalized_tag}:{attr}")

        for attr in EMBED_ATTRS:
            value = attr_map.get(attr)
            if value and looks_like_media_url(value):
                self.add_candidate(value, f"{normalized_tag}:{attr}")

    def add_candidate(self, value: str | None, kind: str) -> None:
        candidate_url = normalize_candidate_url(value, self.base_url)
        if not candidate_url or candidate_url in self.seen:
            return
        self.seen.add(candidate_url)
        self.candidates.append({"url": candidate_url, "kind": kind, "source_url": self.base_url})


def payload_for_embed_candidate(payload: ResolveRequest, candidate: dict[str, str]) -> ResolveRequest:
    return payload.model_copy(
        update={
            "url": candidate["url"],
            "referer": payload.referer or candidate.get("source_url") or payload.url,
            "user_agent": payload.user_agent or DEFAULT_USER_AGENT,
        }
    )


def normalize_candidate_url(value: str | None, base_url: str) -> str | None:
    if not value:
        return None

    candidate = unescape(value).strip().strip("\"'")
    candidate = candidate.replace("\\/", "/").replace("\\u0026", "&")
    absolute_url = urljoin(base_url, candidate)
    parsed = urlparse(absolute_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return parsed._replace(fragment="").geturl()


def looks_like_media_url(value: str) -> bool:
    return bool(MEDIA_PATH_RE.search(value.replace("\\/", "/")))


def normalized_url_without_fragment(value: str) -> str:
    parsed = urlparse(value)
    return parsed._replace(fragment="").geturl()


def extraction_http_exception(
    exc: asyncio.TimeoutError | DownloadError | ExtractorError | ValueError,
    fallback_detail: str | None = None,
) -> HTTPException:
    detail = clean_extraction_error(exc)
    if fallback_detail:
        detail = f"{detail}; {fallback_detail}"

    if isinstance(exc, asyncio.TimeoutError):
        return HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail=detail,
        )
    if isinstance(exc, (DownloadError, ExtractorError)):
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=detail,
        )
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def clean_extraction_error(exc: asyncio.TimeoutError | DownloadError | ExtractorError | ValueError) -> str:
    if isinstance(exc, asyncio.TimeoutError):
        return f"yt-dlp timed out after {REQUEST_TIMEOUT_SECONDS} seconds"
    if isinstance(exc, (DownloadError, ExtractorError)):
        return clean_error(str(exc))
    return str(exc)


def base_ytdlp_opts() -> dict[str, Any]:
    ydl_opts: dict[str, Any] = {
        "cachedir": False,
        "no_warnings": True,
        "quiet": True,
        "skip_download": True,
        "socket_timeout": SOCKET_TIMEOUT_SECONDS,
    }
    if YTDLP_COOKIES_FILE:
        ydl_opts["cookiefile"] = YTDLP_COOKIES_FILE
    if YTDLP_JS_RUNTIMES:
        ydl_opts["js_runtimes"] = {runtime: {} for runtime in YTDLP_JS_RUNTIMES}
    if YTDLP_REMOTE_COMPONENTS:
        ydl_opts["remote_components"] = set(YTDLP_REMOTE_COMPONENTS)
    return ydl_opts


def extract_with_ytdlp(payload: ResolveRequest) -> dict[str, Any]:
    http_headers = {}
    if payload.user_agent:
        http_headers["User-Agent"] = payload.user_agent
    if payload.referer:
        http_headers["Referer"] = payload.referer

    ydl_opts = base_ytdlp_opts()
    ydl_opts.update(
        {
            "format": payload.format_selector,
            "noplaylist": True,
        }
    )
    if http_headers:
        ydl_opts["http_headers"] = http_headers

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(payload.url, download=False)

    if not isinstance(info, dict):
        raise ValueError("yt-dlp did not return media information")
    return info


def extract_search_results(query: str, limit: int) -> dict[str, Any]:
    ydl_opts = base_ytdlp_opts()
    ydl_opts.update(
        {
            "extract_flat": "in_playlist",
            "noplaylist": False,
        }
    )

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)

    if not isinstance(info, dict):
        raise ValueError("yt-dlp did not return search results")
    return info


def extract_channel_videos(channel_url: str, limit: int) -> dict[str, Any]:
    ydl_opts = base_ytdlp_opts()
    ydl_opts.update(
        {
            "extract_flat": "in_playlist",
            "noplaylist": False,
            "playlistend": limit,
        }
    )

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(channel_url, download=False)

    if not isinstance(info, dict):
        raise ValueError("yt-dlp did not return channel videos")
    return info


def extract_playlist(playlist_url: str, limit: int) -> dict[str, Any]:
    ydl_opts = base_ytdlp_opts()
    ydl_opts.update(
        {
            "extract_flat": "in_playlist",
            "noplaylist": False,
            "playlistend": limit,
        }
    )

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(playlist_url, download=False)

    if not isinstance(info, dict):
        raise ValueError("yt-dlp did not return playlist videos")
    return info


def build_response(
    source_url: str,
    info: dict[str, Any],
    include_formats: bool,
    requested_format_selector: str,
) -> dict[str, Any]:
    result = first_media_result(info)
    embed_source = info.get(EMBED_INFO_KEY) if isinstance(info.get(EMBED_INFO_KEY), dict) else None
    format_selector = info.get(FORMAT_SELECTOR_INFO_KEY) or requested_format_selector
    format_fallback = info.get(FORMAT_FALLBACK_INFO_KEY)
    if not isinstance(format_fallback, dict):
        format_fallback = None
    direct_url = result.get("url")
    requested_streams = [
        stream
        for stream in (stream_from_format(fmt) for fmt in result.get("requested_formats") or [])
        if stream
    ]

    if not direct_url and len(requested_streams) == 1:
        direct_url = requested_streams[0]["url"]

    response = compact(
        {
            "source_url": source_url,
            "resolved_from_url": embed_source.get("url") if embed_source else None,
            "resolved_from_kind": embed_source.get("kind") if embed_source else None,
            "requested_format_selector": format_selector,
            "format_fallback": format_fallback,
            "id": result.get("id"),
            "title": result.get("title"),
            "extractor": result.get("extractor_key") or result.get("extractor"),
            "duration": result.get("duration"),
            "thumbnail": result.get("thumbnail"),
            "webpage_url": result.get("webpage_url"),
            "format_id": result.get("format_id"),
            "format": result.get("format"),
            "ext": result.get("ext"),
            "protocol": result.get("protocol"),
            "direct_url": direct_url,
            "expires_at": guess_expires_at(direct_url) if direct_url else None,
            "headers": safe_headers(result.get("http_headers") or info.get("http_headers") or {}),
            "streams": requested_streams,
        }
    )

    if include_formats:
        response["formats"] = [
            stream
            for stream in (stream_from_format(fmt) for fmt in result.get("formats") or [])
            if stream
        ]

    return response


def search_result_from_entry(entry: dict[str, Any]) -> dict[str, Any] | None:
    video_id = video_id_from_value(entry.get("id"))
    webpage_url = normalize_youtube_video_url(entry.get("webpage_url") or entry.get("url"), video_id)

    if not webpage_url:
        return None

    return compact(
        {
            "id": video_id,
            "title": entry.get("title"),
            "url": webpage_url,
            "webpage_url": webpage_url,
            "thumbnail": best_thumbnail(entry),
            "channel": entry.get("channel") or entry.get("uploader"),
            "channel_url": entry.get("channel_url") or entry.get("uploader_url"),
            "duration": entry.get("duration"),
            "view_count": entry.get("view_count"),
            "upload_date": entry.get("upload_date"),
            "live_status": entry.get("live_status"),
            "is_short": is_short_video_entry(entry, webpage_url),
        }
    )


def channel_result_from_entry(entry: dict[str, Any]) -> dict[str, Any] | None:
    channel_url = normalize_youtube_channel_url(
        entry.get("channel_url") or entry.get("uploader_url") or entry.get("webpage_url") or entry.get("url")
    )
    channel_id = entry.get("channel_id") or entry.get("uploader_id")
    title = entry.get("channel") or entry.get("uploader")

    if not channel_url and channel_id:
        channel_url = f"https://www.youtube.com/channel/{channel_id}"

    if not channel_url:
        return None

    if not title:
        title = entry.get("title") or channel_url.rstrip("/").rsplit("/", 1)[-1]

    return compact(
        {
            "id": channel_id,
            "title": title,
            "url": channel_url,
            "videos_url": channel_videos_url(channel_url),
            "thumbnail": best_thumbnail(entry),
        }
    )


def playlist_result_from_info(info: dict[str, Any], playlist_url: str) -> dict[str, Any]:
    entries = [entry for entry in info.get("entries") or [] if isinstance(entry, dict)]
    thumbnail = best_thumbnail(info) or (best_thumbnail(entries[0]) if entries else None)
    return compact(
        {
            "id": info.get("id") or first_value(parse_qs(urlparse(playlist_url).query).get("list")),
            "title": info.get("title") or "Playlist",
            "url": info.get("webpage_url") or playlist_url,
            "thumbnail": thumbnail,
            "channel": info.get("channel") or info.get("uploader"),
            "channel_url": info.get("channel_url") or info.get("uploader_url"),
            "playlist_count": info.get("playlist_count") or len(entries),
        }
    )


def normalize_youtube_video_url(value: Any, video_id: str | None) -> str | None:
    if video_id and not str(value or "").startswith("http"):
        return f"https://www.youtube.com/watch?v={video_id}"

    if not value:
        return f"https://www.youtube.com/watch?v={video_id}" if video_id else None

    raw_url = str(value)
    parsed = urlparse(raw_url)
    host = (parsed.hostname or "").lower()

    if not parsed.scheme or not host:
        return f"https://www.youtube.com/watch?v={video_id}" if video_id else None

    if host.endswith("youtu.be") and video_id_from_value(parsed.path.lstrip("/")):
        return raw_url

    if "youtube.com" not in host:
        return None

    query_video_id = video_id_from_value(first_value(parse_qs(parsed.query).get("v")))
    if parsed.path == "/watch" and query_video_id:
        return raw_url

    path_parts = [part for part in parsed.path.split("/") if part]
    if len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed", "live"}:
        return raw_url if video_id_from_value(path_parts[1]) else None

    return f"https://www.youtube.com/watch?v={video_id}" if video_id else None


def normalize_youtube_channel_url(value: Any) -> str | None:
    if not value:
        return None

    raw_url = str(value)
    parsed = urlparse(raw_url)
    host = (parsed.hostname or "").lower()
    if not parsed.scheme or not host or "youtube.com" not in host:
        return None

    path_parts = [part for part in parsed.path.split("/") if part]
    if not path_parts:
        return None

    if path_parts[0].startswith("@"):
        return f"https://www.youtube.com/{path_parts[0]}"

    if len(path_parts) >= 2 and path_parts[0] in {"channel", "c", "user"}:
        return f"https://www.youtube.com/{path_parts[0]}/{path_parts[1]}"

    return None


def channel_videos_url(channel_url: str) -> str:
    parsed = urlparse(channel_url)
    path = parsed.path.rstrip("/")
    if path.endswith("/videos"):
        return channel_url
    return parsed._replace(path=f"{path}/videos", query="", fragment="").geturl()


def video_id_from_value(value: Any) -> str | None:
    candidate = str(value or "")
    return candidate if YOUTUBE_VIDEO_ID_RE.fullmatch(candidate) else None


def is_short_video_entry(entry: dict[str, Any], webpage_url: str | None = None) -> bool:
    if entry.get("is_short") is True:
        return True

    url_text = " ".join(
        str(value or "")
        for value in (
            webpage_url,
            entry.get("url"),
            entry.get("webpage_url"),
            entry.get("original_url"),
        )
    )
    if "/shorts/" in url_text.lower():
        return True

    text = f"{entry.get('title') or ''} {entry.get('description') or ''}"
    if SHORTS_TAG_RE.search(text):
        return True

    duration = number_from_value(entry.get("duration"))
    width = number_from_value(entry.get("width"))
    height = number_from_value(entry.get("height"))
    if duration and duration <= SHORTS_MAX_SECONDS and width and height and height >= width:
        return True

    return bool(duration and duration <= SHORTS_LEGACY_MAX_SECONDS)


def number_from_value(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def best_thumbnail(entry: dict[str, Any]) -> str | None:
    thumbnails = entry.get("thumbnails")
    if isinstance(thumbnails, list):
        valid_thumbnails = [thumb for thumb in thumbnails if isinstance(thumb, dict) and thumb.get("url")]
        if valid_thumbnails:
            return valid_thumbnails[-1]["url"]
    return entry.get("thumbnail")


def first_media_result(info: dict[str, Any]) -> dict[str, Any]:
    current = info
    while current.get("_type") in {"playlist", "multi_video"}:
        entries = current.get("entries") or []
        current = next((entry for entry in entries if isinstance(entry, dict)), {})
        if not current:
            break
    return current


def stream_from_format(fmt: dict[str, Any]) -> dict[str, Any] | None:
    media_url = fmt.get("url")
    if not media_url:
        return None

    return compact(
        {
            "format_id": fmt.get("format_id"),
            "format_note": fmt.get("format_note"),
            "ext": fmt.get("ext"),
            "protocol": fmt.get("protocol"),
            "acodec": fmt.get("acodec"),
            "vcodec": fmt.get("vcodec"),
            "width": fmt.get("width"),
            "height": fmt.get("height"),
            "fps": fmt.get("fps"),
            "abr": fmt.get("abr"),
            "vbr": fmt.get("vbr"),
            "tbr": fmt.get("tbr"),
            "filesize": fmt.get("filesize") or fmt.get("filesize_approx"),
            "url": media_url,
            "expires_at": guess_expires_at(media_url),
            "headers": safe_headers(fmt.get("http_headers") or {}),
        }
    )


async def proxy_stream(media_url: str, upstream_headers: dict[str, str]) -> StreamingResponse:
    timeout = httpx.Timeout(
        connect=SOCKET_TIMEOUT_SECONDS,
        read=STREAM_TIMEOUT_SECONDS,
        write=SOCKET_TIMEOUT_SECONDS,
        pool=SOCKET_TIMEOUT_SECONDS,
    )
    client = httpx.AsyncClient(follow_redirects=True, timeout=timeout)
    upstream = await client.send(
        client.build_request("GET", media_url, headers=upstream_headers),
        stream=True,
    )

    if upstream.status_code >= 400:
        body = (await upstream.aread()).decode("utf-8", errors="replace")[:500]
        await upstream.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=upstream.status_code,
            detail=f"Upstream media request failed: {body or upstream.reason_phrase}",
        )

    response_headers = {
        key: upstream.headers[key]
        for key in ("accept-ranges", "content-length", "content-range", "cache-control")
        if key in upstream.headers
    }
    response_headers.setdefault("accept-ranges", "bytes")
    media_type = upstream.headers.get("content-type", "application/octet-stream")

    async def body_iterator():
        try:
            async for chunk in upstream.aiter_bytes(chunk_size=1024 * 256):
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body_iterator(),
        status_code=upstream.status_code,
        media_type=media_type,
        headers=response_headers,
    )


def proxy_request_headers(headers: dict[str, Any]) -> dict[str, str]:
    proxy_headers = {
        key: str(value)
        for key, value in headers.items()
        if key.lower() not in SENSITIVE_HEADERS and value is not None
    }
    proxy_headers.setdefault("Accept", "*/*")
    proxy_headers["Accept-Encoding"] = "identity"
    return proxy_headers


def validate_public_url(value: str) -> None:
    parsed = urlparse(value)
    host = parsed.hostname
    if not host:
        raise ValueError("url must include a hostname")

    lowered_host = host.lower().rstrip(".")
    if lowered_host == "localhost" or lowered_host.endswith(".localhost"):
        raise ValueError("localhost URLs are not allowed")

    try:
        ip = ipaddress.ip_address(lowered_host)
    except ValueError:
        hostname = lowered_host.encode("idna").decode("ascii")
        try:
            records = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            raise ValueError(f"could not resolve hostname: {host}") from exc

        addresses = {record[4][0] for record in records}
        for address in addresses:
            ensure_public_ip(ipaddress.ip_address(address))
    else:
        ensure_public_ip(ip)


def ensure_public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    if not ip.is_global:
        raise ValueError(f"private or non-public host is not allowed: {ip}")


def guess_expires_at(media_url: str) -> str | None:
    parsed = urlparse(media_url)
    query = {key.lower(): values for key, values in parse_qs(parsed.query).items()}

    for key in ("expire", "expires", "e"):
        epoch = first_int(query.get(key))
        if epoch and epoch > 946684800:
            return datetime.fromtimestamp(epoch, timezone.utc).isoformat().replace("+00:00", "Z")

    for prefix in ("x-amz", "x-goog"):
        date_value = first_value(query.get(f"{prefix}-date"))
        expires_seconds = first_int(query.get(f"{prefix}-expires"))
        if date_value and expires_seconds:
            try:
                start = datetime.strptime(date_value, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
            except ValueError:
                return None
            return (start + timedelta(seconds=expires_seconds)).isoformat().replace("+00:00", "Z")

    return None


def first_value(values: list[str] | None) -> str | None:
    return values[0] if values else None


def first_int(values: list[str] | None) -> int | None:
    value = first_value(values)
    if not value:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def safe_headers(headers: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in SENSITIVE_HEADERS and value is not None
    }


def clean_error(message: str) -> str:
    message = ANSI_RE.sub("", message).strip()
    return message.removeprefix("ERROR: ").strip()


def compact(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value not in (None, [], {})}
