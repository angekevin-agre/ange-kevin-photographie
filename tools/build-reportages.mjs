/**
 * Génère les pages de reportage et leur index dans le portfolio.
 *
 *   node tools/build-reportages.mjs           écrit les fichiers
 *   node tools/build-reportages.mjs --check   vérifie qu'ils sont à jour (code 1 sinon)
 *
 * Entrées :
 *   content/reportages/<slug>.json                 récit, chapitres, photos
 *   assets/img/reportages/<slug>/manifest.json     formats web (optimize-photos.mjs)
 *
 * Sorties :
 *   reportages/<slug>.html                          une page statique par reportage
 *   portfolio.html                                  cartes injectées entre les
 *                                                   marqueurs « reportages:debut/fin »
 *
 * Pourquoi générer plutôt que rendre côté client : la page complète existe
 * dans le HTML servi. Elle est donc indexée, partageable, lisible sans
 * JavaScript, et ne dépend d'aucun chargement de données pour afficher sa
 * première image. Le générateur n'est qu'un outil d'édition : GitHub Pages
 * sert les fichiers produits tels quels, sans étape de build.
 *
 * Sécurité : toute valeur issue des données ou du manifeste — texte, attribut,
 * nom de fichier, dimension — est validée (reportages-lib.mjs) puis échappée
 * avant insertion. Les données JSON-LD sont sérialisées en JSON, « < » échappé.
 *
 * Référencement : si l'adresse publique est confirmée (content/site.json,
 * écrit par finalize-urls.mjs), chaque page porte son canonical, og:url et
 * une og:image absolue. Sans ce fichier, aucune adresse n'est supposée.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  CATEGORIES, DOSSIER_PAGES, avertissementsManifeste, chargerReportages, cheminManifeste, echapper,
  ordrePhotos, validerManifeste, verifierDerives,
} from "./reportages-lib.mjs";
import { lireBaseUrl, urlPage, urlRessource } from "./site-config.mjs";

const SITE = "Ange Kevin Photographie";

/**
 * Préfixe des identifiants de chapitre dans le HTML. Les identifiants du
 * gabarit (« introduction », « contenu », « menu », « titre-reportage »…) sont
 * ainsi hors d'atteinte : un chapitre intitulé « introduction » produit
 * « chapitre-introduction », jamais un identifiant en double.
 */
const PREFIXE_CHAPITRE = "chapitre-";
const idChapitre = (c) => `${PREFIXE_CHAPITRE}${c.id}`;
const VERIFIER = process.argv.includes("--check");

const MARQUEUR_DEBUT = "<!-- reportages:debut — généré par tools/build-reportages.mjs, ne pas modifier à la main -->";
const MARQUEUR_FIN = "<!-- reportages:fin -->";

// --- Utilitaires de texte ---------------------------------------------------

/**
 * Typographie française : espace insécable avant le deux-points et à
 * l'intérieur des guillemets, espace fine insécable avant « ; ! ? ». Évite
 * qu'un signe se retrouve seul en début de ligne.
 */
const typo = (texte) => String(texte)
  .replace(/ ([:»])/g, " $1")
  .replace(/« /g, "« ")
  .replace(/ ([;!?])/g, " $1");

const t = (texte) => echapper(typo(texte));
const deuxChiffres = (n) => String(n).padStart(2, "0");
const indenter = (bloc, n) => bloc.split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");

const NOMBRES = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix"];
const enLettres = (n) => NOMBRES[n] ?? String(n);

// --- Images -----------------------------------------------------------------

/**
 * Valeur de l'attribut « sizes », calculée à partir de la composition et du
 * rapport largeur / hauteur de l'image. Elle reproduit les contraintes de la
 * feuille de style (section 10 de site.css) : largeur de colonne, plafond de
 * largeur, et hauteur maximale exprimée en fraction de la fenêtre. Les unités
 * « vh » sont au moins égales aux « svh » de la feuille de style : la valeur
 * déclarée n'est jamais inférieure à la largeur rendue.
 */
