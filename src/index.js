// Cloudflare Worker for madridsquashopen.com
//
// /api/health             → sanity check (does PSA_API_KEY exist?)
// /api/tournaments        → PSA tournament list (debugging / lookup)
// /api/tournaments/:id    → raw PSA tournament payload (debugging)
// /api/draw               → CLEAN, TRANSFORMED draw + bracket data for the front-end
// anything else           → static assets (index.html, images/, etc.)
//
// PSA_API_KEY must be set as an encrypted secret in the CF dashboard.

const PSA_BASE = "https://data.psasquashtour.com/api/v1";
const TOURNAMENT_ID = "12524"; // Madrid Squash Open 2026

// === BYE & qualifier orientation lookup tables ===
// PSA tells us which player has a bye / which player is in a qualifier slot,
// but not which side of the match-box (top/bottom) the BYE or "Qualifier"
// placeholder should be displayed on. These maps mirror the current site's
// visual layout. Key = match_num within Round 1.
const R1_BYE_SIDE = { 1: "top", 4: "top", 5: "bottom", 8: "top", 9: "bottom", 12: "top", 13: "bottom", 16: "top" };
const R1_QUALIFIER_SIDE = { 2: "top", 10: "top" }; // qualifier placeholder side

// === IOC country code → flag-icons CSS class suffix ===
const IOC_TO_FLAG = {
  HKG: "hk", ESP: "es", PAK: "pk", EGY: "eg", ARG: "ar", FRA: "fr",
  USA: "us", BEL: "be", CZE: "cz", WAL: "gb-wls", ENG: "gb-eng",
  SCO: "gb-sct", NIR: "gb-nir", GBR: "gb", GER: "de", AUT: "at",
  AUS: "au", NED: "nl", CAN: "ca", NZL: "nz", MEX: "mx", IRL: "ie",
  POL: "pl", HUN: "hu", MAS: "my", SUI: "ch", KUW: "kw", AIN: "un",
  POR: "pt", ITA: "it", JPN: "jp", KOR: "kr", IND: "in", CHN: "cn",
  RSA: "za", COL: "co", BRA: "br", CHI: "cl", PER: "pe"
};

const ROUND_NUM_TO_KEY = { 1: "r1", 2: "r16", 3: "qf", 4: "sf", 5: "f" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/health") {
      return jsonResponse(200, {
        ok: true,
        psa_key_configured: Boolean(env.PSA_API_KEY),
        tournament_id: TOURNAMENT_ID,
        timestamp: new Date().toISOString()
      });
    }

    if (path === "/api/tournaments" && request.method === "GET") {
      return handleTournamentList(url, env);
    }

    const detailsMatch = path.match(/^\/api\/tournaments\/([^/]+)$/);
    if (detailsMatch && request.method === "GET") {
      return handleTournamentDetails(detailsMatch[1], env);
    }

    if (path === "/api/draw" && request.method === "GET") {
      return handleDraw(env);
    }

    return env.ASSETS.fetch(request);
  }
};

// ============================================================================
// /api/draw — clean, transformed payload for the front-end
// ============================================================================
async function handleDraw(env) {
  if (!env.PSA_API_KEY) {
    return jsonResponse(500, { error: "PSA_API_KEY not configured" });
  }

  try {
    const psaResponse = await fetch(`${PSA_BASE}/tournaments/${TOURNAMENT_ID}`, {
      headers: { "X-Api-Key": env.PSA_API_KEY, "Accept": "application/json" },
      cf: { cacheTtl: 60, cacheEverything: true }
    });

    if (!psaResponse.ok) {
      const body = await psaResponse.text();
      return jsonResponse(psaResponse.status, {
        error: `PSA returned ${psaResponse.status}`,
        details: body.slice(0, 300)
      });
    }

    const psa = await psaResponse.json();
    const transformed = transformPsaToDraw(psa);

    return new Response(JSON.stringify(transformed, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, s-maxage=60"
      }
    });
  } catch (err) {
    return jsonResponse(502, { error: `Failed to transform PSA data: ${err.message}` });
  }
}

