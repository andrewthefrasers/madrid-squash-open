// GET /api/tournaments/:id
// Returns the full PSA tournament payload (draw, players, brackets, matches,
// timings, results). Once we know the Madrid Squash Open 2026 id, this is the
// endpoint the page will read from to render the bracket and player list.
//
// :id can be either the numeric tournament id or the slug
// (e.g. "madrid-squash-open-2026").
//
// Required env var:
//   PSA_API_KEY  – encrypted secret, your PSA API key

const PSA_BASE = "https://data.psasquashtour.com/api/v1";
const CACHE_TTL_SECONDS = 60; // 1 min — drops the load on PSA but keeps schedule changes fresh

export async function onRequestGet({ env, params }) {
  if (!env.PSA_API_KEY) {
    return errorResponse(500, "PSA_API_KEY not configured. Add it as an encrypted variable in the Cloudflare dashboard.");
  }

  if (!params.id) {
    return errorResponse(400, "Tournament id (or slug) is required");
  }

  const psaUrl = `${PSA_BASE}/tournaments/${encodeURIComponent(params.id)}`;

  try {
    const psaResponse = await fetch(psaUrl, {
      headers: {
        "X-Api-Key": env.PSA_API_KEY,
        "Accept": "application/json"
      },
      cf: { cacheTtl: CACHE_TTL_SECONDS, cacheEverything: true }
    });

    if (!psaResponse.ok) {
      const body = await psaResponse.text();
      return errorResponse(psaResponse.status, `PSA returned ${psaResponse.status}: ${body.slice(0, 300)}`);
    }

    const data = await psaResponse.json();
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, s-maxage=${CACHE_TTL_SECONDS}`
      }
    });
  } catch (err) {
    return errorResponse(502, `Failed to reach PSA: ${err.message}`);
  }
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message, status }, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}
