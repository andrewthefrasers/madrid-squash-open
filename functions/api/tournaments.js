// GET /api/tournaments?search=madrid
// Lists tournaments from the PSA API. Use this once to find the Madrid Squash
// Open 2026 tournament id, then we point /api/tournaments/[id] at it.
//
// Required env var (set in Cloudflare dashboard → Variables and Secrets):
//   PSA_API_KEY  – encrypted secret, your PSA API key

const PSA_BASE = "https://data.psasquashtour.com/api/v1";
const CACHE_TTL_SECONDS = 300; // 5 min — tournament list rarely changes

export async function onRequestGet({ request, env }) {
  if (!env.PSA_API_KEY) {
    return errorResponse(500, "PSA_API_KEY not configured. Add it as an encrypted variable in the Cloudflare dashboard.");
  }

  // Build PSA URL, forwarding the query params we support
  const url = new URL(request.url);
  const psaUrl = new URL(`${PSA_BASE}/tournaments`);
  for (const param of ["search", "show_past", "limit", "status", "start_date", "end_date"]) {
    const val = url.searchParams.get(param);
    if (val !== null) psaUrl.searchParams.set(param, val);
  }
  if (!psaUrl.searchParams.has("limit")) psaUrl.searchParams.set("limit", "20");

  try {
    const psaResponse = await fetch(psaUrl.toString(), {
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
