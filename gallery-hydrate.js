/* ===========================================================================
 * gallery-hydrate.js  —  Madrid Squash Open photo gallery
 * ---------------------------------------------------------------------------
 * Reads /gallery.json and renders a responsive thumbnail grid into
 * #gallery-container, with a click-to-enlarge lightbox (prev/next, keyboard
 * arrows, Esc/backdrop to close). Scales to any number of photos.
 *
 * Bilingual: lightbox captions carry data-en/data-es, so the site's existing
 * setLang() keeps them in sync.
 *
 * To publish: drop photos in /images/gallery/ and add entries to gallery.json
 * (fields: src, alt, caption_en, caption_es).
 * ===========================================================================*/
(function () {
  "use strict";

  var URL_JSON = "/gallery.json";
  var photos = [];

  function curLang() {
    var l = (document.documentElement.getAttribute("lang") || "en").toLowerCase();
    return l.indexOf("es") === 0 ? "es" : "en";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function cap(p) { return curLang() === "es" ? (p.caption_es || p.caption_en || "") : (p.caption_en || p.caption_es || ""); }

  function fetchJSON(url) {
    return fetch(url + (url.indexOf("?") < 0 ? "?v=" : "&v=") + Date.now(), { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });
  }

  /* ---------- grid -------------------------------------------------------- */
  function render() {
    var root = document.getElementById("gallery-container");
    if (!root) return;
    var grid = document.createElement("div");
    grid.className = "gal-grid";
    photos.forEach(function (p, i) {
      var cell = document.createElement("div");
      cell.className = "gal-cell";
      cell.setAttribute("role", "button");
      cell.setAttribute("tabindex", "0");
      cell.setAttribute("aria-label", p.alt || cap(p) || "Photo");
      cell.innerHTML = '<img src="' + esc(p.src) + '" alt="' + esc(p.alt || cap(p)) + '" loading="lazy">';
      cell.addEventListener("click", function () { open(i); });
      cell.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); }
      });
      grid.appendChild(cell);
    });
    root.innerHTML = "";
    root.appendChild(grid);
  }

  /* ---------- lightbox ---------------------------------------------------- */
  var cur = 0;
  function box() {
    var o = document.getElementById("gal-lightbox");
    if (!o) {
      o = document.createElement("div");
      o.id = "gal-lightbox";
      o.setAttribute("aria-hidden", "true");
      o.innerHTML =
        '<div class="gal-lb__backdrop" data-close></div>' +
        '<button class="gal-lb__close" data-close aria-label="Close">\u00d7</button>' +
        '<button class="gal-lb__nav gal-lb__prev" aria-label="Previous">\u2039</button>' +
        '<button class="gal-lb__nav gal-lb__next" aria-label="Next">\u203a</button>' +
        '<figure class="gal-lb__figure">' +
          '<img class="gal-lb__img" alt="">' +
          '<figcaption class="gal-lb__cap"></figcaption>' +
        "</figure>" +
        '<span class="gal-lb__count"></span>';
      document.body.appendChild(o);
      o.addEventListener("click", function (e) {
        if (e.target.hasAttribute("data-close")) close();
      });
      o.querySelector(".gal-lb__prev").addEventListener("click", function () { step(-1); });
      o.querySelector(".gal-lb__next").addEventListener("click", function () { step(1); });
      document.addEventListener("keydown", function (e) {
        if (!o.classList.contains("is-open")) return;
        if (e.key === "Escape") close();
        else if (e.key === "ArrowLeft") step(-1);
        else if (e.key === "ArrowRight") step(1);
      });
    }
    return o;
  }
  function show() {
    var o = box(), p = photos[cur];
    o.querySelector(".gal-lb__img").src = p.src;
    o.querySelector(".gal-lb__img").alt = p.alt || cap(p) || "";
    var capEl = o.querySelector(".gal-lb__cap");
    capEl.textContent = cap(p);
    capEl.setAttribute("data-en", p.caption_en || "");
    capEl.setAttribute("data-es", p.caption_es || p.caption_en || "");
    capEl.style.display = cap(p) ? "" : "none";
    o.querySelector(".gal-lb__count").textContent = (cur + 1) + " / " + photos.length;
    var multi = photos.length > 1;
    o.querySelector(".gal-lb__prev").style.display = multi ? "" : "none";
    o.querySelector(".gal-lb__next").style.display = multi ? "" : "none";
  }
  function open(i) {
    cur = i; show();
    var o = box();
    o.classList.add("is-open");
    o.setAttribute("aria-hidden", "false");
    document.body.classList.add("gal-noscroll");
  }
  function step(d) { cur = (cur + d + photos.length) % photos.length; show(); }
  function close() {
    var o = document.getElementById("gal-lightbox");
    if (o) { o.classList.remove("is-open"); o.setAttribute("aria-hidden", "true"); }
    document.body.classList.remove("gal-noscroll");
  }

  /* ---------- boot -------------------------------------------------------- */
  function boot() {
    fetchJSON(URL_JSON).then(function (d) {
      photos = (d && d.photos) || [];
      render();
    }).catch(function (e) { console.error("[gallery] load failed", e); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
