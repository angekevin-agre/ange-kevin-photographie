/**
 * Renseigne les URL absolues une fois l'adresse publique confirmée.
 *
 *   node tools/finalize-urls.mjs https://angekevin-agre.github.io/ange-kevin-photographie
 *
 * Trois éléments de référencement exigent une URL absolue et ne peuvent donc
 * pas être écrits tant que l'adresse n'est pas certaine : le lien canonique,
 * og:url et og:image, et le sitemap. Plutôt que de publier une adresse
 * supposée — qui enverrait un mauvais signal aux moteurs si elle changeait —
 * ce script les pose tous d'un coup, et peut être relancé sans dommage.
 *
 * Il écrit :
 *   - content/site.json : l'adresse confirmée, que tools/build-reportages.mjs
 *     relit pour que la régénération d'un reportage conserve canonical, og:url
 *     et og:image absolue (sans quoi la première retouche éditoriale les
 *     effacerait) ;
 *   - <link rel="canonical"> et <meta property="og:url"> dans chaque page ;
 *   - og:image en URL absolue ;
 *   - sitemap.xml ;
 *   - la directive Sitemap dans robots.txt.
 *
 * La page 404 est exclue du sitemap et reçoit un canonique vers elle-même.
 *
 * Limite assumée : sur un site de projet GitHub Pages, le robots.txt écrit
 * ici se trouve sous le sous-chemin du dépôt, où aucun robot ne le lit. La
 * directive Sitemap n'y suffira donc pas ; le script le rappelle à la fin.
 * Voir robots.txt pour le détail.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";

import { CHEMIN_CONFIG_SITE, ecrireBaseUrl, normaliserBase, urlPage, urlRessource } from "./site-config.mjs";

const base = normaliserBase(process.argv[2]);
if (!base) {
  console.error("Usage : node tools/finalize-urls.mjs <url-publique>   (http ou https, sans paramètre ni fragment)");
  process.exit(1);
}

// L'accueil en tête, le reste par ordre alphabétique : c'est aussi l'ordre
// dans lequel le sitemap sera écrit. Les pages de reportage, générées dans
// « reportages/ » par build-reportages.mjs, suivent.
const pagesHtml = async (dossier) => (await readdir(dossier || ".").catch(() => []))
  .filter((name) => name.endsWith(".html") && !name.startsWith("__"))
  .map((name) => (dossier ? `${dossier}/${name}` : name));

const pages = [
  ...(await pagesHtml(""))
    .sort((a, b) => (a === "index.html" ? -1 : b === "index.html" ? 1 : a.localeCompare(b))),
  ...(await pagesHtml("reportages")).sort(),
];

/** Insère ou remplace une balise, en conservant l'ordre du <head>. */
function upsert(html, pattern, replacement, anchor) {
  if (pattern.test(html)) return html.replace(pattern, replacement);
  return html.replace(anchor, (trouve) => `${trouve}\n${replacement}`);
}

/**
 * Rend og:image absolue. La valeur peut être :
 *   - relative à la page (état initial) : résolue contre l'URL de la page ;
 *   - déjà absolue, écrite par une exécution précédente sous une autre base :
 *     la base précédente est déduite du lien canonique, puis remplacée.
 * Le chemin propre à chaque page (visuel de partage d'un reportage) est donc
 * conservé, et relancer le script ne peut pas empiler les segments d'URL.
 */
function ogImageAbsolue(valeur, urlPage, ancienCanonique, ancienChemin) {
  if (!/^https?:\/\//.test(valeur)) return new URL(valeur, urlPage).href;
  if (ancienCanonique) {
    const ancienneBase = ancienCanonique.slice(0, ancienCanonique.length - ancienChemin.length);
    if (ancienneBase && valeur.startsWith(ancienneBase)) return urlRessource(base, valeur.slice(ancienneBase.length));
  }
  return valeur;
}

const today = new Date().toISOString().slice(0, 10);
const entries = [];

for (const page of pages) {
  const url = urlPage(base, page);
  let html = await readFile(page, "utf8");
  const ancienCanonique = html.match(/<link rel="canonical" href="([^"]*)">/)?.[1] ?? null;
  const ancienChemin = page === "index.html" ? "" : page;

  html = upsert(
    html,
    /<link rel="canonical"[^>]*>/,
    `<link rel="canonical" href="${url}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">'
  );
  html = upsert(
    html,
    /<meta property="og:url"[^>]*>/,
    `<meta property="og:url" content="${url}">`,
    /<meta property="og:type" content="[^"]*">/
  );
  html = html.replace(
    /(<meta property="og:image" content=")([^"]*)(">)/,
    (_, avant, valeur, apres) => `${avant}${ogImageAbsolue(valeur, url, ancienCanonique, ancienChemin)}${apres}`
  );

  // La page 404 porte une <base> écrite en dur : GitHub Pages la sert pour
  // des URL imbriquées, où les chemins relatifs ne résolvent plus. Elle doit
  // suivre le sous-chemin réel de publication (voir 404.html).
  if (page === "404.html") {
    const segments = new URL(base).pathname.split("/").filter(Boolean);
    const sousChemin = segments.length ? `/${segments.join("/")}/` : "/";
    html = html.replace(/(<base href=")[^"]*(">)/, `$1${sousChemin}$2`);
  }

  await writeFile(page, html, "utf8");
  if (page !== "404.html") entries.push(url);
  console.log(`mis à jour : ${page}`);
}

// L'adresse est mémorisée avant toute régénération ultérieure des reportages.
await ecrireBaseUrl(base);
console.log(`écrit : ${CHEMIN_CONFIG_SITE}`);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((url) => `  <url>\n    <loc>${url}</loc>\n    <lastmod>${today}</lastmod>\n  </url>`).join("\n")}
</urlset>
`;
await writeFile("sitemap.xml", sitemap, "utf8");
console.log(`écrit : sitemap.xml (${entries.length} URL)`);

let robots = await readFile("robots.txt", "utf8");
robots = /^Sitemap:/m.test(robots)
  ? robots.replace(/^Sitemap:.*$/m, `Sitemap: ${base}/sitemap.xml`)
  : `${robots.trimEnd()}\n\nSitemap: ${base}/sitemap.xml\n`;
await writeFile("robots.txt", robots, "utf8");
console.log("mis à jour : robots.txt");

// Avertissement : sous un sous-chemin, robots.txt n'est lu par aucun robot.
const sousChemin = new URL(base).pathname.split("/").filter(Boolean).join("/");
if (sousChemin) {
  console.warn(
    `\nAttention : le site est publié sous le sous-chemin « /${sousChemin}/ ».` +
    "\nUn robot ne lit robots.txt qu'à la racine de l'hôte : le fichier écrit" +
    "\nici ne sera donc pas consulté, directive Sitemap comprise. Déclarer" +
    `\n${base}/sitemap.xml directement dans l'outil pour webmasters du moteur.`
  );
}