function tailles(composition, ratio) {
  const hauteur = (fraction) => `${Math.ceil(fraction * ratio)}vh`;
  switch (composition) {
    case "couverture":
      return `(min-width: 64em) min(68vw, ${hauteur(80)}, 68rem), 100vw`;
    case "pleine":
      return `min(100vw, ${hauteur(92)}, 120rem)`;
    case "gauche":
    case "droite":
      return `(min-width: 48em) min(59vw, ${hauteur(88)}, 59rem), min(100vw, ${hauteur(88)})`;
    case "diptyque":
      return `(min-width: 48em) min(50vw, ${hauteur(88)}, 50rem), min(100vw, ${hauteur(88)})`;
    case "centre":
      return `min(100vw, ${hauteur(90)}, 36rem)`;
    case "carte":
      return "(min-width: 48em) min(60vw, 60rem), 100vw";
    default:
      return "100vw";
  }
}

/** Balise <img> d'une photographie, depuis son entrée de manifeste. */
function balisImage(photo, entree, { prefixe, slug, composition, prioritaire = false, attrs = "" }) {
  const dossier = `${prefixe}assets/img/reportages/${slug}/`;
  const variantes = entree.variants;
  const plusGrande = variantes[variantes.length - 1];
  // Source par défaut : la déclinaison intermédiaire, pour les navigateurs
  // qui ignoreraient srcset.
  const parDefaut = variantes[Math.min(1, variantes.length - 1)];
  const ratio = plusGrande.width / plusGrande.height;
  const chargement = prioritaire ? 'fetchpriority="high"' : 'loading="lazy"';
  // Chaque valeur d'attribut passe par echapper() ; les nombres sont rendus
  // par Number() : même validés en amont, rien n'entre brut dans le HTML.
  return [
    `<img src="${echapper(dossier + parDefaut.file)}"`,
    `     srcset="${echapper(variantes.map((v) => `${dossier}${v.file} ${Number(v.width)}w`).join(", "))}"`,
    `     sizes="${echapper(tailles(composition, ratio))}"`,
    `     width="${Number(plusGrande.width)}" height="${Number(plusGrande.height)}" ${chargement} decoding="async"${attrs}`,
    `     alt="${t(photo.alt)}">`,
  ].join("\n");
}

// --- Gabarit commun : entête, pied, menu ------------------------------------
// Copie fidèle du balisage des pages du site, avec un préfixe de chemin :
// les pages de reportage vivent un niveau plus bas, dans « reportages/ ».

const PAGES_NAV = [
  ["index.html", "Accueil"],
  ["portfolio.html", "Portfolio"],
  ["evenements.html", "Événements"],
  ["a-propos.html", "À propos"],
  ["contact.html", "Contact"],
];

function entete(p) {
  return `<header class="site-header" data-header>
  <div class="site-header__inner shell">
    <a class="brand" href="${p}index.html">
      <img class="brand__mark" src="${p}assets/img/brand/logo-320.webp"
           srcset="${p}assets/img/brand/logo-320.webp 320w, ${p}assets/img/brand/logo-640.webp 640w"
           sizes="(min-width: 64em) 11rem, 9rem" width="320" height="107" alt="Ange Kevin Photographie">
      <span class="visually-hidden">— retour à l'accueil</span>
    </a>

    <nav class="nav" aria-label="Navigation principale">
      <ul class="nav__list">
${PAGES_NAV.map(([href, nom]) => `        <li><a href="${p}${href}">${nom}</a></li>`).join("\n")}
      </ul>
    </nav>

    <button class="nav-toggle" type="button" aria-haspopup="dialog" data-menu-open>
      <span class="nav-toggle__glyph" aria-hidden="true"><i></i><i></i></span>
      <span>Menu</span>
    </button>
  </div>
</header>
<div class="header-sentinel" data-header-sentinel aria-hidden="true"></div>`;
}

function pied(p) {
  return `<footer class="site-footer">
  <div class="site-footer__inner shell">
    <nav class="site-footer__nav mono" aria-label="Navigation de pied de page">
      <ul>
${PAGES_NAV.map(([href, nom]) => `        <li><a href="${p}${href}">${nom}</a></li>`).join("\n")}
      </ul>
    </nav>
    <div class="site-footer__legal">
      <p>© 2026 Ange Kevin Photographie.</p>
      <p>
        Les photographies publiées sur ce site sont protégées par le droit
        d'auteur. Toute reproduction, diffusion ou réutilisation, même
        partielle, est interdite sans autorisation écrite.
      </p>
    </div>
  </div>
</footer>

<dialog class="menu" id="menu" aria-label="Navigation principale" data-menu>
  <div class="menu__inner shell">
    <div class="menu__top">
      <p class="eyebrow">Navigation</p>
      <button class="menu__close" type="button" data-menu-close>Fermer</button>
    </div>
    <ul class="menu__list">
${PAGES_NAV.map(([href, nom], i) =>
    `      <li><a href="${p}${href}"><span class="menu__num" aria-hidden="true">${deuxChiffres(i + 1)}</span>${nom}</a></li>`).join("\n")}
    </ul>
    <p class="menu__foot mono">Portraits · Cérémonies · Événements · Reportages</p>
  </div>
</dialog>`;
}

