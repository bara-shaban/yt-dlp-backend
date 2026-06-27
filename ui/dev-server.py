#!/usr/bin/env python3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from json import dumps
from mimetypes import guess_type
from os import environ
from pathlib import Path
from urllib.parse import unquote, urlparse

UI_DIR = Path(__file__).resolve().parent
REPO_DIR = UI_DIR.parent
ENV_PATHS = [REPO_DIR.parent / ".env", REPO_DIR / ".env"]


def normalize_env_key(key):
    return key.replace("-", "_").upper()


def unquote_env(value):
    trimmed = value.strip()
    if len(trimmed) >= 2 and trimmed[0] == trimmed[-1] and trimmed[0] in ("'", '"'):
        return trimmed[1:-1]
    return trimmed


def read_env():
    env = {}
    raw_values = []
    for env_path in ENV_PATHS:
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            trimmed = line.strip()
            if not trimmed or trimmed.startswith("#"):
                continue
            if trimmed.startswith("export "):
                trimmed = trimmed[7:].strip()
            if "=" in trimmed:
                key, value = trimmed.split("=", 1)
                key = normalize_env_key(key.strip())
                value = unquote_env(value)
                if value or key not in env:
                    env[key] = value
            else:
                raw_values.append(unquote_env(trimmed))
    if not first_value(env, ["YOUTUBE_API_KEY", "YOUTUBE_DATA_API_KEY", "YT_API_KEY", "YT_PUBLIC_API_KEY"]):
        env["YOUTUBE_API_KEY"] = raw_values[0] if raw_values else ""
    return env


def first_value(source, keys):
    for key in keys:
        value = source.get(normalize_env_key(key), "")
        if value:
            return value
    return ""


def frontend_config():
    env = read_env()
    return {
        "youtubeApiKey": first_value(env, ["YOUTUBE_API_KEY", "YOUTUBE_DATA_API_KEY", "YT_API_KEY", "YT_PUBLIC_API_KEY"]),
        "resolverBase": first_value(env, ["RESOLVER_URL", "YTDLP_RESOLVER_URL", "API_BASE_URL"]) or "http://3.121.216.41",
        "resolverKey": first_value(env, ["RESOLVER_API_KEY", "YTDLP_API_KEY", "API_KEY", "GENERATED_API_KEY"]),
        "googleClientId": first_value(env, ["GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"]),
    }


class UiHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/config.js":
            self.send_config()
            return

        route = "/home.html" if parsed.path == "/" else parsed.path
        relative = unquote(route).lstrip("/")
        file_path = (UI_DIR / relative).resolve()
        if not str(file_path).startswith(str(UI_DIR)):
            self.send_text(403, "Forbidden")
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_text(404, "Not found")
            return

        data = file_path.read_bytes()
        content_type = guess_type(str(file_path))[0] or "application/octet-stream"
        if content_type.startswith("text/") or file_path.suffix in {".js", ".json"}:
            content_type = f"{content_type}; charset=utf-8"
        self.send_response(200)
        self.send_header("content-type", content_type)
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def send_config(self):
        body = f"window.YT_FRONTEND_CONFIG = {dumps(frontend_config())};\n".encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/javascript; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, status, body):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("cache-control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")


def main():
    host = environ.get("HOST", "127.0.0.1")
    port = int(environ.get("PORT", "8080"))
    server = ThreadingHTTPServer((host, port), UiHandler)
    print(f"Frontend UI running at http://{host}:{port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
