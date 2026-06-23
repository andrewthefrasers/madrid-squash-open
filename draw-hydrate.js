/* ============================================================================
 * Live draw hydration for madridsquashopen.com
 *
 * Fetches /api/draw on page load (Worker → PSA, cached at edge), then
 * rebuilds:
 *   #draw-men    – the 22-card player list in the Draw section
 *   #bracket     – the 31 match-boxes in the Tournament Bracket
 *
 * Re-runs setLang() afterwards so the EN/ES toggle works on the new DOM.
 * On fetch failure the existing static markup remains untouched.
 * ============================================================================ */
(function () {
  const DRAW_ENDPOINT = "/api/draw";
  const POLL_INTERVAL_MS = 30000; // 30s — live score refresh
  const drawGrid = document.getElementById("draw-men");
  const bracketEl = document.getElementById("bracket");
  if (!drawGrid || !bracketEl) return;

  let lastGeneratedAt = null;
  let pollHandle = null;

  function hydrate() {
    return fetch(DRAW_ENDPOINT + "?ts=" + Date.now(), { credentials: "omit", cache: "no-store" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!data || !data.players || !data.matches) {
          console.warn("[draw-hydrate] unexpected response shape", data);
          return;
        }
        if (data.generated_at && data.generated_at === lastGeneratedAt) {
          return; // no change, skip re-render
        }
        lastGeneratedAt = data.generated_at;

        // Preserve horizontal scroll position of the bracket on re-render
        const prevScrollLeft = bracketEl.scrollLeft;
        renderDrawSection(drawGrid, data.players);
        renderBracket(bracketEl, data.matches);
        bracketEl.scrollLeft = prevScrollLeft;

        if (typeof setLang === "function" && typeof currentLang !== "undefined") {
          setLang(currentLang);
        }
        console.log(`[draw-hydrate] rendered ${data.players.length} cards, ${data.matches.length} matches (generated ${data.generated_at})`);
      })
      .catch(err => {
        console.warn("[draw-hydrate] fetch failed:", err.message);
      });
  }

  // Initial render
  hydrate();

  // Poll every 30s while the tab is visible. Skip while hidden to save bandwidth and PSA calls.
  function startPolling() { if (!pollHandle) pollHandle = setInterval(hydrate, POLL_INTERVAL_MS); }
  function stopPolling()  { if (pollHandle) { clearInterval(pollHandle); pollHandle = null; } }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopPolling();
    else { hydrate(); startPolling(); }
  });
  if (!document.hidden) startPolling();

  // ===========================================================================
  // DRAW SECTION (the 22-card grid)
  // ===========================================================================
  function renderDrawSection(container, players) {
    // Categorise → render in visual groups (top seeds, 9/16, unseeded, wildcards)
    const topSeeds  = players.filter(p => p.category === "top_seed").sort((a, b) => a.seed - b.seed);
    const seeds916  = players.filter(p => p.category === "seed_9_16").sort((a, b) => a.position - b.position);
    const unseeded  = players.filter(p => p.category === "unseeded").sort((a, b) => a.position - b.position);
    const wildcards = players.filter(p => p.category === "wildcard");
    const qTbd      = players.filter(p => p.category === "qualifier_tbd");

    const parts = [];
    parts.push("<!-- TOP 8 SEEDS -->");
    parts.push(...topSeeds.map(p => playerCardHtml(p, "seed", String(p.seed))));
    if (seeds916.length) {
      parts.push("<!-- 9/16 SEEDED -->");
      parts.push(...seeds916.map(p => playerCardHtml(p, "seed-group", "9/16")));
    }
    if (unseeded.length) {
      parts.push("<!-- UNSEEDED -->");
      parts.push(...unseeded.map(p => playerCardHtml(p, "seed-none", "—")));
    }
    if (wildcards.length || qTbd.length) {
      parts.push("<!-- WILDCARDS -->");
      parts.push(...wildcards.map(p => wildcardCardHtml(p)));
      parts.push(...qTbd.map(() => qualifierTbdCardHtml()));
    }
    container.innerHTML = parts.join("\n");
  }

  function playerCardHtml(p, seedClass, seedText) {
    const cls = seedClass === "seed" ? "player-seed" : `player-seed ${seedClass}`;
    return `<div class="player-card">`
      + `<span class="${cls}">${escapeHtml(seedText)}</span>`
      + `<div class="player-info">`
      +   `<div class="player-name">${escapeHtml(p.full_name)}</div>`
      +   `<div class="player-country">${escapeHtml(p.country_ioc)}</div>`
      + `</div>`
      + `<span class="player-rank">WR ${p.ranking_at_entry ?? "—"}</span>`
      + `<span class="fi fi-${p.country} player-flag" aria-hidden="true"></span>`
      + `</div>`;
  }

  function wildcardCardHtml(p) {
    return `<div class="player-card wildcard-confirmed">`
      + `<span class="player-seed seed-wc">WC</span>`
      + `<div class="player-info">`
      +   `<div class="player-name">${escapeHtml(p.full_name)}</div>`
      +   `<div class="player-country" data-en="${escapeHtml(p.country_ioc)} · Local Wildcard" data-es="${escapeHtml(p.country_ioc)} · Invitado Local">${escapeHtml(p.country_ioc)} · Local Wildcard</div>`
      + `</div>`
      + `<span class="player-rank">WR ${p.ranking_at_entry ?? "—"}</span>`
      + `<span class="fi fi-${p.country} player-flag" aria-hidden="true"></span>`
      + `</div>`;
  }

  function qualifierTbdCardHtml() {
    return `<div class="player-card wildcard-tbd">`
      + `<span class="player-seed seed-wc-tbd">WC</span>`
      + `<div class="player-info">`
      +   `<div class="player-name" data-en="Qualifier" data-es="Clasificatorio">Qualifier</div>`
      +   `<div class="player-country" data-en="To be decided" data-es="A determinar">To be decided</div>`
      + `</div>`
      + `<span class="player-rank">TBD</span>`
      + `<span class="fi fi-un player-flag" aria-hidden="true"></span>`
      + `</div>`;
  }

  // ===========================================================================
  // BRACKET (31 match boxes)
  // ===========================================================================
  function renderBracket(container, matches) {
    // Group by round
    const grouped = { r1: [], r16: [], qf: [], sf: [], f: [] };
    matches.forEach(m => { if (grouped[m.round]) grouped[m.round].push(m); });
    Object.keys(grouped).forEach(k => grouped[k].sort((a, b) => a.match_num - b.match_num));

    container.innerHTML =
        roundHtml("round-r1",  "r1",  "Round 1",          "Ronda 1",          grouped.r1)
      + roundHtml("round-l16", "l16", "Round of 16",      "Octavos de Final", grouped.r16)
      + roundHtml("round-qf",  "qf",  "Quarter-Finals",   "Cuartos",          grouped.qf)
      + roundHtml("round-sf",  "sf",  "Semi-Finals",      "Semifinales",      grouped.sf)
      + roundHtml("round-f",   "f",   "Final",            "Final",            grouped.f);
  }

  function roundHtml(id, dataRound, headerEn, headerEs, matches) {
    const matchesHtml = matches.map(matchHtml).join("\n");
    return `<div class="bracket-round" id="${id}" data-round="${dataRound}">`
      + `<div class="bracket-round-header" data-en="${escapeHtml(headerEn)}" data-es="${escapeHtml(headerEs)}">${escapeHtml(headerEn)}</div>`
      + `<div class="bracket-round-body">${matchesHtml}</div>`
      + `</div>`;
  }

  function matchHtml(m) {
    const metaEn = m.meta.text_en || "TBD";
    const metaEs = m.meta.text_es || "TBD";
    const metaCls = m.meta.scheduled ? "match-meta scheduled" : "match-meta";
    const isLive = m.status === "in_progress";
    const isCompleted = m.status === "completed";
    // Show games-won + per-game scores whenever PSA has live or final data
    const showScores = isLive || isCompleted;
    const winnerId = m.result ? m.result.winner_id : null;
    const matchCls = isLive ? "match is-live" : "match";
    // Build two per-slot arrays of game scores (length 5, padded with null)
    const topGames    = extractGameScores(m, "top");
    const bottomGames = extractGameScores(m, "bottom");
    return `<div class="match-slot"><div class="${matchCls}" data-match="${m.id}">`
      + `<div class="${metaCls}" data-en="${escapeHtml(metaEn)}" data-es="${escapeHtml(metaEs)}">${escapeHtml(metaEn)}</div>`
      + slotHtml(m.player_top,    winnerId, topGames,    showScores)
      + slotHtml(m.player_bottom, winnerId, bottomGames, showScores)
      + `</div></div>`;
  }

  function extractGameScores(m, side) {
    const out = [null, null, null, null, null];
    if (!m.result || !m.result.games) return out;
    m.result.games.forEach(g => {
      const idx = (g.num || 1) - 1;
      if (idx >= 0 && idx < 5) {
        out[idx] = (side === "top") ? g.top_score : g.bottom_score;
      }
    });
    return out;
  }

  function slotHtml(slot, winnerId, gameScores, showScores) {
    // gameScores: array of 5 entries (number or null)
    const gameCellsHtml = (gameScores || [null, null, null, null, null])
      .map(s => s == null
        ? `<span class="match-game-cell empty">-</span>`
        : `<span class="match-game-cell">${s}</span>`)
      .join("");

    if (!slot || slot.type === "tbd") {
      return `<div class="match-player tbd">`
        + `<span class="player-seed-mini"></span>`
        + `<span class="player-flag-mini empty"></span>`
        + `<span class="player-name-mini" data-en="TBD" data-es="TBD">TBD</span>`
        + `<span class="match-score-mini">-</span>`
        + gameCellsHtml
        + `</div>`;
    }
    if (slot.type === "bye") {
      return `<div class="match-player bye">`
        + `<span class="player-seed-mini"></span>`
        + `<span class="player-flag-mini empty"></span>`
        + `<span class="player-name-mini" data-en="BYE" data-es="BYE">BYE</span>`
        + `<span class="match-score-mini">-</span>`
        + gameCellsHtml
        + `</div>`;
    }
    if (slot.type === "qualifier") {
      return `<div class="match-player tbd">`
        + `<span class="player-seed-mini">WC</span>`
        + `<span class="fi fi-un player-flag-mini"></span>`
        + `<span class="player-name-mini" data-en="Qualifier" data-es="Clasificatorio">Qualifier</span>`
        + `<span class="match-score-mini">-</span>`
        + gameCellsHtml
        + `</div>`;
    }
    // type === "player"
    const isWinner = (winnerId != null && slot.id === winnerId);
    const winnerCls = isWinner ? " winner" : "";
    const seedHtml = slot.seed ? `<span class="player-seed-mini">${slot.seed}</span>` : `<span class="player-seed-mini"></span>`;
    const flagHtml = slot.country ? `<span class="fi fi-${escapeHtml(slot.country)} player-flag-mini"></span>` : `<span class="player-flag-mini empty"></span>`;
    const score = showScores ? slot.games_won : "-";
    return `<div class="match-player${winnerCls}">`
      + seedHtml
      + flagHtml
      + `<span class="player-name-mini">${escapeHtml(slot.display_name)}</span>`
      + `<span class="match-score-mini">${escapeHtml(String(score))}</span>`
      + gameCellsHtml
      + `</div>`;
  }

  // ===========================================================================
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
})();