const SCRIPT_TETE = `<script>
  /* Marque la disponibilité de JavaScript, puis déclenche la séquence
     d'entrée dès la deuxième image. Indépendant des modules : si leur
     chargement échoue, le contenu s'affiche malgré tout. */
  var root = document.documentElement;
  root.className = "js";
  requestAnimationFrame(function () {
    requestAnimationFrame(function () { root.classList.add("is-ready"); });
  });
  /* Filet de sécurité : si le module de révélation n'a pas démarré au bout
     de trois secondes, les photographies sont affichées sans attendre. */
  setTimeout(function () {
    if (!root.dataset.revealReady) root.classList.add("no-reveal");
  }, 3000);
</script>`;

const SCRIPT_FIN = `<script>
  /* Révèle immédiatement ce qui est déjà dans la fenêtre (voir les autres
     pages : même script, même raison). */
  for (var noeuds = document.querySelectorAll("[data-reveal]"), i = 0; i < noeuds.length; i++) {
    if (noeuds[i].getBoundingClientRect().top < window.innerHeight) {
      noeuds[i].classList.add("is-revealed");
    }
  }
</script>`;

// --- Page de reportage ------------------------------------------------------

function figure(photo, entree, numero, total, options) {
  const ratio = (entree.width / entree.height).toFixed(4);
  const repere = `${deuxChiffres(numero)} / ${deuxChiffres(total)}`;
  // Sans légende, le repère n'est qu'un ornement : il est retiré de l'arbre
  // d'accessibilité plutôt que lu comme une légende.
  const legende = photo.caption
    ? `<figcaption class="plate__caption mono"><b>${t(photo.caption)}</b><span class="plate__ref">${repere}</span></figcaption>`
    : `<p class="plate__caption mono" aria-hidden="true"><span class="plate__ref">${repere}</span></p>`;
  const balise = options.balise ?? "figure";
  return `<${balise} class="plate story-photo${options.classe ? ` ${options.classe}` : ""}"${options.reveal === false ? "" : ' data-reveal="wipe"'} style="--ratio: ${ratio}">
  <span class="plate__frame">
${indenter(balisImage(photo, entree, options), 4)}
  </span>
  ${legende}
</${balise}>`;
}

function note(paragraphes) {
  return `<div class="story-note" data-reveal="rise">
${paragraphes.map((p) => `  <p>${t(p)}</p>`).join("\n")}
</div>`;
}

