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

// === Match slot orientation (top vs bottom of the match box) ===
// Single-elimination convention: the side a player appears on in the current
// round mirrors the slot they'll occupy in the next round. Winners of
// odd-numbered matches go to the TOP of the next round's match;
// winners of even-numbered matches go to the BOTTOM. So the "winner-elect"
// of an R1 match (the seed in a bye match, or the named player in a
// qualifier-placeholder match) appears on:
//   odd  match_num  → TOP    (bye/qualifier placeholder on bottom)
//   even match_num  → BOTTOM (bye/qualifier placeholder on top)
function realPlayerOnTop(match_num) {
  return match_num % 2 === 1;
}

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

// === Follow-on (back-to-back court bookings) ===
// PSA marks matches that start immediately after a predecessor on the same
// court via follow_on=true + follow_on_match_id. The API doesn't compute the
// estimated start time; we derive it as predecessor_time + this offset.
// 45 min mirrors PSA's own UI and matches the average best-of-5 par-11 length.
const FOLLOW_ON_OFFSET_MINUTES = 45;

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

  // Second pass: estimated start times for follow-on (back-to-back) matches
  resolveFollowOnTimes(matches);

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
    // Bye match: one player listed, BYE on the opposite side
    const player = m.players[0] ? playerSlotFromPsa(m.players[0], playerMap) : { type: "tbd" };
    if (realPlayerOnTop(m.match_num)) {
      playerTop = player;
      playerBottom = { type: "bye" };
    } else {
      playerTop = { type: "bye" };
      playerBottom = player;
    }
  } else if (m.players.length === 0) {
    // Empty (QF/SF/F before fill)
    playerTop = { type: "tbd" };
    playerBottom = { type: "tbd" };
  } else if (m.players.length === 1) {
    const player = playerSlotFromPsa(m.players[0], playerMap);
    if (m.round_num === 1) {
      // R1 with 1 player = qualifier placeholder; same parity rule
      if (realPlayerOnTop(m.match_num)) {
        playerTop = player;
        playerBottom = { type: "qualifier" };
      } else {
        playerTop = { type: "qualifier" };
        playerBottom = player;
      }
    } else {
      // R16+ with 1 player = pre-placed seed awaiting previous winner;
      // same parity rule (odd → player on top)
      if (realPlayerOnTop(m.match_num)) {
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

  // Result/score data — populated for in-progress AND completed matches so that
  // live games_won values and any partial per-game scores flow through.
  let result = null;
  if ((m.status === "in_progress" || m.status === "completed") && m.result) {
    const topId    = (playerTop    && playerTop.type    === "player") ? playerTop.id    : null;
    const bottomId = (playerBottom && playerBottom.type === "player") ? playerBottom.id : null;
    const topPsaIndex    = topId    != null ? m.players.findIndex(p => p.id === topId)    : -1;
    const bottomPsaIndex = bottomId != null ? m.players.findIndex(p => p.id === bottomId) : -1;
    result = {
      winner_id: m.result.winner_id,
      retired: m.result.retired,
      walkover: m.result.walkover,
      best_of: (m.best === "best_of_5") ? 5 : 3,
      games: (m.result.games || []).map(g => ({
        num: g.num,
        top_score:    topPsaIndex    >= 0 ? g.scores[topPsaIndex]    : null,
        bottom_score: bottomPsaIndex >= 0 ? g.scores[bottomPsaIndex] : null,
        winner_id: g.winner_id
      }))
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
    follow_on: Boolean(m.follow_on),
    follow_on_psa_id: m.follow_on_match_id || null,
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
      scheduled: false, is_estimated: false,
      text_en: "TBD", text_es: "TBD"
    };
  }
  const meta = {
    date: m.date || null,
    time: m.time ? m.time.slice(0, 5) : null,
    court: m.court || null,
    scheduled: true,
    is_estimated: false
  };
  rebuildMetaText(meta);
  return meta;
}

// Composes meta.text_en and meta.text_es from current date/time/court/is_estimated.
// Called when meta is first built, and again after follow-on estimation.
function rebuildMetaText(meta) {
  const parts_en = [];
  const parts_es = [];
  if (meta.date) {
    const d = new Date(meta.date + "T00:00:00Z");
    const opts = { weekday: "short", day: "numeric", month: "short" };
    parts_en.push(d.toLocaleDateString("en-GB", opts).toUpperCase());
    parts_es.push(d.toLocaleDateString("es-ES", opts).toUpperCase());
  }
  if (meta.time) {
    const t = meta.time.slice(0, 5);
    parts_en.push(meta.is_estimated ? `Est. ${t}` : t);
    parts_es.push(meta.is_estimated ? `Est. ${t}` : t);
  }
  if (meta.court) {
    parts_en.push(`Court ${meta.court}`);
    parts_es.push(`Pista ${meta.court}`);
  }
  meta.text_en = parts_en.length ? parts_en.join(" · ") : "TBD";
  meta.text_es = parts_es.length ? parts_es.join(" · ") : "TBD";
}

// Adds an HH:MM string to a number of minutes, wrapping at 24h. Used to project
// estimated start times for follow-on matches.
function addMinutesToHHMM(hhmm, minutes) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = ((Math.floor(total / 60) % 24) + 24) % 24;
  const newM = ((total % 60) + 60) % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

// Walks the follow_on chain and fills in estimated times. Iterates until stable
// so a chain of N back-to-back matches (A→B→C) all resolve correctly.
function resolveFollowOnTimes(matches) {
  const byPsaId = new Map(matches.map(m => [m.psa_id, m]));
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    for (const m of matches) {
      if (!m.follow_on || m.follow_on_psa_id == null) continue;
      // Skip if this match already has an explicit (non-estimated) time
      if (m.meta.time && !m.meta.is_estimated) continue;
      const pred = byPsaId.get(m.follow_on_psa_id);
      if (!pred || !pred.meta.time) continue;
      const newTime = addMinutesToHHMM(pred.meta.time, FOLLOW_ON_OFFSET_MINUTES);
      // No-op if nothing to update
      if (m.meta.time === newTime && m.meta.is_estimated) continue;
      m.meta.time = newTime;
      m.meta.is_estimated = true;
      m.meta.scheduled = true;
      if (!m.meta.date)  m.meta.date  = pred.meta.date;
      if (!m.meta.court) m.meta.court = pred.meta.court;
      rebuildMetaText(m.meta);
      changed = true;
    }
    if (!changed) break;
  }
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
