/**
 * Reportages — lecture et validation des données, partagées par :
 *   tools/build-reportages.mjs   génération des pages statiques
 *   tools/optimize-photos.mjs    production des formats web
 *   tools/check.mjs              tests
 *
 * Un reportage est décrit par un seul fichier JSON dans « content/reportages/ »
 * (voir reportage.schema.json, au même endroit). La page HTML qui en découle
 * est générée, puis versionnée : GitHub Pages la sert telle quelle, sans
 * étape de build, et elle reste lisible sans JavaScript et indexable.
 *
 * Aucune dépendance.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const DOSSIER_DONNEES = join("content", "reportages");
export const DOSSIER_PAGES = "reportages";
export const DOSSIER_IMAGES = join("assets", "img", "reportages");

/** Catégories de reportage, et leur intitulé affiché. */
export const CATEGORIES = {
  mariages: "Mariage",
  anniversaires: "Anniversaire",
  portraits: "Portrait",
  evenements: "Événement",
};

/**
 * Compositions disponibles pour un « plan » (frame) :
 *   pleine   une photographie, sur toute la largeur utile
 *   gauche   une photographie à gauche, texte à droite
 *   droite   une photographie à droite, texte à gauche
 *   diptyque deux photographies côte à côte, la seconde décalée
 *   centre   une photographie étroite, centrée (portrait)
 */
export const COMPOSITIONS = {
  pleine: 1,
  gauche: 1,
  droite: 1,
  diptyque: 2,
  centre: 1,
};

/**
 * Dossiers de l'archive du photographe à ne jamais publier dans un reportage.
 * Le contrôle porte sur le nom de fichier déclaré comme sur le dossier source
 * passé à optimize-photos.mjs.
 */
export const DOSSIERS_EXCLUS = ["FAMILLE", "INDIVIDUEL"];

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_PHOTO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Nom de fichier source : un simple nom, sans séparateur ni « .. ». */
const FICHIER = /^[A-Za-z0-9](?:[A-Za-z0-9_-]|\.(?!\.))*\.(?:jpe?g|png|tiff?)$/i;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Paramètres de conversion des images web. Ils sont enregistrés dans le
 * manifeste avec chaque lot de dérivés : changer l'un d'eux rend les dérivés
 * existants périmés, et optimize-photos.mjs les régénère.
 */
export const PARAMETRES_CONVERSION = Object.freeze({
  version: 1,
  largeurs: Object.freeze({
    paysage: Object.freeze([640, 1024, 1600, 2400]),
    portrait: Object.freeze([480, 800, 1200]),
  }),
  webp: Object.freeze({ qualite: 78, niveauCompression: 6, preset: "photo", reduction: "lanczos" }),
  partage: Object.freeze({ largeur: 1200, qualiteJpeg: 3 }),
  metadonnees: "retirees",
});
export const empreinteParametres = () => JSON.stringify(PARAMETRES_CONVERSION);

