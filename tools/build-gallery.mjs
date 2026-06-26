// tools/build-gallery.mjs
// Regenerates gallery.json from the contents of images/gallery/.
// - Auto-adds every image in images/gallery/ (alphabetical → control order with
//   filename prefixes like 01-, 02-).
// - Preserves any captions/alt you set before (matched by src), so captions you
//   add once survive future regenerations.
// - Preserves "manual" entries whose src is NOT under images/gallery/ (e.g. the
//   original /images/Galeria*.jpg), so nothing already on the page is dropped.
import { readdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const DIR = "images/gallery";
const OUT = "gallery.json";
const EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

let prev = {};
let manual = [];
if (existsSync(OUT)) {
  try {
    const j = JSON.parse(readFileSync(OUT, "utf8"));
    for (const p of j.photos || []) {
      if (!p || !p.src) continue;
      prev[p.src] = p;
      if (!p.src.startsWith("/" + DIR + "/")) manual.push(p); // pinned, kept as-is
    }
  } catch (e) { console.warn("Could not parse existing gallery.json:", e.message); }
}

const files = existsSync(DIR)
  ? readdirSync(DIR).filter(f => EXT.has(f.split(".").pop().toLowerCase())).sort()
  : [];

const auto = files.map(f => {
  const src = "/" + DIR + "/" + f;
  const ex = prev[src] || {};
  return {
    src,
    alt: ex.alt || "",
    caption_en: ex.caption_en || "",
    caption_es: ex.caption_es || ""
  };
});

// Newly dropped tournament photos lead; the original pinned photos follow.
const photos = [...auto, ...manual];
writeFileSync(OUT, JSON.stringify({ photos }, null, 2) + "\n");
console.log(`gallery.json rebuilt: ${auto.length} from ${DIR}/ + ${manual.length} pinned = ${photos.length} total`);