function pageReportage(r, manifeste, voisins, base) {
  const p = "../";
  const photos = new Map(r.photos.map((ph) => [ph.id, ph]));
  const ordre = ordrePhotos(r);
  const numero = (id) => ordre.indexOf(id) + 1;
  const total = ordre.length;
  const titreSeo = r.seoTitle ?? `${r.title} — ${SITE}`;
  const titreComplet = `${r.title} — ${r.subtitle}`;
  const couverture = photos.get(r.cover);
  const og = manifeste.photos[r.cover].og;
  const categorie = CATEGORIES[r.category];

  // Adresses absolues : uniquement si l'adresse publique est confirmée. Le
  // balisage est identique à celui que finalize-urls.mjs produit (mêmes
  // emplacements, même forme), de sorte que les deux outils se superposent.
  const cheminOg = `assets/img/reportages/${r.slug}/${og.file}`;
  const lignesHead = {
    canonical: base ? `\n<link rel="canonical" href="${echapper(urlPage(base, `${DOSSIER_PAGES}/${r.slug}.html`))}">` : "",
    ogUrl: base ? `\n<meta property="og:url" content="${echapper(urlPage(base, `${DOSSIER_PAGES}/${r.slug}.html`))}">` : "",
    ogImage: echapper(base ? urlRessource(base, cheminOg) : `${p}${cheminOg}`),
  };

  const opts = (composition, extra = {}) => ({ prefixe: p, slug: r.slug, composition, ...extra });

  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: titreComplet,
    description: r.description,
    inLanguage: "fr",
    genre: "Reportage photographique",
    about: r.occasion,
    contentLocation: { "@type": "Place", name: r.location },
    author: { "@type": "Person", name: "Ange Kevin" },
  }, null, 2).replace(/</g, "\\u003c");

  const sommaire = [
    `<li><a href="#introduction">Introduction</a></li>`,
    ...r.chapters.map((c, i) =>
      `<li><a href="#${echapper(idChapitre(c))}"><span class="rail__num" aria-hidden="true">${deuxChiffres(i + 1)}</span>${t(c.title)}</a></li>`),
  ];

  const chapitres = r.chapters.map((c, i) => {
    const plans = c.frames.map((plan) => {
      const fig = (id, composition, extra) =>
        figure(photos.get(id), manifeste.photos[id], numero(id), total, opts(composition, extra));
      const contenu = [];
      if (plan.layout === "diptyque") {
        contenu.push(fig(plan.photos[0], "diptyque"), fig(plan.photos[1], "diptyque"));
      } else {
        contenu.push(fig(plan.photos[0], plan.layout));
      }
      if (plan.note) contenu.push(note(plan.note));
      const shell = plan.layout === "pleine" ? "" : " shell";
      return `<div class="story-frame story-frame--${plan.layout}${shell}">
${indenter(contenu.join("\n"), 2)}
</div>`;
    });

    return `<section class="story-chapter" id="${echapper(idChapitre(c))}" aria-labelledby="t-${echapper(idChapitre(c))}">
  <header class="story-chapter__head shell">
    <div class="story-chapter__rule rule" data-reveal="draw" aria-hidden="true"></div>
    <p class="folio" aria-hidden="true">${deuxChiffres(i + 1)}</p>
    <p class="eyebrow">Chapitre ${i + 1} sur ${r.chapters.length}</p>
    <h2 class="story-chapter__title" id="t-${echapper(idChapitre(c))}" data-reveal="rise">${t(c.title)}</h2>
    <div class="story-chapter__text" data-reveal="rise">
${c.text.map((para) => `      <p>${t(para)}</p>`).join("\n")}
    </div>
  </header>
  <div class="story-frames">
${indenter(plans.join("\n"), 4)}
  </div>
</section>`;
  });

  const liensFin = [];
  if (voisins.precedent) {
    liensFin.push(`<a class="link" href="${echapper(voisins.precedent.slug)}.html" rel="prev">Reportage précédent : ${t(voisins.precedent.title)}</a>`);
  }
  if (voisins.suivant) {
    liensFin.push(`<a class="link" href="${echapper(voisins.suivant.slug)}.html" rel="next">Reportage suivant : ${t(voisins.suivant.title)}</a>`);
  }
  liensFin.push(`<a class="link" href="${p}portfolio.html#reportages">Tous les reportages</a>`);
  liensFin.push(`<a class="link" href="${p}contact.html">Prendre contact</a>`);

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">${lignesHead.canonical}
<!-- Page générée par tools/build-reportages.mjs depuis content/reportages/${r.slug}.json.
     Modifier les données, puis relancer le générateur : toute retouche
     manuelle de ce fichier serait écrasée. -->
<title>${t(titreSeo)}</title>
<meta name="description" content="${t(r.description)}">
<meta name="theme-color" content="#0a0a0b">
<meta property="og:type" content="article">${lignesHead.ogUrl}
<meta property="og:site_name" content="${SITE}">
<meta property="og:locale" content="fr_FR">
<meta property="og:title" content="${t(titreComplet)}">
<meta property="og:description" content="${t(r.description)}">
<meta property="og:image" content="${lignesHead.ogImage}">
<meta property="og:image:width" content="${Number(og.width)}">
<meta property="og:image:height" content="${Number(og.height)}">
<meta property="og:image:alt" content="${t(couverture.alt)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${p}assets/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${p}assets/css/tokens.css">
<link rel="stylesheet" href="${p}assets/css/base.css">
<link rel="stylesheet" href="${p}assets/css/site.css">
<link rel="modulepreload" href="${p}assets/js/main.js">
<link rel="modulepreload" href="${p}assets/js/nav.js">
<link rel="modulepreload" href="${p}assets/js/reveal.js">
<link rel="modulepreload" href="${p}assets/js/albums.js">
<script type="application/ld+json">
${jsonLd}
</script>
${SCRIPT_TETE}
</head>
<body>