/** Échappe une valeur destinée à un contenu ou à un attribut HTML. */
export const echapper = (valeur) => String(valeur)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Le chemin visé reste-t-il STRICTEMENT à l'intérieur de la racine ? */
export function estDansDossier(racine, cible) {
  const rel = relative(resolve(racine), resolve(cible));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Empreinte SHA-256 d'un fichier, lue en flux. */
export const empreinteFichier = (chemin) => new Promise((resoudre, rejeter) => {
  const hash = createHash("sha256");
  createReadStream(chemin).on("data", (d) => hash.update(d)).once("end", () => resoudre(hash.digest("hex"))).once("error", rejeter);
});

const objetSimple = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const entierPositif = (v) => Number.isInteger(v) && v > 0;
const estTexte = (v) => typeof v === "string" && v.trim() !== "";
const estListeDeTextes = (v) => Array.isArray(v) && v.length > 0 && v.every(estTexte);

/** Mentionne-t-il un dossier exclu ? Insensible à la casse. */
export const mentionneDossierExclu = (chemin) =>
  DOSSIERS_EXCLUS.some((nom) =>
    String(chemin).split(/[\\/]/).some((segment) => segment.toUpperCase() === nom)
  );

/**
 * Valide un reportage. Renvoie la liste des erreurs, vide si tout est
 * conforme. Les messages désignent le champ fautif, pour être corrigés sans
 * avoir à relire ce fichier.
 *
 * Règles au-delà de la simple forme :
 *   - chaque photographie déclarée est utilisée exactement une fois, couverture
 *     comprise : aucune image ne disparaît ni n'apparaît deux fois ;
 *   - toute photographie a un texte alternatif ;
 *   - aucun fichier ne provient d'un dossier exclu.
 */
export function validerReportage(donnees, nomFichier = "reportage") {
  const erreurs = [];
  const e = (message) => erreurs.push(`${nomFichier} : ${message}`);

  if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) {
    e("le contenu doit être un objet JSON");
    return erreurs;
  }

  if (!estTexte(donnees.slug) || !SLUG.test(donnees.slug)) e("« slug » doit être en minuscules, chiffres et tirets");
  for (const champ of ["title", "subtitle", "occasion", "location", "description"]) {
    if (!estTexte(donnees[champ])) e(`« ${champ} » est obligatoire`);
  }
  if (estTexte(donnees.description) && (donnees.description.length < 70 || donnees.description.length > 160)) {
    e(`« description » doit compter entre 70 et 160 caractères (${donnees.description.length})`);
  }
  if (donnees.seoTitle !== undefined && (!estTexte(donnees.seoTitle) || donnees.seoTitle.length > 65)) {
    e("« seoTitle » doit être un texte de 65 caractères au plus");
  }
  if (!Object.hasOwn(CATEGORIES, donnees.category)) {
    e(`« category » doit valoir ${Object.keys(CATEGORIES).join(", ")}`);
  }
  if (donnees.order !== undefined && !Number.isInteger(donnees.order)) e("« order » doit être un entier");
  if (!estTexte(donnees.introTitle)) e("« introTitle » est obligatoire");
  if (!estListeDeTextes(donnees.intro)) e("« intro » doit être une liste non vide de paragraphes");
  if (donnees.closing !== undefined && !estListeDeTextes(donnees.closing)) {
    e("« closing » doit être une liste non vide de paragraphes");
  }

  // --- Photographies -------------------------------------------------------
  const photos = new Map();
  if (!Array.isArray(donnees.photos) || donnees.photos.length === 0) {
    e("« photos » doit être une liste non vide");
  } else {
    donnees.photos.forEach((photo, i) => {
      const ref = `photos[${i}]`;
      if (!objetSimple(photo)) { e(`${ref} doit être un objet`); return; }
      if (!estTexte(photo.id) || !ID_PHOTO.test(photo.id)) { e(`${ref}.id invalide`); return; }
      if (photos.has(photo.id)) e(`${ref}.id « ${photo.id} » est déclaré deux fois`);
      if (!estTexte(photo.file) || !FICHIER.test(photo.file)) {
        e(`${ref}.file doit être un simple nom de fichier image, sans dossier (${photo.file})`);
      } else if (mentionneDossierExclu(photo.file)) {
        e(`${ref}.file provient d'un dossier exclu`);
      }
      if (!estTexte(photo.alt)) e(`${ref}.alt (texte alternatif) est obligatoire — « ${photo.id} »`);
      if (photo.caption !== undefined && !estTexte(photo.caption)) e(`${ref}.caption doit être un texte non vide`);
      photos.set(photo.id, photo);
    });
    const fichiers = donnees.photos.map((p) => p?.file).filter(Boolean);
    const doublons = fichiers.filter((f, i) => fichiers.indexOf(f) !== i);
    if (doublons.length) e(`fichier(s) déclaré(s) deux fois : ${[...new Set(doublons)].join(", ")}`);
  }

  // --- Couverture et chapitres --------------------------------------------
  const utilisations = new Map();
  const utiliser = (id, ou) => {
    if (!photos.has(id)) { e(`${ou} : photographie inconnue « ${id} »`); return; }
    utilisations.set(id, (utilisations.get(id) ?? 0) + 1);
  };

  if (!estTexte(donnees.cover)) e("« cover » doit désigner une photographie");
  else utiliser(donnees.cover, "cover");

  const idsChapitres = new Set();
  if (!Array.isArray(donnees.chapters) || donnees.chapters.length === 0) {
    e("« chapters » doit être une liste non vide");
  } else {
    donnees.chapters.forEach((chapitre, i) => {
      const ref = `chapters[${i}]`;
      if (!objetSimple(chapitre)) { e(`${ref} doit être un objet`); return; }
      if (!estTexte(chapitre.id) || !SLUG.test(chapitre.id)) e(`${ref}.id invalide`);
      else if (idsChapitres.has(chapitre.id)) e(`${ref}.id « ${chapitre.id} » est déclaré deux fois`);
      else idsChapitres.add(chapitre.id);
      if (!estTexte(chapitre.title)) e(`${ref}.title est obligatoire`);
      if (!estListeDeTextes(chapitre.text)) e(`${ref}.text doit être une liste non vide de paragraphes`);
      if (!Array.isArray(chapitre.frames) || chapitre.frames.length === 0) {
        e(`${ref}.frames doit être une liste non vide`);
        return;
      }
      chapitre.frames.forEach((plan, j) => {
        const refPlan = `${ref}.frames[${j}]`;
        if (!objetSimple(plan)) { e(`${refPlan} doit être un objet`); return; }
        if (!Object.hasOwn(COMPOSITIONS, plan.layout)) {
          e(`${refPlan}.layout doit valoir ${Object.keys(COMPOSITIONS).join(", ")}`);
          return;
        }
        if (!Array.isArray(plan.photos) || plan.photos.length !== COMPOSITIONS[plan.layout]) {
          e(`${refPlan} : la composition « ${plan.layout} » attend ${COMPOSITIONS[plan.layout]} photographie(s)`);
          return;
        }
        if (plan.note !== undefined && !estListeDeTextes(plan.note)) {
          e(`${refPlan}.note doit être une liste non vide de paragraphes`);
        }
        for (const id of plan.photos) {
          if (!estTexte(id)) e(`${refPlan}.photos ne peut contenir que des identifiants de photographie`);
          else utiliser(id, refPlan);
        }
      });
    });
  }

  for (const [id, n] of utilisations) {
    if (n > 1) e(`la photographie « ${id} » est utilisée ${n} fois`);
  }
  for (const id of photos.keys()) {
    if (!utilisations.has(id)) e(`la photographie « ${id} » est déclarée mais jamais affichée`);
  }

  return erreurs;
}

