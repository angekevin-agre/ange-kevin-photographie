/**
 * Tests de sécurité et de non-régression des outils de reportage.
 *
 *   node tools/test-reportages.mjs
 *
 * Sans navigateur. Chaque test travaille dans un répertoire temporaire : les
 * fichiers du dépôt ne sont jamais modifiés (seul leur contenu est lu ou copié).
 * Les outils sont exécutés pour de bon, comme un auteur les lancerait.
 *
 * Couvre :
 *   1. validation stricte des données et du manifeste (valeurs nulles, types,
 *      dimensions, noms de fichier) ;
 *   2. injections HTML : aucune donnée ne peut créer de balise ou d'attribut ;
 *   3. slug et chemins : aucune traversée de répertoires ;
 *   4. fraîcheur des images : original ou paramètres modifiés → régénération ;
 *   5. référencement : finalisation des URL, retouche éditoriale, régénération ;
 *   6. identifiants HTML : aucune collision avec le gabarit ;
 *   7. intégrité visuelle : aucune règle CSS ne rogne, n'agrandit ni ne
 *      retouche une photographie.
 *
 * Les tests qui produisent de vraies images exigent ffmpeg (avec libwebp) ;
 * s'il manque, ils sont signalés « IGNORÉ » — jamais comptés comme réussis.
 *
 * Code de sortie : 0 si tout passe, 1 sinon. Aucune dépendance.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PARAMETRES_CONVERSION, validerManifeste, validerReportage, verifierDerives,
} from "./reportages-lib.mjs";

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTIL = (nom) => join(DEPOT, "tools", nom);
const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

// --- Cadre de test ------------------------------------------------------------

const resultats = [];
async function essai(nom, corps) {
  try {
    const detail = await corps();
    // Un test renvoie la liste de ses défauts (vide = réussite), ou "IGNORE:…".
    if (typeof detail === "string" && detail.startsWith("IGNORE:")) {
      resultats.push({ nom, etat: "ignore", detail: detail.slice(7) });
    } else if (Array.isArray(detail) && detail.length > 0) {
      resultats.push({ nom, etat: "echec", detail: detail.join(" ; ") });
    } else {
      resultats.push({ nom, etat: "ok", detail: "" });
    }
  } catch (erreur) {
    resultats.push({ nom, etat: "echec", detail: `exception : ${erreur.stack ?? erreur}` });
  }
}

const lancer = (script, args, cwd) => new Promise((resoudre) => {
  const proc = spawn(process.execPath, [script, ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  let sortie = "";
  proc.stdout.on("data", (d) => (sortie += d));
  proc.stderr.on("data", (d) => (sortie += d));
  proc.once("exit", (code) => resoudre({ code, sortie }));
});

const sha = (octets) => createHash("sha256").update(octets).digest("hex");
const lireJson = async (chemin) => JSON.parse(await readFile(chemin, "utf8"));
const ecrireJson = (chemin, donnees) => writeFile(chemin, `${JSON.stringify(donnees, null, 2)}\n`, "utf8");

const dossiersTemporaires = [];
const nouveauTemp = async (prefixe) => {
  const dossier = await mkdtemp(join(tmpdir(), `akp-${prefixe}-`));
  dossiersTemporaires.push(dossier);
  return dossier;
};

/** Empreinte de tout un arbre : chemins relatifs + contenus. */
async function empreinteArbre(racine) {
  const hash = createHash("sha256");
  const parcourir = async (dossier) => {
    for (const entree of (await readdir(dossier, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const chemin = join(dossier, entree.name);
      hash.update(`${chemin.slice(racine.length)}\n`);
      if (entree.isDirectory()) await parcourir(chemin);
      else hash.update(await readFile(chemin));
    }
  };
  await parcourir(racine);
  return hash.digest("hex");
}

const florent = await lireJson(join(DEPOT, "content", "reportages", "florent.json"));

/** Reportage minimal valide, pour les tests d'outils. */
const reportageMinimal = (slug, ids = ["aa", "bb"]) => ({
  slug,
  title: "Essai",
  subtitle: "Un reportage d'essai",
  category: "portraits",
  occasion: "Portrait",
  location: "Paris",
  description: "Reportage d'essai pour vérifier la génération des pages, des images et du référencement du site.",
  cover: ids[0],
  introTitle: "Introduction",
  intro: ["Un texte d'introduction."],
  chapters: [{
    id: "chapitre-un", title: "Premier chapitre", text: ["Un texte."],
    frames: ids.slice(1).map((id) => ({ layout: "pleine", photos: [id] })),
  }],
  photos: ids.map((id) => ({ id, file: `${id.toUpperCase()}.jpg`, alt: `Photographie ${id}` })),
});

/**
 * Projet temporaire minimal : portfolio.html (avec ses marqueurs), données du
 * reportage, et images « synthétiques » (octets quelconques) avec leur
 * manifeste. Suffit à exercer le générateur sans ffmpeg.
 */
async function projetSynthetique(reportage) {
  const racine = await nouveauTemp("synth");
  await cp(join(DEPOT, "portfolio.html"), join(racine, "portfolio.html"));
  await mkdir(join(racine, "content", "reportages"), { recursive: true });
  await ecrireJson(join(racine, "content", "reportages", `${reportage.slug}.json`), reportage);
  const dossier = join(racine, "assets", "img", "reportages", reportage.slug);
  await mkdir(dossier, { recursive: true });
  const manifeste = { version: 2, slug: reportage.slug, params: PARAMETRES_CONVERSION, photos: {} };
  for (const photo of reportage.photos) {
    const derive = async (file, width, height) => {
      const octets = Buffer.from(`${reportage.slug}/${file}`);
      await writeFile(join(dossier, file), octets);
      return { file, width, height, sha256: sha(octets) };
    };
    const entree = {
      source: photo.file, sourceSha256: null, width: 6000, height: 4000,
      variants: [await derive(`${photo.id}-640.webp`, 640, 427), await derive(`${photo.id}-1024.webp`, 1024, 683)],
    };
    if (photo.id === reportage.cover) entree.og = await derive(`${photo.id}-og.jpg`, 1200, 800);
    manifeste.photos[photo.id] = entree;
  }
  await ecrireJson(join(dossier, "manifest.json"), manifeste);
  return racine;
}

const construire = (racine, args = []) => lancer(OUTIL("build-reportages.mjs"), args, racine);

// ============================================================================
// 1. Validation stricte des données
// ============================================================================

const muter = (modifier) => {
  const copie = structuredClone(florent);
  modifier(copie);
  return validerReportage(copie, "essai");
};

await essai("Données — les structures invalides sont refusées sans exception (photos null, tableaux, types)", async () => {
  const CAS = [
    ["photos: null", (r) => { r.photos = null; }],
    ["photos: chaîne", (r) => { r.photos = "x"; }],
    ["photos: objet", (r) => { r.photos = {}; }],
    ["photos: liste vide", (r) => { r.photos = []; }],
    ["photos[0]: null", (r) => { r.photos[0] = null; }],
    ["photos[0]: nombre", (r) => { r.photos[0] = 42; }],
    ["photos[0]: tableau", (r) => { r.photos[0] = []; }],
    ["photos[0].id: nombre", (r) => { r.photos[0].id = 7; }],
    ["chapters: null", (r) => { r.chapters = null; }],
    ["chapters[0]: null", (r) => { r.chapters[0] = null; }],
    ["chapters[0]: tableau", (r) => { r.chapters[0] = []; }],
    ["frames: null", (r) => { r.chapters[0].frames = null; }],
    ["frames[0]: null", (r) => { r.chapters[0].frames[0] = null; }],
    ["frames[0].photos: null", (r) => { r.chapters[0].frames[0].photos = null; }],
    ["frames[0].photos: [null]", (r) => { r.chapters[0].frames[0].photos = [null]; }],
    ["frames[0].photos: [objet]", (r) => { r.chapters[0].frames[0].photos = [{}]; }],
    ["intro: null", (r) => { r.intro = null; }],
    ["intro: [null]", (r) => { r.intro = [null]; }],
    ["cover: null", (r) => { r.cover = null; }],
    ["order: texte", (r) => { r.order = "1"; }],
  ];
  const defauts = [];
  for (const [nom, modifier] of CAS) {
    try {
      if (muter(modifier).length === 0) defauts.push(`${nom} : accepté`);
    } catch (erreur) {
      defauts.push(`${nom} : exception ${erreur.message}`);
    }
  }
  for (const valeur of [null, undefined, 42, "texte", [], true]) {
    try {
      if (validerReportage(valeur, "essai").length === 0) defauts.push(`racine ${JSON.stringify(valeur)} : acceptée`);
    } catch (erreur) {
      defauts.push(`racine ${JSON.stringify(valeur)} : exception ${erreur.message}`);
    }
  }
  return defauts;
});

await essai("Données — noms de fichier, identifiants et slugs hostiles refusés", async () => {
  const FICHIERS = [
    "../DSC_0148.jpg", "..\\DSC_0148.jpg", "a/b.jpg", "a\\b.jpg", "C:\\x.jpg", "/etc/passwd.jpg", ".cache.jpg",
    "a..b.jpg", 'x".jpg', "x\".jpg", "a b.jpg", "a<b>.jpg", "a'b.jpg", "x\u0000.jpg", "FAMILLE/x.jpg", "x.jpg.exe", "x.svg", "",
  ];
  const IDS = ['x" onerror="y', "a b", "A", "a_b", "../x", "", "a/b", "<b>"];
  const SLUGS = ["../x", "a/b", "a\\b", "A", "", "a b", "-a", "a-", "a--b", "x.json", ".."];
  const defauts = [];
  for (const f of FICHIERS) if (muter((r) => { r.photos[0].file = f; }).length === 0) defauts.push(`file ${JSON.stringify(f)} accepté`);
  for (const id of IDS) if (muter((r) => { r.photos[0].id = id; }).length === 0) defauts.push(`id ${JSON.stringify(id)} accepté`);
  for (const s of SLUGS) if (muter((r) => { r.slug = s; }).length === 0) defauts.push(`slug ${JSON.stringify(s)} accepté`);
  for (const c of ["a b", "A", "../x", "", "x\"y"]) {
    if (muter((r) => { r.chapters[0].id = c; }).length === 0) defauts.push(`chapitre ${JSON.stringify(c)} accepté`);
  }
  return defauts;
});

// ============================================================================
// 2. Validation stricte du manifeste
// ============================================================================

await essai("Manifeste — valeurs nulles, dimensions non positives et noms hostiles refusés", async () => {
  const reportage = reportageMinimal("essai");
  const valide = async () => {
    const racine = await projetSynthetique(reportage);
    return lireJson(join(racine, "assets", "img", "reportages", "essai", "manifest.json"));
  };
  const reference = await valide();
  const defauts = [];
  if (validerManifeste(reportage, reference, "m").length !== 0) defauts.push(`référence invalide : ${validerManifeste(reportage, reference, "m")}`);

  const CAS = [
    ["manifeste null", () => null],
    ["manifeste tableau", () => []],
    ["photos: null", (m) => { m.photos = null; return m; }],
    ["photos: tableau", (m) => { m.photos = []; return m; }],
    ["entrée null", (m) => { m.photos.aa = null; return m; }],
    ["entrée absente", (m) => { delete m.photos.bb; return m; }],
    ["variants: null", (m) => { m.photos.aa.variants = null; return m; }],
    ["variants: vide", (m) => { m.photos.aa.variants = []; return m; }],
    ["variante null", (m) => { m.photos.aa.variants[0] = null; return m; }],
    ["variante nombre", (m) => { m.photos.aa.variants[0] = 3; return m; }],
    ["largeur 0", (m) => { m.photos.aa.variants[0].width = 0; return m; }],
    ["largeur négative", (m) => { m.photos.aa.variants[0].width = -640; return m; }],
    ["hauteur 0", (m) => { m.photos.aa.variants[0].height = 0; return m; }],
    ["hauteur NaN", (m) => { m.photos.aa.variants[0].height = Number.NaN; return m; }],
    ["largeur texte", (m) => { m.photos.aa.variants[0].width = "640"; return m; }],
    ["largeur décimale", (m) => { m.photos.aa.variants[0].width = 640.5; return m; }],
    ["dimensions de l'original nulles", (m) => { m.photos.aa.width = 0; return m; }],
    ["agrandissement", (m) => { m.photos.aa.variants[1].width = 9000; return m; }],
    ["proportions modifiées", (m) => { m.photos.aa.variants[0].height = 100; return m; }],
    ["fichier hostile (guillemet)", (m) => { m.photos.aa.variants[0].file = 'x" onerror="alert(1).webp'; return m; }],
    ["fichier remontant", (m) => { m.photos.aa.variants[0].file = "../../x.webp"; return m; }],
    ["fichier d'une autre photo", (m) => { m.photos.aa.variants[0].file = "bb-640.webp"; return m; }],
    ["fichier sans lien avec la largeur", (m) => { m.photos.aa.variants[0].file = "aa-641.webp"; return m; }],
    ["empreinte absente", (m) => { delete m.photos.aa.variants[0].sha256; return m; }],
    ["empreinte invalide", (m) => { m.photos.aa.variants[0].sha256 = "zz"; return m; }],
    ["empreinte source invalide", (m) => { m.photos.aa.sourceSha256 = "zz"; return m; }],
    ["og null", (m) => { m.photos.aa.og = null; return m; }],
    ["og absent", (m) => { delete m.photos.aa.og; return m; }],
    ["og dimensions nulles", (m) => { m.photos.aa.og.width = 0; return m; }],
    ["og fichier hostile", (m) => { m.photos.aa.og.file = '"><script>.jpg'; return m; }],
    ["paramètres différents", (m) => { m.params.webp.qualite = 50; return m; }],
    ["paramètres absents", (m) => { delete m.params; return m; }],
    ["version 1", (m) => { m.version = 1; return m; }],
    ["autre slug", (m) => { m.slug = "autre"; return m; }],
    ["photo en trop", (m) => { m.photos.zz = structuredClone(m.photos.bb); return m; }],
  ];
  for (const [nom, modifier] of CAS) {
    try {
      const copie = structuredClone(reference);
      const manifeste = modifier(copie);
      if (validerManifeste(reportage, manifeste, "m").length === 0) defauts.push(`${nom} : accepté`);
    } catch (erreur) {
      defauts.push(`${nom} : exception ${erreur.message}`);
    }
  }
  return defauts;
});

await essai("Manifeste — un dérivé périmé, altéré, absent ou orphelin est détecté (verifierDerives)", async () => {
  const reportage = reportageMinimal("essai");
  const racine = await projetSynthetique(reportage);
  const dossierImages = join(racine, "assets", "img", "reportages");
  const manifeste = await lireJson(join(dossierImages, "essai", "manifest.json"));
  const defauts = [];
  if ((await verifierDerives("essai", manifeste, dossierImages)).length !== 0) defauts.push("référence refusée");
  await writeFile(join(dossierImages, "essai", "aa-640.webp"), "altéré");
  await rm(join(dossierImages, "essai", "bb-1024.webp"));
  await writeFile(join(dossierImages, "essai", "orphelin.webp"), "x");
  const messages = (await verifierDerives("essai", manifeste, dossierImages)).join(" | ");
  for (const [attendu, motif] of [[/aa-640\.webp : contenu différent/, "altéré"], [/bb-1024\.webp : fichier absent/, "absent"], [/orphelin\.webp : fichier orphelin/, "orphelin"]]) {
    if (!attendu.test(messages)) defauts.push(`${motif} non détecté`);
  }
  return defauts;
});

// ============================================================================
// 3. Injections HTML
// ============================================================================

/**
 * Découpe le HTML en balises avec leurs attributs. Après un échappement
 * correct, aucune valeur d'attribut ne contient « " » ni « < » : ce découpage
 * simple est alors exact, et toute balise ou attribut injecté devient visible.
 */
function balises(html) {
  const sansBlocs = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, (bloc) => bloc.match(/^<script\b[^>]*>/)[0] + "</script>")
    .replace(/<!--[\s\S]*?-->/g, "");
  const trouvees = [];
  for (const m of sansBlocs.matchAll(/<\/?([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'<>=/]+(?:="[^"<]*")?)*)\s*\/?>/g)) {
    const attributs = [...m[2].matchAll(/\s+([^\s"'<>=/]+)(?:="([^"<]*)")?/g)].map((a) => ({ nom: a[1], valeur: a[2] ?? "" }));
    trouvees.push({ nom: m[1].toLowerCase(), attributs, brut: m[0] });
  }
  // Tout « < » restant hors balise reconnue est une injection.
  const residu = sansBlocs.replace(/<\/?([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'<>=/]+(?:="[^"<]*")?)*)\s*\/?>/g, "").replace(/<!doctype html>/i, "");
  return { trouvees, residu };
}

const CHARGES = [
  '"><img src=x onerror=alert(1)>',
  "</script><script>alert(1)</script>",
  "' onmouseover='alert(1)",
  '" autofocus onfocus="alert(1)',
  "<svg/onload=alert(1)>",
  "<!-- -->&amp;&lt;b&gt;",
  "javascript:alert(1)",
  "\u2028</title><script>alert(1)</script>",
];
const BALISES_DU_GABARIT = new Set([
  "html", "head", "meta", "title", "link", "script", "body", "div", "a", "main", "article", "header", "nav", "ul", "li", "ol", "span", "p",
  "i", "button", "footer", "dialog", "img", "h1", "h2", "h3", "dl", "dt", "dd", "section", "figure", "figcaption", "b",
]);

await essai("Injection — aucune donnée hostile ne crée de balise ni d'attribut (toutes les entrées textuelles)", async () => {
  const defauts = [];
  for (const [i, charge] of CHARGES.entries()) {
    const r = reportageMinimal(`injection-${i}`, ["aa", "bb", "cc"]);
    const rempli = (court) => `${court} ${charge}`;
    r.title = rempli("Titre"); r.subtitle = rempli("Sous-titre"); r.occasion = rempli("Occasion"); r.location = rempli("Lieu");
    r.seoTitle = `S ${charge}`.slice(0, 65);
    r.description = `Reportage d'essai ${charge} `.padEnd(80, "x").slice(0, 160);
    r.introTitle = rempli("Intro"); r.intro = [rempli("Paragraphe"), charge];
    r.closing = [rempli("Fin")];
    r.chapters[0].title = rempli("Chapitre"); r.chapters[0].text = [rempli("Texte")];
    r.chapters[0].frames[0].note = [rempli("Note")];
    r.photos[0].alt = rempli("Alt"); r.photos[1].alt = charge; r.photos[1].caption = rempli("Légende");
    if (validerReportage(r, "x").length) { defauts.push(`charge ${i} : données refusées à tort (${validerReportage(r, "x")[0]})`); continue; }

    const racine = await projetSynthetique(r);
    const sortie = await construire(racine);
    if (sortie.code !== 0) { defauts.push(`charge ${i} : génération en échec (${sortie.sortie.trim().slice(0, 200)})`); continue; }
    for (const page of [join(racine, "reportages", `${r.slug}.html`), join(racine, "portfolio.html")]) {
      const html = await readFile(page, "utf8");
      const { trouvees, residu } = balises(html);
      const nom = page.endsWith("portfolio.html") ? "portfolio" : "reportage";
      if (residu.includes("<")) defauts.push(`charge ${i}, ${nom} : « < » injecté hors balise`);
      for (const b of trouvees) {
        if (!BALISES_DU_GABARIT.has(b.nom)) defauts.push(`charge ${i}, ${nom} : balise injectée <${b.nom}>`);
        for (const a of b.attributs) if (/^on/i.test(a.nom) || a.nom === "autofocus") defauts.push(`charge ${i}, ${nom} : attribut injecté « ${a.nom} » sur <${b.nom}>`);
      }
      if (nom === "reportage") {
        // 1 logo + 3 photographies ; 4 scripts : tête, JSON-LD, fin, module.
        const imgs = trouvees.filter((b) => b.nom === "img").length;
        if (imgs !== 4) defauts.push(`charge ${i} : ${imgs} <img> au lieu de 4`);
        const scripts = trouvees.filter((b) => b.nom === "script" && b.brut.startsWith("<script")).length;
        if (scripts !== 4) defauts.push(`charge ${i} : ${scripts} <script> au lieu de 4`);
        // Le JSON-LD reste du JSON valide, et rend la charge telle quelle.
        const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
        try {
          const donnees = JSON.parse(ld);
          if (!donnees.headline.includes(charge)) defauts.push(`charge ${i} : JSON-LD altéré`);
          if (ld.includes("<")) defauts.push(`charge ${i} : « < » brut dans le JSON-LD`);
        } catch { defauts.push(`charge ${i} : JSON-LD illisible`); }
      }
    }
  }
  return defauts;
});

await essai("Injection — un manifeste hostile est refusé avant toute écriture", async () => {
  const defauts = [];
  const r = reportageMinimal("manifeste-hostile");
  const racine = await projetSynthetique(r);
  const chemin = join(racine, "assets", "img", "reportages", r.slug, "manifest.json");
  const manifeste = await lireJson(chemin);
  manifeste.photos.aa.variants[0].file = 'x" onerror="alert(1)';
  manifeste.photos.aa.variants[1].width = -1;
  manifeste.photos.bb = null;
  await ecrireJson(chemin, manifeste);
  const sortie = await construire(racine);
  if (sortie.code !== 1) defauts.push(`code ${sortie.code} au lieu de 1`);
  if (await stat(join(racine, "reportages", `${r.slug}.html`)).then(() => true, () => false)) defauts.push("une page a été écrite malgré le manifeste invalide");
  if (/Error|TypeError|at file:/.test(sortie.sortie)) defauts.push(`plantage non maîtrisé : ${sortie.sortie.slice(0, 160)}`);
  return defauts;
});

// ============================================================================
// 6 (placé ici : même mécanique). Collisions d'identifiants HTML
// ============================================================================

const identifiants = (html) => [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);

await essai("Identifiants — un chapitre nommé « introduction » (ou « contenu », « menu »…) ne crée aucun doublon", async () => {
  const defauts = [];
  const r = reportageMinimal("collision", ["aa", "bb", "cc", "dd", "ee"]);
  const NOMS = ["introduction", "contenu", "menu", "titre-reportage", "t-introduction"];
  r.chapters = NOMS.map((id, i) => ({
    id, title: `Chapitre ${id}`, text: ["Texte."], frames: [{ layout: "pleine", photos: [["bb", "cc", "dd", "ee"][i] ?? "bb"] }],
  })).slice(0, 4);
  r.chapters[0].id = "introduction"; r.chapters[1].id = "contenu"; r.chapters[2].id = "menu"; r.chapters[3].id = "titre-reportage";
  r.chapters[4] = undefined;
  r.chapters = r.chapters.filter(Boolean);
  if (validerReportage(r, "x").length) return [`données refusées : ${validerReportage(r, "x").join(" ; ")}`];
  const racine = await projetSynthetique(r);
  const sortie = await construire(racine);
  if (sortie.code !== 0) return [`génération en échec : ${sortie.sortie.slice(0, 200)}`];
  const html = await readFile(join(racine, "reportages", `${r.slug}.html`), "utf8");
  const ids = identifiants(html);
  const doublons = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (doublons.length) defauts.push(`identifiants en double : ${[...new Set(doublons)].join(", ")}`);
  if (ids.filter((id) => id === "introduction").length !== 1) defauts.push("« introduction » doit désigner la seule section d'introduction");
  for (const [, cible] of html.matchAll(/href="#([^"]+)"/g)) {
    if (!ids.includes(cible)) defauts.push(`ancre #${cible} sans cible`);
  }
  const sommaire = html.match(/<nav class="rail[\s\S]*?<\/nav>/)?.[0] ?? "";
  if (!sommaire.includes('href="#chapitre-introduction"')) defauts.push("le sommaire ne pointe pas sur le chapitre « introduction »");
  if (!sommaire.includes('href="#introduction"')) defauts.push("le sommaire ne pointe plus sur l'introduction du récit");
  // Chaque section de chapitre est étiquetée par son propre titre.
  for (const [, section, labelled] of html.matchAll(/<section class="story-chapter" id="([^"]+)" aria-labelledby="([^"]+)"/g)) {
    if (!ids.includes(labelled)) defauts.push(`${section} : aria-labelledby=${labelled} sans cible`);
  }
  return defauts;
});

await essai("Identifiants — la page de Florent n'a aucun identifiant en double ni ancre orpheline", async () => {
  const html = await readFile(join(DEPOT, "reportages", "florent.html"), "utf8");
  const ids = identifiants(html);
  const defauts = ids.filter((id, i) => ids.indexOf(id) !== i).map((id) => `doublon ${id}`);
  for (const [, cible] of html.matchAll(/href="#([^"]+)"/g)) if (!ids.includes(cible)) defauts.push(`ancre #${cible} sans cible`);
  return defauts;
});

// ============================================================================
// 4 & 5. Outils qui produisent des images : slug, fraîcheur
// ============================================================================

const ffmpegDisponible = await new Promise((resoudre) => {
  const proc = spawn(FFMPEG, ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"] });
  let sortie = "";
  proc.stdout.on("data", (d) => (sortie += d));
  proc.once("error", () => resoudre(false));
  proc.once("exit", () => resoudre(/libwebp/.test(sortie)));
});
const SANS_FFMPEG = "IGNORE:ffmpeg avec libwebp introuvable (FFMPEG_PATH)";

/** Image de test, déterministe selon « graine ». */
const creerJpeg = (chemin, graine) => new Promise((resoudre, rejeter) => {
  const proc = spawn(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
    "-i", "testsrc2=size=1000x667:rate=1", "-vf", `hue=h=${graine * 40}`, "-frames:v", "1", chemin,
  ], { stdio: "ignore" });
  proc.once("error", rejeter);
  proc.once("exit", (code) => (code === 0 ? resoudre() : rejeter(new Error(`ffmpeg : code ${code}`))));
});

/** Projet avec originaux réels : données, portfolio et dossier d'originaux. */
async function projetAvecOriginaux(reportage) {
  const racine = await nouveauTemp("optim");
  await mkdir(join(racine, "content", "reportages"), { recursive: true });
  await ecrireJson(join(racine, "content", "reportages", `${reportage.slug}.json`), reportage);
  await cp(join(DEPOT, "portfolio.html"), join(racine, "portfolio.html"));
  const originaux = join(racine, "..", `${racine.split(/[\\/]/).pop()}-originaux`);
  dossiersTemporaires.push(originaux);
  await mkdir(originaux, { recursive: true });
  for (const [i, photo] of reportage.photos.entries()) await creerJpeg(join(originaux, photo.file), i + 1);
  return { racine, originaux };
}
const optimiser = (racine, originaux, slug, extra = []) =>
  lancer(OUTIL("optimize-photos.mjs"), [slug, `--source=${originaux}`, ...extra], racine);

await essai("Slug — traversée de répertoires et slugs invalides refusés, rien n'est écrit", async () => {
  if (!ffmpegDisponible) return SANS_FFMPEG;
  const defauts = [];
  const { racine, originaux } = await projetAvecOriginaux(reportageMinimal("essai"));
  const avant = await empreinteArbre(racine);
  const SLUGS = ["../evasion", "..", ".", "a/b", "a\\b", "/absolu", "C:/absolu", "essai/../evasion", "essai/..", "..\\evasion",
    "ESSAI", "essai ", "es sai", "essai.json", "ess..ai", "-essai", "essai%2f..", "a".repeat(80)];
  for (const slug of SLUGS) {
    const sortie = await optimiser(racine, originaux, slug, ["--dry-run"]);
    if (sortie.code !== 1) defauts.push(`${JSON.stringify(slug)} : code ${sortie.code} (attendu 1)`);
    if (!/Slug refusé/.test(sortie.sortie)) defauts.push(`${JSON.stringify(slug)} : message de refus absent (${sortie.sortie.trim().slice(0, 80)})`);
  }
  // Même sans --dry-run : aucune création de dossier, y compris hors du projet.
  for (const slug of ["../evasion", "a/b", "/absolu"]) await optimiser(racine, originaux, slug);
  if ((await empreinteArbre(racine)) !== avant) defauts.push("le projet a été modifié par un slug refusé");
  const hoteDuProjet = await readdir(join(racine, ".."));
  if (hoteDuProjet.includes("evasion")) defauts.push("un dossier « evasion » a été créé hors du projet");
  return defauts;
});

await essai("Slug — le slug demandé doit être celui du reportage", async () => {
  if (!ffmpegDisponible) return SANS_FFMPEG;
  const reportage = reportageMinimal("essai");
  const { racine, originaux } = await projetAvecOriginaux(reportage);
  // Fichier « autre.json » dont le contenu déclare le slug « essai ».
  await ecrireJson(join(racine, "content", "reportages", "autre.json"), reportage);
  const sortie = await optimiser(racine, originaux, "autre");
  const defauts = [];
  if (sortie.code !== 1) defauts.push(`code ${sortie.code} (attendu 1)`);
  if (!/diffère/.test(sortie.sortie) && !/slug/i.test(sortie.sortie)) defauts.push(`motif absent : ${sortie.sortie.trim().slice(0, 120)}`);
  if (await stat(join(racine, "assets", "img", "reportages", "autre")).then(() => true, () => false)) defauts.push("dossier « autre » créé");
  return defauts;
});

await essai("Images — production, conservation, puis régénération si l'original, les paramètres ou un dérivé changent", async () => {
  if (!ffmpegDisponible) return SANS_FFMPEG;
  const defauts = [];
  const slug = "essai";
  const reportage = reportageMinimal(slug);
  const { racine, originaux } = await projetAvecOriginaux(reportage);
  const dossier = join(racine, "assets", "img", "reportages", slug);
  const cheminManifeste = join(dossier, "manifest.json");
  const empreintesOriginaux = async () => Object.fromEntries(await Promise.all(
    reportage.photos.map(async (p) => [p.file, sha(await readFile(join(originaux, p.file)))])));
  const verifier = async (etape) => {
    const manifeste = await lireJson(cheminManifeste);
    for (const e of validerManifeste(reportage, manifeste, "manifest.json")) defauts.push(`${etape} : ${e}`);
    for (const e of await verifierDerives(slug, manifeste, join(racine, "assets", "img", "reportages"))) defauts.push(`${etape} : ${e}`);
    return manifeste;
  };
  const ecrits = (sortie) => Number(sortie.sortie.match(/(\d+) fichier\(s\) écrit/)?.[1] ?? -1);

  // 1. Première production.
  const originauxAvant = await empreintesOriginaux();
  const premiere = await optimiser(racine, originaux, slug);
  if (premiere.code !== 0) return [`production : code ${premiere.code} — ${premiere.sortie.slice(0, 300)}`];
  let manifeste = await verifier("production");
  for (const [id, e] of Object.entries(manifeste.photos)) {
    const photo = reportage.photos.find((p) => p.id === id);
    if (e.sourceSha256 !== originauxAvant[photo.file]) defauts.push(`${id} : empreinte de l'original non enregistrée`);
  }
  if (JSON.stringify(manifeste.params) !== JSON.stringify(PARAMETRES_CONVERSION)) defauts.push("paramètres non enregistrés");
  const contenuInitial = Object.fromEntries(manifeste.photos.aa.variants.map((v) => [v.file, v.sha256]));

  // 2. Relance sans changement : rien à refaire.
  const idem = await optimiser(racine, originaux, slug);
  if (ecrits(idem) !== 0) defauts.push(`relance à l'identique : ${ecrits(idem)} fichier(s) réécrit(s)`);

  // 3. Un original change → ses dérivés sont refaits, pas ceux de l'autre.
  const bbAvant = (await lireJson(cheminManifeste)).photos.bb.variants[0].sha256;
  await creerJpeg(join(originaux, "AA.jpg"), 7);
  const apresOriginal = await optimiser(racine, originaux, slug);
  manifeste = await verifier("original modifié");
  if (ecrits(apresOriginal) < 2) defauts.push(`original modifié : seulement ${ecrits(apresOriginal)} fichier(s) régénéré(s)`);
  if (manifeste.photos.aa.variants[0].sha256 === contenuInitial["aa-640.webp"]) defauts.push("original modifié : dérivé de AA.jpg périmé conservé");
  if (manifeste.photos.bb.variants[0].sha256 !== bbAvant) defauts.push("original modifié : dérivé de BB.jpg régénéré sans raison");
  if (manifeste.photos.aa.sourceSha256 !== sha(await readFile(join(originaux, "AA.jpg")))) defauts.push("original modifié : empreinte source non mise à jour");

  // 4. Paramètres de conversion différents → tout est refait, jamais le manifeste seul rafraîchi.
  manifeste = await lireJson(cheminManifeste);
  manifeste.params.webp.qualite = 40;
  await ecrireJson(cheminManifeste, manifeste);
  const apresParametres = await optimiser(racine, originaux, slug);
  if (ecrits(apresParametres) < 3) defauts.push(`paramètres modifiés : ${ecrits(apresParametres)} fichier(s) régénéré(s) seulement`);
  manifeste = await verifier("paramètres modifiés");
  if (manifeste.params.webp.qualite !== PARAMETRES_CONVERSION.webp.qualite) defauts.push("paramètres modifiés : manifeste non réaligné");

  // 5. Un dérivé altéré ou absent est refait.
  await writeFile(join(dossier, "aa-640.webp"), "altéré");
  await rm(join(dossier, "bb-640.webp"));
  const apresAlteration = await optimiser(racine, originaux, slug);
  if (ecrits(apresAlteration) !== 2) defauts.push(`dérivés altéré/absent : ${ecrits(apresAlteration)} fichier(s) refait(s), attendu 2`);
  await verifier("dérivés altérés");

  // 6. Manifeste antérieur aux empreintes (sourceSha256 absent) : régénération.
  manifeste = await lireJson(cheminManifeste);
  for (const e of Object.values(manifeste.photos)) e.sourceSha256 = null;
  await ecrireJson(cheminManifeste, manifeste);
  const apresLegacy = await optimiser(racine, originaux, slug);
  if (ecrits(apresLegacy) < 3) defauts.push(`empreinte source absente : ${ecrits(apresLegacy)} fichier(s) refait(s) seulement`);
  manifeste = await verifier("empreinte source absente");
  if (Object.values(manifeste.photos).some((e) => e.sourceSha256 === null)) defauts.push("empreinte source toujours absente après régénération");

  // 7. Fichier orphelin ou temporaire oublié : supprimé, et annoncé.
  await writeFile(join(dossier, "zzz-640.webp"), "x");
  await writeFile(join(dossier, "~tmp-aa-640.webp"), "x");
  const nettoyage = await optimiser(racine, originaux, slug);
  for (const nom of ["zzz-640.webp", "~tmp-aa-640.webp"]) {
    if (await stat(join(dossier, nom)).then(() => true, () => false)) defauts.push(nom + " non supprimé");
  }
  if (!/supprimé \(obsolète\) : zzz-640\.webp/.test(nettoyage.sortie)) defauts.push("suppression de l'orphelin non annoncée");

  // 8. Simulation : rien n'est écrit.
  await writeFile(join(dossier, "aa-640.webp"), "altéré");
  const avantSimulation = await empreinteArbre(racine);
  const simulation = await optimiser(racine, originaux, slug, ["--dry-run"]);
  if (!/\[simulation\].*aa-640\.webp \(fichier altéré\)/.test(simulation.sortie)) defauts.push("simulation : dérivé altéré non signalé");
  if ((await empreinteArbre(racine)) !== avantSimulation) defauts.push("simulation : des fichiers ont été modifiés");
  await optimiser(racine, originaux, slug);

  // Les originaux n'ont jamais bougé, hormis AA.jpg remplacé volontairement par le test.
  const originauxApres = await empreintesOriginaux();
  if (originauxApres["BB.jpg"] !== originauxAvant["BB.jpg"]) defauts.push("BB.jpg (original) modifié par l'outil");
  return defauts;
});

await essai("Images — un original déplacé hors du dossier source ou un dossier FAMILLE est refusé", async () => {
  if (!ffmpegDisponible) return SANS_FFMPEG;
  const { racine, originaux } = await projetAvecOriginaux(reportageMinimal("essai"));
  const defauts = [];
  const refus = await lancer(OUTIL("optimize-photos.mjs"), ["essai", `--source=${join(originaux, "FAMILLE")}`, "--dry-run"], racine);
  if (refus.code !== 1 || !/FAMILLE/.test(refus.sortie)) defauts.push(`FAMILLE : code ${refus.code}`);
  // Sortie dans le dossier des originaux : refusé.
  const dansSortie = await lancer(OUTIL("optimize-photos.mjs"), ["essai", `--source=${join(racine, "assets", "img", "reportages")}`, "--dry-run"], racine);
  if (dansSortie.code !== 1) defauts.push(`source contenant la sortie : code ${dansSortie.code}`);
  return defauts;
});

// ============================================================================
// 5. Référencement : finalisation → retouche éditoriale → régénération
// ============================================================================

/** Copie du site réel (pages, données, images de reportage) dans un répertoire isolé. */
async function copieDuSite() {
  const racine = await nouveauTemp("seo");
  for (const nom of (await readdir(DEPOT)).filter((n) => n.endsWith(".html") || n === "robots.txt")) {
    await cp(join(DEPOT, nom), join(racine, nom));
  }
  await cp(join(DEPOT, "reportages"), join(racine, "reportages"), { recursive: true });
  await cp(join(DEPOT, "content"), join(racine, "content"), { recursive: true });
  await mkdir(join(racine, "assets", "img"), { recursive: true });
  await cp(join(DEPOT, "assets", "img", "reportages"), join(racine, "assets", "img", "reportages"), { recursive: true });
  return racine;
}
const meta = (html, motif) => html.match(motif)?.[1];
const CANONICAL = /<link rel="canonical" href="([^"]*)">/;
const OG_URL = /<meta property="og:url" content="([^"]*)">/;
const OG_IMAGE = /<meta property="og:image" content="([^"]*)">/;

await essai("SEO — finalisation → retouche éditoriale → régénération : canonical, og:url et og:image restent corrects", async () => {
  const defauts = [];
  const BASE = "https://exemple.invalid/depot";
  const PAGE = "reportages/florent.html";
  const racine = await copieDuSite();
  const lire = () => readFile(join(racine, PAGE), "utf8");

  // État initial : aucune adresse supposée, et pages à jour.
  let html = await lire();
  if (meta(html, CANONICAL) || meta(html, OG_URL)) defauts.push("avant finalisation : canonical ou og:url déjà présent");
  if (!/^\.\.\/assets\/img\/reportages\//.test(meta(html, OG_IMAGE) ?? "")) defauts.push("avant finalisation : og:image devrait rester relative");
  const avantFinalisation = await construire(racine, ["--check"]);
  if (avantFinalisation.code !== 0) defauts.push(`--check avant finalisation : ${avantFinalisation.sortie.trim().slice(0, 150)}`);

  // 1. Finalisation.
  const finalisation = await lancer(OUTIL("finalize-urls.mjs"), [BASE], racine);
  if (finalisation.code !== 0) return [`finalize-urls.mjs : code ${finalisation.code} — ${finalisation.sortie.slice(0, 200)}`];
  const verifierPage = (etape, base = BASE, page = html) => {
    const att = { canonical: `${base}/${PAGE}`, ogUrl: `${base}/${PAGE}`, ogImage: `${base}/assets/img/reportages/florent/dsc-0148-og.jpg` };
    if (meta(page, CANONICAL) !== att.canonical) defauts.push(`${etape} : canonical = ${meta(page, CANONICAL)}`);
    if (meta(page, OG_URL) !== att.ogUrl) defauts.push(`${etape} : og:url = ${meta(page, OG_URL)}`);
    if (meta(page, OG_IMAGE) !== att.ogImage) defauts.push(`${etape} : og:image = ${meta(page, OG_IMAGE)}`);
    if ((page.match(/rel="canonical"/g) ?? []).length !== 1) defauts.push(`${etape} : canonical en double ou absent`);
  };
  html = await lire();
  verifierPage("après finalisation");
  const memo = await readFile(join(racine, "content", "site.json"), "utf8").catch(() => "");
  if (!memo.includes(BASE)) defauts.push("content/site.json n'a pas mémorisé l'adresse");

  // 2. Les deux outils se superposent : le générateur ne trouve rien à refaire.
  const apresFinalisation = await construire(racine, ["--check"]);
  if (apresFinalisation.code !== 0) defauts.push(`--check après finalisation : ${apresFinalisation.sortie.trim().slice(0, 200)}`);

  // 3. Retouche éditoriale, puis régénération.
  const donneesChemin = join(racine, "content", "reportages", "florent.json");
  const donnees = await lireJson(donneesChemin);
  donnees.description = "Florent, une célébration, une histoire : un mariage traditionnel raconté en vingt-cinq photographies.";
  donnees.chapters[0].title = "Les mariés, retouché";
  await ecrireJson(donneesChemin, donnees);
  const regeneration = await construire(racine);
  if (regeneration.code !== 0) return [...defauts, `régénération : ${regeneration.sortie.slice(0, 200)}`];
  html = await lire();
  if (!html.includes("raconté en vingt-cinq photographies")) defauts.push("la retouche éditoriale n'apparaît pas dans la page");
  verifierPage("après régénération");
  const portfolio = await readFile(join(racine, "portfolio.html"), "utf8");
  if (!meta(portfolio, CANONICAL)?.startsWith(BASE)) defauts.push("portfolio.html : canonical perdu par la régénération");
  const idempotence = await construire(racine, ["--check"]);
  if (idempotence.code !== 0) defauts.push(`--check après régénération : ${idempotence.sortie.trim().slice(0, 150)}`);

  // 4. Nouvelle adresse : remplacée partout, sans empilement.
  const AUTRE = "https://autre.invalid";
  await lancer(OUTIL("finalize-urls.mjs"), [AUTRE], racine);
  html = await lire();
  verifierPage("nouvelle adresse", AUTRE);
  donnees.subtitle = "Une histoire, autrement";
  await ecrireJson(donneesChemin, donnees);
  await construire(racine);
  html = await lire();
  verifierPage("nouvelle adresse puis régénération", AUTRE);

  // 5. Compatibilité GitHub Pages : adresse avec sous-chemin, chemins relatifs inchangés.
  if (!/<link rel="stylesheet" href="\.\.\/assets\/css\/site\.css">/.test(html)) defauts.push("chemins relatifs des feuilles de style modifiés");
  if (/(?:src|href)="\/[^/]/.test(html)) defauts.push("chemin absolu depuis la racine du serveur (casse GitHub Pages)");

  // 6. Configuration invalide : arrêt net, aucune page écrite à moitié.
  await writeFile(join(racine, "content", "site.json"), '{ "baseUrl": "javascript:alert(1)" }');
  const avantInvalide = await lire();
  const invalide = await construire(racine);
  if (invalide.code !== 1 || !/baseUrl/.test(invalide.sortie)) defauts.push(`site.json invalide accepté (code ${invalide.code})`);
  if ((await lire()) !== avantInvalide) defauts.push("page modifiée malgré un site.json invalide");
  await writeFile(join(racine, "content", "site.json"), "{ pas du json");
  if ((await construire(racine)).code !== 1) defauts.push("site.json illisible accepté");
  return defauts;
});

await essai("SEO — finalize-urls refuse une adresse invalide et ne touche à rien", async () => {
  const racine = await copieDuSite();
  const avant = await empreinteArbre(racine);
  const defauts = [];
  for (const base of ["", "ftp://x.org", "https://", "https://x.org/a b", "https://x.org/?q=1", "https://x.org/#frag", 'https://x.org/"><script>', "https://x.org/../etc", "exemple.org"]) {
    const sortie = await lancer(OUTIL("finalize-urls.mjs"), base ? [base] : [], racine);
    if (sortie.code !== 1) defauts.push(`${JSON.stringify(base)} accepté (code ${sortie.code})`);
  }
  if ((await empreinteArbre(racine)) !== avant) defauts.push("des fichiers ont été modifiés malgré le refus");
  return defauts;
});

// ============================================================================
// 7. Intégrité visuelle : feuille de style
// ============================================================================

await essai("Intégrité visuelle — aucune règle CSS ne zoome, ne rogne ni ne retouche une photographie", async () => {
  const css = (await readFile(join(DEPOT, "assets", "css", "site.css"), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const defauts = [];
  const INTERDITS = [
    [/\bscale\(\s*(?!1\s*\))/, "zoom scale(…)"],
    [/\bscale3d\(/, "zoom scale3d(…)"],
    [/\bbrightness\(/, "luminosité"],
    [/\bcontrast\(/, "contraste"],
    [/\bsaturate\(/, "saturation"],
    [/\bsepia\(|\bgrayscale\(|\bhue-rotate\(|\binvert\(/, "filtre colorimétrique"],
    [/\bobject-fit\s*:\s*(?:cover|none|scale-down)/, "recadrage object-fit"],
    [/\bobject-position\s*:/, "recadrage object-position"],
    // « \S » final : sans lui, \s* pourrait reculer et laisser passer « none ».
    [/\bclip-path\s*:\s*(?!none\b)\S/, "rognage clip-path"],
    [/(?<![-\w])filter\s*:\s*(?!none\b)\S/, "filtre sur une image"],
    [/\bmix-blend-mode\s*:\s*(?!normal\b)\S/, "mélange de couleurs"],
  ];
  for (const [motif, nom] of INTERDITS) {
    const ou = css.match(motif);
    if (ou) {
      const avant = css.slice(0, ou.index);
      const ligne = avant.split("\n").length;
      defauts.push(`${nom} (site.css, ligne ~${ligne} hors commentaires) : « ${css.slice(ou.index, ou.index + 60).split("\n")[0]} »`);
    }
  }
  return defauts;
});

// --- Nettoyage et bilan -------------------------------------------------------

for (const dossier of dossiersTemporaires) await rm(dossier, { recursive: true, force: true }).catch(() => {});

let echecs = 0;
for (const { nom, etat, detail } of resultats) {
  const marque = { ok: "OK   ", echec: "ECHEC", ignore: "IGNORÉ" }[etat];
  console.log(`${marque} ${nom}${detail ? ` (${detail})` : ""}`);
  if (etat === "echec") echecs++;
}
const reussis = resultats.filter((r) => r.etat === "ok").length;
const ignores = resultats.filter((r) => r.etat === "ignore").length;
console.log(`\n${reussis}/${resultats.length} tests réussis${ignores ? `, ${ignores} ignoré(s)` : ""}${echecs ? `, ${echecs} en échec` : ""}.`);
process.exit(echecs ? 1 : 0);