<div class="progress" aria-hidden="true"></div>
<a class="skip" href="#contenu">Aller au contenu</a>

${entete(p)}

<main id="contenu">
<article class="story" aria-labelledby="titre-reportage">

  <header class="story-hero">
    <div class="story-hero__inner shell">
      <div class="story-hero__text">
        <p class="eyebrow" data-intro="1">
          <a class="story-crumb" href="${p}portfolio.html#reportages">Reportages</a>
          <span aria-hidden="true">/</span> ${t(categorie)}
        </p>
        <h1 class="story-hero__title" id="titre-reportage" data-intro="2">
          ${t(r.title)}<span class="visually-hidden"> — </span>
          <span class="story-hero__subtitle">${t(r.subtitle)}</span>
        </h1>
        <dl class="story-meta mono" data-intro="3">
          <div><dt>Occasion</dt><dd>${t(r.occasion)}</dd></div>
          <div><dt>Lieu</dt><dd>${t(r.location)}</dd></div>
          <div><dt>Images</dt><dd>${total} photographies</dd></div>
          <div><dt>Récit</dt><dd>${enLettres(r.chapters.length)} chapitres</dd></div>
        </dl>
      </div>
${indenter(figure(couverture, manifeste.photos[r.cover], 1, total,
    opts("couverture", { prioritaire: true, reveal: false, classe: "story-hero__plate", attrs: " data-develop" })), 6)}
    </div>
  </header>

  <nav class="rail story-rail" aria-label="Chapitres du reportage" data-rail>
    <div class="shell">
      <ol>
${sommaire.map((l) => `        ${l}`).join("\n")}
      </ol>
    </div>
  </nav>

  <section class="story-intro" id="introduction" aria-labelledby="t-introduction">
    <div class="story-intro__inner shell">
      <div class="story-intro__head">
        <p class="eyebrow">Introduction</p>
        <h2 class="story-intro__title" id="t-introduction" data-reveal="rise">${t(r.introTitle)}</h2>
      </div>
      <div class="story-intro__text" data-reveal="rise">
${r.intro.map((para) => `        <p>${t(para)}</p>`).join("\n")}
      </div>
    </div>
  </section>

${indenter(chapitres.join("\n\n"), 2)}

  <footer class="story-end shell">
    <div class="story-end__rule rule" data-reveal="draw" aria-hidden="true"></div>
    <p class="eyebrow">Fin du reportage</p>
${r.closing ? indenter(`<div class="story-end__text" data-reveal="rise">
${r.closing.map((para) => `  <p>${t(para)}</p>`).join("\n")}
</div>`, 4) : ""}
    <nav class="story-end__nav" aria-label="Après le reportage">
      <ul>
${liensFin.map((l) => `        <li>${l}</li>`).join("\n")}
      </ul>
    </nav>
  </footer>

</article>
</main>

${pied(p)}

${SCRIPT_FIN}
<script type="module" src="${p}assets/js/main.js"></script>
</body>
</html>
`;
}

// --- Cartes du portfolio ----------------------------------------------------

function carte(r, manifeste) {
  const couverture = r.photos.find((ph) => ph.id === r.cover);
  const entree = manifeste.photos[r.cover];
  const lien = `${DOSSIER_PAGES}/${r.slug}.html`;
  return `<article class="reportage-card" data-reveal="rise">
  <div class="plate__frame reportage-card__media">
${indenter(balisImage(couverture, entree, { prefixe: "", slug: r.slug, composition: "carte" }), 4)}
  </div>
  <div class="reportage-card__body">
    <p class="eyebrow">${t(r.occasion)} · ${t(r.location)}</p>
    <h3 class="reportage-card__title"><a href="${echapper(lien)}">${t(r.title)}</a></h3>
    <p class="reportage-card__subtitle">${t(r.subtitle)}</p>
    <p class="reportage-card__summary">${t(r.description)}</p>
    <p class="reportage-card__meta mono" aria-hidden="true">${ordrePhotos(r).length} photographies · Lire le reportage</p>
  </div>
