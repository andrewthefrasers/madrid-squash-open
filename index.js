// Cloudflare Worker for madridsquashopen.com
//
// /api/health             → sanity check (does PSA_API_KEY exist?)
// /api/tournaments        → PSA tournament list, supports ?search=&show_past=&limit=
// /api/tournaments/:id    → full tournament details (draw, players, brackets, matches)
// anything else           → served from static assets (index.html, images/, etc.)
//
// The PSA API key must be set as an encrypted secret called PSA_API_KEY in the
// Cloudflare dashboard under Settings → Variables and Secrets.

const PSA_BASE = "https://data.psasquashtour.com/api/v1";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check — visit /api/health to confirm the secret is attached
    if (path === "/api/health") {
      return jsonResponse(200, {
        ok: true,
        psa_key_configured: Boolean(env.PSA_API_KEY),
        timestamp: new Date().toISOString()
      });
    }

    // GET /api/tournaments?search=…
    if (path === "/api/tournaments" && request.method === "GET") {
      return handleTournamentList(url, env);
    }

    // GET /api/tournaments/:id   (id can be numeric or slug)
    const detailsMatch = path.match(/^\/api\/tournaments\/([^/]+)$/);
    if (detailsMatch && request.method === "GET") {
      return handleTournamentDetails(detailsMatch[1], env);
    }

    // Fallthrough — should rarely hit this since run_worker_first only sends
    // /api/* to the Worker, but useful as a safety net.
    return env.ASSETS.fetch(request);
  }
};

async function handleTournamentList(url, env) {
  if (!env.PSA_API_KEY) {
    return jsonResponse(500, { error: "PSA_API_KEY not configured" });
  }

  const psaUrl = new URL(`${PSA_BASE}/tournaments`);
  for (const param of ["search", "show_past", "limit", "status", "start_date", "end_date"]) {
    const val = url.searchParams.get(param);
    if (val !== null) psaUrl.searchParams.set(param, val);
  }
  if (!psaUrl.searchParams.has("limit")) psaUrl.searchParams.set("limit", "20");

  return proxyToPsa(psaUrl.toString(), env.PSA_API_KEY, 300);
}

async function handleTournamentDetails(id, env) {
  if (!env.PSA_API_KEY) {
    return jsonResponse(500, { error: "PSA_API_KEY not configured" });
  }
  const psaUrl = `${PSA_BASE}/tournaments/${encodeURIComponent(id)}`;
  return proxyToPsa(psaUrl, env.PSA_API_KEY, 60);
}

async function proxyToPsa(psaUrl, apiKey, cacheTtl) {
  try {
    const psaResponse = await fetch(psaUrl, {
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json"
      },
      cf: { cacheTtl, cacheEverything: true }
    });

    if (!psaResponse.ok) {
      const body = await psaResponse.text();
      return jsonResponse(psaResponse.status, {
        error: `PSA returned ${psaResponse.status}`,
        details: body.slice(0, 300)
      });
    }

    const data = await psaResponse.json();
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, s-maxage=${cacheTtl}`
      }
    });
  } catch (err) {
    return jsonResponse(502, { error: `Failed to reach PSA: ${err.message}` });
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