function transformPsaToDraw(psa) {
  const tournament = psa.psa.tournament;
  const division = psa.psa.divisions[0]; // Mens division
  const bracket = division.brackets.find(b => b.type === "main") || division.brackets[0];

  // Build the player map: only confirmed main-draw entries
  const playerMap = new Map();
  const confirmedPlayers = division.players
    .filter(p => p.entry.status === "confirmed" && p.entry.draw_type === "main")
    .sort((a, b) => a.entry.position - b.entry.position);

  confirmedPlayers.forEach(p => playerMap.set(p.id, transformPlayerForDraw(p)));

  // Add the two synthetic qualifier placeholders that show in the Draw section
  // (these are the open R1 slots awaiting opponents — R1.2 and R1.10 in PSA's data)
  const players = Array.from(playerMap.values());
  players.push(qualifierPlaceholderCard());
  players.push(qualifierPlaceholderCard());

  // Transform all 31 matches
  const matches = bracket.matches.map(m => transformMatch(m, playerMap));

  return {
    tournament: {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      start_date: tournament.dates.start,
      end_date: tournament.dates.end,
      venue: tournament.location.venues?.[0]?.name || null,
      city: tournament.location.city,
      country: tournament.location.country,
      updated_at: tournament.metadata?.updated_at || null
    },
    summary: {
      confirmed_count: confirmedPlayers.length,
      draw_size: division.draw_size,
      reserves_count: division.players.filter(p => p.entry.status === "reserve").length,
      withdrawn_count: division.players.filter(p => p.entry.status === "withdrawn").length
    },
    players,
    matches,
    generated_at: new Date().toISOString()
  };
}

function transformPlayerForDraw(p) {
  // "Henry Leung" → "H. Leung"  (first initial + surname, mirroring the bracket convention)
  const parts = p.name.trim().split(/\s+/);
  const displayName = parts.length >= 2
    ? `${parts[0][0]}. ${parts.slice(1).join(" ")}`
    : p.name;

  // Categorise for the Draw section visual grouping
  const seed = p.entry.seed_number;
  const position = p.entry.position;
  let category;
  if (seed != null && seed >= 1 && seed <= 8) category = "top_seed";
  else if (position >= 9 && position <= 16) category = "seed_9_16";
  else if (p.entry.is_wildcard) category = "wildcard";
  else category = "unseeded";

  return {
    id: p.id,
    full_name: p.name.trim(),
    display_name: displayName,
    call_name: p.call_name,
    country: IOC_TO_FLAG[p.country] || p.country.toLowerCase(),
    country_ioc: p.country,
    ranking: p.ranking,
    ranking_at_entry: p.entry.ranking_at_entry,
    seed,
    position,
    category,
    is_wildcard: p.entry.is_wildcard
  };
}

function qualifierPlaceholderCard() {
  return {
    id: null,
    full_name: null,
    display_name: null,
    call_name: null,
    country: null,
    country_ioc: null,
    ranking: null,
    ranking_at_entry: null,
    seed: null,
    position: null,
    category: "qualifier_tbd",
    is_wildcard: false
  };
}

function transformMatch(m, playerMap) {
  const round = ROUND_NUM_TO_KEY[m.round_num];
  const id = `${round}-m${m.match_num}`;

  // Determine the two slots (top / bottom of the match box)
  let playerTop, playerBottom;

  if (m.bye) {
    // Bye: one player listed, BYE on the other side per lookup table
    const player = m.players[0] ? playerSlotFromPsa(m.players[0], playerMap) : { type: "tbd" };
    const byeSide = R1_BYE_SIDE[m.match_num] || "top";
    if (byeSide === "top") {
      playerTop = { type: "bye" };
      playerBottom = player;
    } else {
      playerTop = player;
      playerBottom = { type: "bye" };
    }
  } else if (m.players.length === 0) {
    // Empty (QF/SF/F before fill, or empty R16 slot)
    playerTop = { type: "tbd" };
    playerBottom = { type: "tbd" };
  } else if (m.players.length === 1) {
    const player = playerSlotFromPsa(m.players[0], playerMap);
    if (m.round_num === 1) {
      // R1 with 1 player = qualifier placeholder situation
      const qSide = R1_QUALIFIER_SIDE[m.match_num] || "top";
      if (qSide === "top") {
        playerTop = { type: "qualifier" };
        playerBottom = player;
      } else {
        playerTop = player;
        playerBottom = { type: "qualifier" };
      }
    } else {
      // R16+ with 1 player = pre-placed seed waiting for previous winner
      // Convention: odd match_num → player on top, even → player on bottom
      if (m.match_num % 2 === 1) {
        playerTop = player;
        playerBottom = { type: "tbd" };
      } else {
        playerTop = { type: "tbd" };
        playerBottom = player;
      }
    }
  } else {
    // 2 players — regular match
    playerTop = playerSlotFromPsa(m.players[0], playerMap);
    playerBottom = playerSlotFromPsa(m.players[1], playerMap);
  }

  // Meta (date / time / court)
  const meta = buildMetaForMatch(m);

  // Result
  let result = null;
  if (m.status === "completed" && m.result) {
    result = {
      winner_id: m.result.winner_id,
      retired: m.result.retired,
      walkover: m.result.walkover,
      games: (m.result.games || []).map(g => `${g.scores[0]}-${g.scores[1]}`)
    };
  }

  return {
    id,
    psa_id: m.id,
    round,
    round_num: m.round_num,
    match_num: m.match_num,
    bye: m.bye,
    status: m.status,
    player_top: playerTop,
    player_bottom: playerBottom,
    meta,
    result
  };
}