/** Une déclinaison, ou le visuel de partage : forme, nom, dimensions, empreinte. */
function validerDerive(d, ref, nomAttendu, originale, e) {
  if (!objetSimple(d)) { e(`${ref} : entrée invalide (null ou non objet)`); return false; }
  if (!entierPositif(d.width) || !entierPositif(d.height)) { e(`${ref} : dimensions non positives`); return false; }
  if (d.file !== nomAttendu) e(`${ref} : nom de fichier « ${d.file} » inattendu, attendu « ${nomAttendu} »`);
  if (!SHA256.test(String(d.sha256))) e(`${ref} : empreinte du dérivé absente ou invalide`);
  if (d.width > originale.width) e(`${ref} : plus large que l'original (agrandissement)`);
  // Aucun recadrage : le rapport est celui de l'original, à l'arrondi près.
  if (Math.abs(d.height - (originale.height * d.width) / originale.width) > 1) e(`${ref} : proportions modifiées`);
  return true;
}

/** Une entrée du manifeste, comparée à la photographie déclarée. */
function validerEntree(photo, entree, estCouverture, e) {
  if (!objetSimple(entree)) { e(`« ${photo.id} » : entrée absente ou invalide — « ${photo.id} » n'a pas été optimisée`); return; }
  if (entree.source !== photo.file) e(`« ${photo.id} » a été produite depuis ${entree.source}, attendu ${photo.file}`);
  if (entree.sourceSha256 !== null && !SHA256.test(String(entree.sourceSha256))) {
    e(`« ${photo.id} » : empreinte de l'original invalide`);
  }
  if (!entierPositif(entree.width) || !entierPositif(entree.height)) {
    e(`« ${photo.id} » : dimensions de l'original invalides`);
    return;
  }
  if (!Array.isArray(entree.variants) || entree.variants.length === 0) {
    e(`« ${photo.id} » n'a aucune déclinaison`);
    return;
  }
  let precedente = 0;
  entree.variants.forEach((v, i) => {
    const ref = `« ${photo.id} » déclinaison ${i}`;
    if (!validerDerive(v, ref, `${photo.id}-${v?.width}.webp`, entree, e)) return;
    if (v.width <= precedente) e(`${ref} : largeurs non croissantes`);
    precedente = v.width;
  });
  if (estCouverture) {
    if (objetSimple(entree.og)) validerDerive(entree.og, "visuel de partage", `${photo.id}-og.jpg`, entree, e);
    else e("visuel de partage absent pour la couverture");
  }
}

/**
 * Valide un manifeste d'images optimisées (écrit par optimize-photos.mjs)
 * contre le reportage qu'il décrit. Strict : un manifeste incomplet, mal
 * typé ou obsolète est refusé avant qu'une page ne soit générée.
 *
 * Les entrées dont l'empreinte de l'original n'est pas connue
 * (`sourceSha256: null`, manifeste antérieur aux empreintes) sont acceptées
 * mais signalées par `avertissementsManifeste` : elles ne sont pas
 * vérifiables, et optimize-photos.mjs les régénère systématiquement.
 */
