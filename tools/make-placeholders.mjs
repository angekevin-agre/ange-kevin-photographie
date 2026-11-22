/**
 * Génère les emplacements photographiques (SVG) utilisés tant que les
 * photographies réelles ne sont pas fournies.
 *
 *   node tools/make-placeholders.mjs
 *
 * Chaque fichier est un SVG local et léger : aucune dépendance externe,
 * aucune image générée présentée comme une photographie du studio. Le visuel
 * reprend le vocabulaire du tirage (dégradé tonal, bande d'essai, rebord)
 * et porte la mention « emplacement photographie ».
 *
 * Pour ajouter un format : compléter PLATES puis relancer la commande.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT = join("assets", "img", "placeholders");

/** Variations tonales, pour que les compositions ne paraissent pas plates. */
const TONES = [
  { from: "#2b2b31", mid: "#1d1d21", to: "#131316" },
  { from: "#24242a", mid: "#18181c", to: "#101013" },
  { from: "#2f2c27", mid: "#201e1b", to: "#151413" },
];

const PLATES = [
  { name: "plate-3x2-a", w: 1800, h: 1200, ratio: "3:2", tone: 0, angle: 28 },
  { name: "plate-3x2-b", w: 1800, h: 1200, ratio: "3:2", tone: 2, angle: 152 },
  { name: "plate-2x3-a", w: 1200, h: 1800, ratio: "2:3", tone: 1, angle: 20 },
  { name: "plate-2x3-b", w: 1200, h: 1800, ratio: "2:3", tone: 2, angle: 200 },
  { name: "plate-4x5-a", w: 1440, h: 1800, ratio: "4:5", tone: 0, angle: 340 },
  { name: "plate-5x4-a", w: 1800, h: 1440, ratio: "5:4", tone: 1, angle: 110 },
  { name: "plate-16x9-a", w: 1920, h: 1080, ratio: "16:9", tone: 2, angle: 8 },
  { name: "plate-1x1-a", w: 1400, h: 1400, ratio: "1:1", tone: 0, angle: 230 },
];

/** Bande d'essai tonale, clin d'œil au tirage de lecture. */
function wedge(x, y, band, height) {
  const steps = ["#141417", "#232327", "#343439", "#47474d", "#5c5c62"];
  return steps
    .map(
      (fill, i) =>
        `<rect x="${x + i * band}" y="${y}" width="${band}" height="${height}" fill="${fill}"/>`
    )
    .join("");
}

function corner(x, y, sx, sy, size, stroke) {
  return (
    `<path d="M${x} ${y + sy * size}V${y}H${x + sx * size}" ` +
    `fill="none" stroke="${stroke}" stroke-width="2"/>`
  );
}

function plate({ name, w, h, ratio, tone, angle }) {
  const t = TONES[tone];
  const inset = Math.round(Math.min(w, h) * 0.022);
  const label = Math.round(Math.min(w, h) * 0.026);
  const band = Math.round(Math.min(w, h) * 0.028);
  const mark = Math.round(Math.min(w, h) * 0.05);
  const font = "ui-monospace, 'Courier New', monospace";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true">
  <defs>
    <linearGradient id="t" gradientTransform="rotate(${angle} .5 .5)">
      <stop offset="0" stop-color="${t.from}"/>
      <stop offset=".55" stop-color="${t.mid}"/>
      <stop offset="1" stop-color="${t.to}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#t)"/>
  <rect x="${inset}" y="${inset}" width="${w - inset * 2}" height="${h - inset * 2}" fill="none" stroke="#3a372f" stroke-width="2"/>
  ${corner(inset * 2, inset * 2, 1, 1, mark, "#4a4639")}
  ${corner(w - inset * 2, h - inset * 2, -1, -1, mark, "#4a4639")}
  ${wedge(inset * 2, h - inset * 2 - band, band, band)}
  <text x="50%" y="${h / 2}" text-anchor="middle" font-family="${font}" font-size="${label}" letter-spacing="${label * 0.28}" fill="#a19b91">EMPLACEMENT</text>
  <text x="50%" y="${h / 2 + label * 2.2}" text-anchor="middle" font-family="${font}" font-size="${label}" letter-spacing="${label * 0.28}" fill="#a19b91">PHOTOGRAPHIE</text>
  <text x="${w - inset * 2}" y="${inset * 2 + label}" text-anchor="end" font-family="${font}" font-size="${label * 0.9}" letter-spacing="${label * 0.2}" fill="#7d776f">${ratio}</text>
</svg>
`;
}

await mkdir(OUT, { recursive: true });
await Promise.all(
  PLATES.map((spec) => writeFile(join(OUT, `${spec.name}.svg`), plate(spec), "utf8"))
);
console.log(`${PLATES.length} emplacements écrits dans ${OUT}`);