</article>`;
}

function injecterCartes(html, cartes) {
  const debut = html.indexOf(MARQUEUR_DEBUT);
  const fin = html.indexOf(MARQUEUR_FIN);
  if (debut === -1 || fin === -1 || fin < debut) {
    throw new Error("portfolio.html : marqueurs « reportages:debut » et « reportages:fin » introuvables.");
  }
  // L'indentation du marqueur d'ouverture est reprise pour le contenu.
  const ligne = html.lastIndexOf("\n", debut) + 1;
  const retrait = html.slice(ligne, debut);
  const contenu = cartes.length
    ? `<div class="reportage-list">\n${indenter(cartes.join("\n"), 2)}\n</div>`
    : '<p><span class="pending">Aucun reportage publié</span></p>';
  return `${html.slice(0, debut)}${MARQUEUR_DEBUT}\n${indenter(contenu, retrait.length)}\n${retrait}${html.slice(fin)}`;
}

// --- Exécution --------------------------------------------------------------

const reportages = await chargerReportages();
const erreurs = reportages.flatMap((r) => r.erreurs);
const valides = reportages.filter((r) => r.erreurs.length === 0).map((r) => r.donnees);

const manifestes = new Map();
for (const r of valides) {
  const chemin = cheminManifeste(r.slug);
  let manifeste = null;
  try { manifeste = JSON.parse(await readFile(chemin, "utf8")); } catch { /* signalé ci-dessous */ }
  const e = validerManifeste(r, manifeste, chemin);
  // Les dérivés eux-mêmes : présents, conformes à leur empreinte, sans orphelin.
  // Une page ne doit jamais référencer une image périmée ou altérée.
  if (e.length === 0) e.push(...await verifierDerives(r.slug, manifeste));
  erreurs.push(...e);
  if (e.length === 0) manifestes.set(r.slug, manifeste);
  const nonVerifiables = avertissementsManifeste(manifeste);
  if (e.length === 0 && nonVerifiables.length) {
    console.warn(`Avertissement : ${chemin} — l'original de ${nonVerifiables.length} photographie(s) n'a pas d'empreinte enregistrée ; `
      + "leur fraîcheur n'est pas vérifiable. Relancer tools/optimize-photos.mjs avec les originaux.");
  }
}

// Adresse publique, si elle est confirmée (content/site.json).
let baseUrl = null;
try { baseUrl = await lireBaseUrl(); } catch (erreur) { erreurs.push(erreur.message); }

if (erreurs.length) {
  console.error(`Données invalides :\n  ${erreurs.join("\n  ")}`);
  process.exit(1);
}

const sorties = new Map();
valides.forEach((r, i) => {
  const voisins = { precedent: valides[i - 1], suivant: valides[i + 1] };
  sorties.set(join(DOSSIER_PAGES, `${r.slug}.html`), pageReportage(r, manifestes.get(r.slug), voisins, baseUrl));
});
// Fins de ligne : Git peut extraire les fichiers en CRLF sous Windows
// (core.autocrlf). Le contenu est comparé et produit en LF, puis réécrit dans
// la convention déjà présente sur le disque, pour ne jamais créer de fichier
// aux fins de ligne mélangées ni de différence artificielle.
const enLF = (texte) => texte.replace(/\r\n/g, "\n");

const portfolio = enLF(await readFile("portfolio.html", "utf8"));
sorties.set("portfolio.html", injecterCartes(portfolio, valides.map((r) => carte(r, manifestes.get(r.slug)))));

if (VERIFIER) {
  const perimes = [];
  for (const [chemin, contenu] of sorties) {
    const actuel = await readFile(chemin, "utf8").catch(() => null);
    if (actuel === null || enLF(actuel) !== contenu) perimes.push(chemin);
  }
  if (perimes.length) {
    console.error(`Fichier(s) à régénérer (node tools/build-reportages.mjs) :\n  ${perimes.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`${sorties.size} fichier(s) à jour.`);
} else {
  await mkdir(DOSSIER_PAGES, { recursive: true });
  for (const [chemin, contenu] of sorties) {
    const actuel = await readFile(chemin, "utf8").catch(() => null);
    if (actuel !== null && enLF(actuel) === contenu) { console.log(`inchangé : ${chemin}`); continue; }
    const crlf = actuel?.includes("\r\n") ?? false;
    await writeFile(chemin, crlf ? contenu.replace(/\n/g, "\r\n") : contenu, "utf8");
    console.log(`écrit : ${chemin}`);
  }
}
