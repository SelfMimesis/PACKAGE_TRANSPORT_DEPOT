const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 10000);
const CONTROL_TOKEN = process.env.BRIGHTNESS_CONTROL_TOKEN || "";
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "https://selfmimesis.github.io,http://localhost:8080,http://127.0.0.1:8080,null")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const EXPERIENCE_IDS = ["t08-1", "t08-2", "t08-3", "t08-4", "t13-1", "t13-2", "t13-3", "t13-4", "t13-5"];
const DEFAULT_BRIGHTNESS = 100;
const MAX_BODY_BYTES = 16384;
const VIDEOS_DIR = path.join(__dirname, "videos");

let state = {
  levels: Object.fromEntries(EXPERIENCE_IDS.map((id) => [id, DEFAULT_BRIGHTNESS])),
  updatedAt: new Date().toISOString(),
  version: 0,
};

const server = http.createServer(async (request, response) => {
  setCorsHeaders(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && request.url === "/") {
      sendJson(response, 200, {
        ok: true,
        service: "Package Transport Depot brightness sync",
        endpoints: {
          health: "/health",
          brightness: "/api/brightness",
          videos: "/videos/{file}.mp4",
        },
      });
      return;
    }

    if ((request.method === "GET" || request.method === "HEAD") && request.url.startsWith("/videos/")) {
      serveVideo(request, response);
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && request.url === "/api/brightness") {
      sendJson(response, 200, state);
      return;
    }

    if (request.method === "POST" && request.url === "/api/brightness") {
      if (!isAuthorized(request)) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }

      let body = {};

      try {
        body = await readJsonBody(request);
      } catch {
        sendJson(response, 400, { error: "Invalid JSON body" });
        return;
      }

      const levels = normalizeLevels(body.levels);

      if (Object.keys(levels).length === 0) {
        sendJson(response, 400, { error: "No valid brightness levels received" });
        return;
      }

      state = {
        levels: {
          ...state.levels,
          ...levels,
        },
        updatedAt: new Date().toISOString(),
        version: state.version + 1,
      };

      sendJson(response, 200, state);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    sendJson(response, 500, { error: "Server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Package Transport Depot sync server listening on ${PORT}`);
});

function setCorsHeaders(request, response) {
  const origin = request.headers.origin || "null";
  const allowedOrigin = ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Control-Token");
  response.setHeader("Vary", "Origin");
}

function serveVideo(request, response) {
  const url = new URL(request.url, "http://localhost");
  const requestedName = path.basename(decodeURIComponent(url.pathname));

  if (!/^[a-z0-9-]+\.mp4$/i.test(requestedName)) {
    sendJson(response, 400, { error: "Invalid video path" });
    return;
  }

  const videoPath = path.join(VIDEOS_DIR, requestedName);

  if (!videoPath.startsWith(VIDEOS_DIR) || !fs.existsSync(videoPath)) {
    sendJson(response, 404, { error: "Video not found" });
    return;
  }

  const stat = fs.statSync(videoPath);
  const range = request.headers.range;
  const headers = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };

  if (!range) {
    response.writeHead(200, {
      ...headers,
      "Content-Length": stat.size,
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    fs.createReadStream(videoPath).pipe(response);
    return;
  }

  const [startPart, endPart] = range.replace(/bytes=/, "").split("-");
  const start = Number.parseInt(startPart, 10);
  const end = endPart ? Number.parseInt(endPart, 10) : stat.size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= stat.size || end >= stat.size || start > end) {
    response.writeHead(416, {
      ...headers,
      "Content-Range": `bytes */${stat.size}`,
    });
    response.end();
    return;
  }

  response.writeHead(206, {
    ...headers,
    "Content-Range": `bytes ${start}-${end}/${stat.size}`,
    "Content-Length": end - start + 1,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  fs.createReadStream(videoPath, { start, end }).pipe(response);
}

function isAuthorized(request) {
  if (!CONTROL_TOKEN) {
    return true;
  }

  const headerToken = request.headers["x-control-token"];
  const authHeader = request.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  return headerToken === CONTROL_TOKEN || bearerToken === CONTROL_TOKEN;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;

      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        request.destroy();
      }
    });

    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function normalizeLevels(levels) {
  if (!levels || typeof levels !== "object") {
    return {};
  }

  return Object.entries(levels).reduce((validLevels, [experienceId, value]) => {
    if (!EXPERIENCE_IDS.includes(experienceId)) {
      return validLevels;
    }

    const brightness = Number(value);

    if (!Number.isFinite(brightness)) {
      return validLevels;
    }

    validLevels[experienceId] = Math.min(100, Math.max(0, Math.round(brightness)));
    return validLevels;
  }, {});
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}
