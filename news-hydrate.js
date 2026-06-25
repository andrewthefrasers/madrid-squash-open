/* ===========================================================================
 * news-hydrate.js  —  Madrid Squash Open news section
 * ---------------------------------------------------------------------------
 * Pure static, no Worker endpoint. Reads:
 *   /news/index.json          manifest: { "articles": [slug, ...] }
 *   /news/<slug>.json         one file per article
 *   /images/news/<file>       hero + inline images
 *
 * Renders cards using the site's EXISTING card classes (news-card, news-img,
 * news-body, news-date, news-headline, news-excerpt, news-category) so they
 * look identical to the hard-coded cards, into #news-container. Clicking a
 * card opens a full-article overlay. Deep-linkable via #news/<slug>.
 *
 * Language: auto-detects EN/ES (reads <html lang>, which setLang() already
 * sets) and re-renders on change. setLang() also calls MSO_setNewsLang().
 * ===========================================================================*/
(function () {
  "use strict";

  var MANIFEST_URL = "/news/index.json";
  var ARTICLE_URL = function (slug) { return "/news/" + slug + ".json"; };
  var IMG_BASE = "/images/news/";

  var STRINGS = {
    en: { back: "Back to news", empty: "No news yet — check back during the tournament." },
    es: { back: "Volver a noticias", empty: "Aún no hay noticias — vuelve durante el torneo." }
  };

  var state = { lang: "en", articles: [], loaded: false };

  /* ---------- language ---------------------------------------------------- */
  function detectLang() {
    var h = (document.documentElement.getAttribute("lang") || "").toLowerCase();
    if (h.indexOf("es") === 0) return "es";
    if (typeof window.currentLang === "string" && window.currentLang.indexOf("es") === 0) return "es";
    return "en";
  }
  function pick(obj, base) {
    var v = obj[base + "_" + state.lang];
    if (v === undefined || v === null || v === "") v = obj[base + "_en"];
    return v || "";
  }

  /* ---------- tiny, safe markdown ----------------------------------------- */
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    return s;
  }
  function markdown(src) {
    if (!src) return "";
    var blocks = String(src).replace(/\r\n/g, "\n").split(/\n{2,}/);
    var html = "";
    blocks.forEach(function (b) {
      var lines = b.split("\n");
      if (lines.every(function (l) { return /^\s*[-*]\s+/.test(l); })) {
        html += "<ul>" + lines.map(function (l) {
          return "<li>" + inline(l.replace(/^\s*[-*]\s+/, "")) + "</li>";
        }).join("") + "</ul>";
      } else if (/^#{1,6}\s/.test(lines[0])) {
        var m = lines[0].match(/^(#{1,6})\s+(.*)$/);
        var lvl = Math.min(m[1].length + 2, 6);
        html += "<h" + lvl + ">" + inline(m[2]) + "</h" + lvl + ">";
      } else {
        html += "<p>" + lines.map(inline).join("<br>") + "</p>";
      }
    });
    return html;
  }

  /* ---------- data -------------------------------------------------------- */
  function fetchJSON(url) {
    return fetch(url + (url.indexOf("?") < 0 ? "?v=" : "&v=") + Date.now(), { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(url + " " + r.status); return r.json(); });
  }
  function load() {
    return fetchJSON(MANIFEST_URL).then(function (m) {
      var slugs = (m && m.articles) || [];
      return Promise.all(slugs.map(function (slug) {
        return fetchJSON(ARTICLE_URL(slug)).catch(function () { return null; });
      }));
    }).then(function (list) {
      state.articles = list.filter(Boolean).sort(function (a, b) {
        return (b.date || "").localeCompare(a.date || "");
      });
      state.loaded = true;
    });
  }
  function fmtDate(iso) {
    try {
      return new Date(iso + "T12:00:00").toLocaleDateString(
        state.lang === "es" ? "es-ES" : "en-GB",
        { day: "numeric", month: "long", year: "numeric" });
    } catch (e) { return iso; }
  }

  /* ---------- cards (native markup) --------------------------------------- */
  function render() {
    var root = document.getElementById("news-container");
    if (!root) return;
    if (!state.loaded) { return; }
    if (!state.articles.length) {
      root.innerHTML = '<p class="news-empty">' + STRINGS[state.lang].empty + "</p>";
      return;
    }
    var grid = document.createElement("div");
    grid.className = "news-grid";
    state.articles.forEach(function (a) {
      var card = document.createElement("article");
      card.className = "news-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      var cat = pick(a, "category");
      var media = a.hero_image
        ? '<div class="news-img"><img src="' + IMG_BASE + esc(a.hero_image) +
          '" alt="" class="news-img-inner" loading="lazy">' +
          (cat ? '<span class="news-category">' + esc(cat) + "</span>" : "") + "</div>"
        : '<div class="news-img news-img--placeholder">' +
          (cat ? '<span class="news-category">' + esc(cat) + "</span>" : "") + "</div>";
      card.innerHTML =
        media +
        '<div class="news-body">' +
          '<div class="news-date">' + esc(fmtDate(a.date)) + "</div>" +
          '<h3 class="news-headline">' + esc(pick(a, "title")) + "</h3>" +
          '<p class="news-excerpt">' + esc(pick(a, "summary")) + "</p>" +
        "</div>";
      function open() { location.hash = "news/" + a.slug; }
      card.addEventListener("click", open);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      grid.appendChild(card);
    });
    root.innerHTML = "";
    root.appendChild(grid);
  }

  /* ---------- article overlay -------------------------------------------- */
  function overlayEl() {
    var o = document.getElementById("news-overlay");
    if (!o) {
      o = document.createElement("div");
      o.id = "news-overlay";
      o.setAttribute("aria-hidden", "true");
      o.innerHTML =
        '<div class="news-overlay__backdrop" data-close></div>' +
        '<div class="news-overlay__panel" role="dialog" aria-modal="true">' +
          '<button class="news-overlay__close" data-close aria-label="Close">\u00d7</button>' +
          '<div class="news-overlay__content"></div>' +
        "</div>";
      document.body.appendChild(o);
      o.addEventListener("click", function (e) {
        if (e.target.hasAttribute("data-close")) closeArticle();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && o.classList.contains("is-open")) closeArticle();
      });
    }
    return o;
  }
  function openArticle(slug) {
    var a = state.articles.filter(function (x) { return x.slug === slug; })[0];
    if (!a) return;
    var o = overlayEl();
    var c = o.querySelector(".news-overlay__content");
    var hero = a.hero_image
      ? '<figure class="news-article__hero"><img src="' + IMG_BASE + esc(a.hero_image) + '" alt=""></figure>'
      : "";
    var extra = (a.images || []).map(function (im) {
      var cap = state.lang === "es" ? (im.caption_es || im.caption_en) : (im.caption_en || im.caption_es);
      return '<figure class="news-article__figure"><img src="' + IMG_BASE + esc(im.file) + '" alt="">' +
        (cap ? "<figcaption>" + esc(cap) + "</figcaption>" : "") + "</figure>";
    }).join("");
    var srcLabel = state.lang === "es" ? a.source_label_es : a.source_label_en;
    var src = "";
    if (srcLabel) {
      src = '<p class="news-article__source">' +
        (a.source_url ? '<a href="' + esc(a.source_url) + '" target="_blank" rel="noopener noreferrer">' + esc(srcLabel) + "</a>" : esc(srcLabel)) +
        "</p>";
    }
    // NB: back is a <button>, not an <a href="#"> — the site's global click
    // handler hijacks every "#" link, so a button avoids that entirely.
    c.innerHTML =
      '<button class="news-article__back" type="button">\u2190 ' + STRINGS[state.lang].back + "</button>" +
      '<span class="news-article__date">' + esc(fmtDate(a.date)) + "</span>" +
      '<h1 class="news-article__title">' + esc(pick(a, "title")) + "</h1>" +
      hero +
      '<div class="news-article__body">' + markdown(pick(a, "body")) + "</div>" +
      extra + src;
    c.querySelector(".news-article__back").addEventListener("click", closeArticle);
    c.scrollTop = 0;
    o.classList.add("is-open");
    o.setAttribute("aria-hidden", "false");
    document.body.classList.add("news-noscroll");
  }
  function closeArticle() {
    var o = document.getElementById("news-overlay");
    if (o) { o.classList.remove("is-open"); o.setAttribute("aria-hidden", "true"); }
    document.body.classList.remove("news-noscroll");
    if (/^#news\//.test(location.hash)) {
      if (history.pushState) history.pushState(null, "", "#news");
      else location.hash = "news";
    }
  }

  /* ---------- routing ----------------------------------------------------- */
  function route() {
    var m = location.hash.match(/^#news\/(.+)$/);
    if (m && state.loaded) openArticle(decodeURIComponent(m[1]));
    else closeArticle();
  }

  /* ---------- language wiring -------------------------------------------- */
  window.MSO_setNewsLang = function (lang) {
    lang = (lang || "").toLowerCase().indexOf("es") === 0 ? "es" : "en";
    if (lang === state.lang) return;
    state.lang = lang;
    render();
    if (/^#news\//.test(location.hash)) route();
  };
  try {
    new MutationObserver(function () {
      var l = detectLang();
      if (l !== state.lang) window.MSO_setNewsLang(l);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  } catch (e) {}

  /* ---------- boot -------------------------------------------------------- */
  function boot() {
    state.lang = detectLang();
    load().then(function () { render(); route(); }).catch(function (err) {
      console.error("[news] load failed", err);
      var root = document.getElementById("news-container");
      if (root) root.innerHTML = '<p class="news-empty">' + STRINGS[state.lang].empty + "</p>";
    });
    window.addEventListener("hashchange", route);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
