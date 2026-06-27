import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uiDir = fileURLToPath(new URL(".", import.meta.url));
const repoDir = resolve(uiDir, "..");
const envPaths = [resolve(repoDir, "..", ".env"), join(repoDir, ".env")];
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || "127.0.0.1";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname === "/config.js") {
      await sendConfig(response);
      return;
    }

    const pathname = requestUrl.pathname === "/" ? "/home.html" : requestUrl.pathname;
    const filePath = resolve(uiDir, `.${pathname}`);
    if (!filePath.startsWith(uiDir)) {
      sendText(response, 403, "Forbidden");
      return;
    }

    if (!existsSync(filePath)) {
      sendText(response, 404, "Not found");
      return;
    }

    const data = await readFile(filePath);
    const extension = extname(normalize(filePath)).toLowerCase();
    response.writeHead(200, {
      "content-type": contentTypes[extension] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(data);
  } catch (error) {
    sendText(response, 500, error instanceof Error ? error.message : "Server error");
  }
});

server.listen(port, host, () => {
  console.log(`Frontend UI running at http://${host}:${port}/`);
});

async function sendConfig(response) {
  const env = await readEnv();
  const youtubeApiKey = firstValue(env, [
    "YOUTUBE_API_KEY",
    "YOUTUBE_DATA_API_KEY",
    "YT_API_KEY",
    "YT_PUBLIC_API_KEY",
  ]);
  const resolverBase = firstValue(env, ["RESOLVER_URL", "YTDLP_RESOLVER_URL", "API_BASE_URL"])
    || "http://3.121.216.41";
  const resolverKey = firstValue(env, ["RESOLVER_API_KEY", "YTDLP_API_KEY", "API_KEY", "GENERATED_API_KEY"]);
  const googleClientId = firstValue(env, ["GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"]);

  const config = {
    youtubeApiKey,
    resolverBase,
    resolverKey,
    googleClientId,
  };

  response.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`window.YT_FRONTEND_CONFIG = ${JSON.stringify(config)};\n`);
}

async function readEnv() {
  const env = {};
  const rawValues = [];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    const text = await readFile(envPath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const match = /^(?:export\s+)?([A-Za-z0-9_-]+)\s*=\s*(.*)$/.exec(trimmed);
      if (match) {
        const key = normalizeEnvKey(match[1]);
        const value = unquote(match[2]);
        if (value || !Object.hasOwn(env, key)) {
          env[key] = value;
        }
        continue;
      }

      rawValues.push(unquote(trimmed));
    }
  }

  if (!firstValue(env, ["YOUTUBE_API_KEY", "YOUTUBE_DATA_API_KEY", "YT_API_KEY", "YT_PUBLIC_API_KEY"])) {
    env.YOUTUBE_API_KEY = rawValues[0] || "";
  }

  return env;
}

function firstValue(source, keys) {
  for (const key of keys) {
    const normalizedKey = normalizeEnvKey(key);
    if (source[normalizedKey]) {
      return source[normalizedKey];
    }
  }
  return "";
}

function normalizeEnvKey(key) {
  return key.replace(/-/g, "_").toUpperCase();
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}