export function validerManifeste(reportage, manifeste, nomFichier = "manifeste") {
  const erreurs = [];
  const e = (m) => erreurs.push(`${nomFichier} : ${m}`);
  if (!objetSimple(manifeste) || !objetSimple(manifeste.photos)) {
    return [`${nomFichier} : manifeste absent ou illisible — lancer tools/optimize-photos.mjs`];
  }
  if (manifeste.version !== 2) e("version de manifeste inconnue — relancer tools/optimize-photos.mjs");
  if (manifeste.slug !== reportage.slug) e(`« slug » = ${JSON.stringify(manifeste.slug)}, attendu « ${reportage.slug} »`);
  if (JSON.stringify(manifeste.params) !== empreinteParametres()) {
    e("paramètres de conversion différents des paramètres actuels : images périmées, relancer tools/optimize-photos.mjs");
  }
  const connues = new Set(reportage.photos.map((p) => p.id));
  for (const id of Object.keys(manifeste.photos)) {
    if (!connues.has(id)) e(`« ${id} » figure au manifeste mais plus dans le reportage`);
  }
  for (const photo of reportage.photos) {
    const entree = Object.hasOwn(manifeste.photos, photo.id) ? manifeste.photos[photo.id] : undefined;
    validerEntree(photo, entree, photo.id === reportage.cover, e);
  }
  return erreurs;
}

/** Identifiants dont l'original n'est pas vérifiable (manifeste sans empreinte source). */
export function avertissementsManifeste(manifeste) {
  return Object.entries(manifeste?.photos ?? {})
    .filter(([, entree]) => entree?.sourceSha256 === null)
    .map(([id]) => id);
}

/**
 * Compare le dossier d'images au manifeste : chaque dérivé existe, son
 * empreinte SHA-256 est celle déclarée, et aucun fichier n'est orphelin.
 */
export async function verifierDerives(slug, manifeste, dossierImages = DOSSIER_IMAGES) {
  const erreurs = [];
  const dossier = join(dossierImages, slug);
  const attendus = new Set(["manifest.json"]);
  const fichiers = Object.values(manifeste.photos).flatMap((entree) => [...entree.variants, ...(entree.og ? [entree.og] : [])]);
  for (const f of fichiers) {
    attendus.add(f.file);
    const empreinte = await empreinteFichier(join(dossier, f.file)).catch(() => null);
    if (empreinte === null) erreurs.push(`${slug}/${f.file} : fichier absent`);
    else if (empreinte !== f.sha256) erreurs.push(`${slug}/${f.file} : contenu différent du manifeste (dérivé périmé ou altéré)`);
  }
  for (const nom of await readdir(dossier).catch(() => [])) {
    if (!attendus.has(nom)) erreurs.push(`${slug}/${nom} : fichier orphelin`);
  }
  return erreurs;
}

/** Lit tous les reportages, triés par ordre d'affichage puis par slug. */
export async function chargerReportages(dossier = DOSSIER_DONNEES) {
  const noms = (await readdir(dossier).catch(() => []))
    .filter((n) => n.endsWith(".json") && !n.endsWith(".schema.json"))
    .sort();
  const reportages = [];
  for (const nom of noms) {
    const chemin = join(dossier, nom);
    let donnees;
    try {
      donnees = JSON.parse(await readFile(chemin, "utf8"));
    } catch (erreur) {
      reportages.push({ chemin, donnees: null, erreurs: [`${chemin} : JSON illisible (${erreur.message})`] });
      continue;
    }
    const erreurs = validerReportage(donnees, chemin);
    if (estTexte(donnees?.slug) && `${donnees.slug}.json` !== nom) {
      erreurs.push(`${chemin} : le nom du fichier doit être « ${donnees.slug}.json »`);
    }
    reportages.push({ chemin, donnees, erreurs });
  }
  return reportages.sort((a, b) =>
    (a.donnees?.order ?? 999) - (b.donnees?.order ?? 999) || a.chemin.localeCompare(b.chemin));
}

/** Ordre d'apparition des photographies : couverture, puis chapitres. */
export function ordrePhotos(reportage) {
  const ordre = [reportage.cover];
  for (const chapitre of reportage.chapters) {
    for (const plan of chapitre.frames) ordre.push(...plan.photos);
  }
  return ordre;
}

export const cheminManifeste = (slug) => join(DOSSIER_IMAGES, slug, "manifest.json");
