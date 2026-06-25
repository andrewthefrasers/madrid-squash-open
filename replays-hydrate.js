/* ===========================================================================
 * replays-hydrate.js  —  Madrid Squash Open session replays
 * ---------------------------------------------------------------------------
 * Reads /replays.json and renders a thumbnail gallery into #replays-container
 * (inside the Watch section). Each card shows the YouTube thumbnail with a
 * play button; the actual player (youtube-nocookie.com) loads only on click —
 * fast and privacy-friendly. Entries with a blank/invalid id show a tidy
 * "Coming soon" tile.
 *
 * Bilingual: title and tag carry data-en/data-es, so the site's existing
 * setLang() swaps them automatically — no extra wiring, and a playing video
 * is not interrupted by a language switch.
 * ===========================================================================*/
(function () {
  "use strict";

  var URL_JSON = "/replays.json";
  var ID_RE = /^[A-Za-z0-9_-]{6,}$/;

  function curLang() {
    var l = (document.documentElement.getAttribute("lang") || "en").toLowerCase();
    return l.indexOf("es") === 0 ? "es" : "en";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function txt(v) { return curLang() === "es" ? (v.es || v.en) : (v.en || v.es); }

  function fetchJSON(url) {
    return fetch(url + (url.indexOf("?") < 0 ? "?v=" : "&v=") + Date.now(), { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });
  }

  function card(v) {
    var id = (v.youtube_id || "").trim();
    var valid = ID_RE.test(id);
    var title = { en: v.title_en, es: v.title_es };
    var label = { en: v.label_en, es: v.label_es };
    var el = document.createElement("div");
    el.className = "replay-card" + (valid ? "" : " replay-card--soon");

    var tag = '<span class="replay-tag" data-en="' + esc(label.en) + '" data-es="' +
      esc(label.es) + '">' + esc(txt(label)) + "</span>";
    var titleH = '<h4 class="replay-title" data-en="' + esc(title.en) + '" data-es="' +
      esc(title.es) + '">' + esc(txt(title)) + "</h4>";

    if (valid) {
      el.innerHTML =
        '<div class="replay-media">' +
          '<button class="replay-thumb" type="button" aria-label="Play">' +
            '<img class="replay-img" loading="lazy" alt="" ' +
              'src="https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg" ' +
              "onerror=\"this.onerror=null;this.src='https://i.ytimg.com/vi/" + id + "/hqdefault.jpg'\">" +
            '<span class="replay-play" aria-hidden="true"></span>' + tag +
          "</button>" +
        "</div>" + titleH;
      el.querySelector(".replay-thumb").addEventListener("click", function () {
        var media = el.querySelector(".replay-media");
        var f = document.createElement("iframe");
        f.className = "replay-iframe";
        f.src = "https://www.youtube-nocookie.com/embed/" + id +
          "?autoplay=1&rel=0&modestbranding=1";
        f.title = txt(title);
        f.setAttribute("frameborder", "0");
        f.setAttribute("allow", "autoplay; encrypted-media; picture-in-picture; fullscreen");
        f.setAttribute("allowfullscreen", "");
        media.innerHTML = "";
        media.appendChild(f);
      });
    } else {
      el.innerHTML =
        '<div class="replay-media">' +
          '<div class="replay-thumb replay-thumb--soon">' + tag +
            '<span class="replay-soon" data-en="Coming soon" data-es="Próximamente">' +
            (curLang() === "es" ? "Próximamente" : "Coming soon") + "</span>" +
          "</div>" +
        "</div>" + titleH;
    }
    return el;
  }

  function render(list) {
    var root = document.getElementById("replays-container");
    if (!root) return;
    var vids = (list || []).slice().sort(function (a, b) {
      return (b.date || "").localeCompare(a.date || "");
    });
    var grid = document.createElement("div");
    grid.className = "replay-grid";
    vids.forEach(function (v) { grid.appendChild(card(v)); });
    root.innerHTML = "";
    root.appendChild(grid);
  }

  function boot() {
    fetchJSON(URL_JSON).then(function (d) { render(d && d.videos); })
      .catch(function (e) { console.error("[replays] load failed", e); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