function playerSlotFromPsa(p, playerMap) {
  const full = playerMap.get(p.id);
  if (!full) {
    // Player exists in match but not in our confirmed list — surface a minimal stub
    return {
      type: "player",
      id: p.id,
      display_name: p.call_name || p.name || "Player",
      country: null,
      seed: null,
      games_won: p.games_won || 0
    };
  }
  return {
    type: "player",
    id: full.id,
    display_name: full.display_name,
    country: full.country,
    seed: full.seed,
    is_wildcard: full.is_wildcard,
    games_won: p.games_won || 0
  };
}

function buildMetaForMatch(m) {
  if (!m.date && !m.time) {
    return {
      date: null, time: null, court: null,
      scheduled: false,
      text_en: "TBD", text_es: "TBD"
    };
  }

  const parts_en = [];
  const parts_es = [];

  if (m.date) {
    const d = new Date(m.date + "T00:00:00Z");
    const opts = { weekday: "short", day: "numeric", month: "short" };
    parts_en.push(d.toLocaleDateString("en-GB", opts).toUpperCase());
    parts_es.push(d.toLocaleDateString("es-ES", opts).toUpperCase());
  }
  if (m.time) {
    // PSA times are "HH:MM" — strip seconds if present
    const t = m.time.slice(0, 5);
    parts_en.push(t);
    parts_es.push(t);
  }
  if (m.court) {
    parts_en.push(`Court ${m.court}`);
    parts_es.push(`Pista ${m.court}`);
  }

  return {
    date: m.date,
    time: m.time,
    court: m.court,
    scheduled: true,
    text_en: parts_en.join(" · "),
    text_es: parts_es.join(" · ")
  };
}

// ============================================================================
// Raw PSA proxy endpoints (kept for debugging / lookups)
// ============================================================================
async function handleTournamentList(url, env) {
  if (!env.PSA_API_KEY) return jsonResponse(500, { error: "PSA_API_KEY not configured" });

  const psaUrl = new URL(`${PSA_BASE}/tournaments`);
  for (const param of ["search", "show_past", "limit", "status", "start_date", "end_date"]) {
    const val = url.searchParams.get(param);
    if (val !== null) psaUrl.searchParams.set(param, val);
  }
  if (!psaUrl.searchParams.has("limit")) psaUrl.searchParams.set("limit", "20");

  return proxyToPsa(psaUrl.toString(), env.PSA_API_KEY, 300);
}

async function handleTournamentDetails(id, env) {
  if (!env.PSA_API_KEY) return jsonResponse(500, { error: "PSA_API_KEY not configured" });
  return proxyToPsa(`${PSA_BASE}/tournaments/${encodeURIComponent(id)}`, env.PSA_API_KEY, 60);
}

async function proxyToPsa(psaUrl, apiKey, cacheTtl) {
  try {
    const psaResponse = await fetch(psaUrl, {
      headers: { "X-Api-Key": apiKey, "Accept": "application/json" },
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
