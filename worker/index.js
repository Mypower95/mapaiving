const MAX_BODY_BYTES = 4_000_000;
const ALLOWED_ORIGINS = new Set([
  "https://mypower95.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin =
    ALLOWED_ORIGINS.has(origin) || origin.startsWith("http://localhost:")
      ? origin
      : "https://mypower95.github.io";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readSyncKey(url) {
  const prefix = "/state/";
  if (!url.pathname.startsWith(prefix)) return "";
  return decodeURIComponent(url.pathname.slice(prefix.length)).trim();
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    if (url.pathname === "/") {
      return json(request, { ok: true, service: "mapaiving-sync" });
    }

    const syncKey = readSyncKey(url);
    if (!syncKey) {
      return json(request, { error: "not_found" }, 404);
    }

    if (syncKey.length < 4 || syncKey.length > 80) {
      return json(request, { error: "invalid_sync_key" }, 400);
    }

    const storageKey = `state:${await sha256(syncKey)}`;

    if (request.method === "GET") {
      const saved = await env.MAPA_STATE.get(storageKey, "json");
      return json(request, saved || { state: null, updatedAt: null });
    }

    if (request.method === "PUT") {
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > MAX_BODY_BYTES) {
        return json(request, { error: "payload_too_large" }, 413);
      }

      let payload;
      try {
        payload = await request.json();
      } catch {
        return json(request, { error: "invalid_json" }, 400);
      }

      if (!payload || typeof payload.state !== "object") {
        return json(request, { error: "invalid_state" }, 400);
      }

      const now = new Date().toISOString();
      const record = {
        state: payload.state,
        updatedAt: payload.updatedAt || payload.state.updatedAt || now,
        savedAt: now,
      };

      await env.MAPA_STATE.put(storageKey, JSON.stringify(record));
      return json(request, {
        ok: true,
        updatedAt: record.updatedAt,
        savedAt: record.savedAt,
      });
    }

    return json(request, { error: "method_not_allowed" }, 405);
  },
};
