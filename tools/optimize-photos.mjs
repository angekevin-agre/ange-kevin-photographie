/**
 * Produit les formats web d'un reportage à partir des originaux du photographe.
 *
 *   node tools/optimize-photos.mjs <slug> --source="<dossier des originaux>"
 *   node tools/optimize-photos.mjs florent --source="<chemin>/FINALE FLORENT 7 DECEMBRE/ANOTHER"
 *
 * Options :
 *   --force    régénère tous les dérivés, même s'ils sont à jour
 *   --dry-run  affiche ce qui serait fait, sans rien écrire ni supprimer
 *
 * Garanties :
 *   - Les originaux ne sont jamais modifiés. Ils sont lus par ffmpeg en lecture
 *     seule, le dossier de sortie ne peut pas se trouver dans le dossier source,
 *     et l'empreinte SHA-256 de chaque original est comparée avant et après
 *     traitement : toute différence interrompt le script.
 *   - Seuls les fichiers déclarés dans content/reportages/<slug>.json sont lus.
 *     Un dossier source contenant FAMILLE ou INDIVIDUEL est refusé.
 *   - Le slug est un identifiant (minuscules, chiffres, tirets), identique à
 *     celui du reportage ; la destination reste dans assets/img/reportages/.
 *     Un slug contenant « .. », un séparateur de chemin ou un chemin absolu est
 *     refusé avant tout accès au disque.
 *   - Les images sont seulement redimensionnées : ni recadrage, ni retouche, ni
 *     filigrane retiré ou ajouté.
 *   - Les métadonnées (EXIF, coordonnées GPS, appareil) sont retirées des
 *     fichiers publiés.
 *
 * Fraîcheur des dérivés : le manifeste associe chaque photographie à
 * l'empreinte SHA-256 de son original (sourceSha256), chaque dérivé à sa
 * propre empreinte, et l'ensemble aux paramètres de conversion
 * (PARAMETRES_CONVERSION, reportages-lib.mjs). Un dérivé n'est conservé que si
 *   1. l'original a la même empreinte qu'à la production ;
 *   2. les paramètres de conversion n'ont pas changé ;
 *   3. le fichier existe et a l'empreinte enregistrée.
 * Sinon il est régénéré. Un manifeste ne conserve jamais un dérivé obsolète :
 * il n'est écrit qu'une fois tous les dérivés produits, et les fichiers qu'il
 * ne référence plus sont supprimés. Un manifeste sans empreinte source
 * (antérieur à ce mécanisme) force la régénération.
 *
 * Sortie, dans assets/img/reportages/<slug>/ :
 *   <id>-<largeur>.webp   déclinaisons (3 ou 4 largeurs selon l'orientation)
 *   <id>-og.jpg           visuel de partage de la couverture (1200 px, JPEG,
 *                         format le mieux accepté par les réseaux sociaux)
 *   manifest.json         empreintes, paramètres, dimensions et fichiers,
 *                         lu par build-reportages.mjs
 *
 * Prérequis : ffmpeg et ffprobe (build comprenant libwebp), dans le PATH ou
 * désignés par FFMPEG_PATH et FFPROBE_PATH.
 */

import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  DOSSIER_DONNEES, DOSSIER_IMAGES, PARAMETRES_CONVERSION, SLUG, cheminManifeste, empreinteFichier,
  empreinteParametres, estDansDossier, mentionneDossierExclu, validerReportage,
} from "./reportages-lib.mjs";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH ?? "ffprobe";

/** Largeurs, qualité : voir PARAMETRES_CONVERSION. Paysage jusqu'à 2400 px ;
 *  portrait jusqu'à 1200 px (la hauteur d'affichage est bornée à ~90 % de la
 *  fenêtre : une image verticale ne dépasse pas ~700 px CSS de large). */
const { largeurs: LARGEURS, webp: WEBP, partage: PARTAGE } = PARAMETRES_CONVERSION;
const NB_CARACTERES_SLUG_MAX = 64;

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const option = (nom) => args.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const drapeau = (nom) => args.includes(`--${nom}`);
const simulation = drapeau("dry-run");
const forcer = drapeau("force");

const refuser = (message, code = 1) => { console.error(message); process.exit(code); };

const source = option("source");
if (!slug || !source) {
  refuser('Usage : node tools/optimize-photos.mjs <slug> --source="<dossier des originaux>" [--force] [--dry-run]');
}

// --- Contrôle du slug, avant tout accès au disque -----------------------------
// Le slug nomme un dossier de sortie ET un fichier de données : il ne doit
// jamais pouvoir désigner autre chose qu'un enfant direct de ces dossiers.
if (typeof slug !== "string" || slug.length > NB_CARACTERES_SLUG_MAX || !SLUG.test(slug)) {
  refuser(`Slug refusé : « ${slug} ». Un slug ne contient que des minuscules, des chiffres et des tirets `
    + `(${NB_CARACTERES_SLUG_MAX} caractères au plus) : ni « .. », ni séparateur de chemin, ni chemin absolu.`);
}
const racineImages = resolve(DOSSIER_IMAGES);
const dossierSortie = resolve(racineImages, slug);
if (!estDansDossier(racineImages, dossierSortie) || relative(racineImages, dossierSortie) !== slug) {
  refuser(`Destination refusée : ${dossierSortie} sort de ${racineImages}.`);
}

const executer = (commande, parametres) => new Promise((resoudre, rejeter) => {
  const proc = spawn(commande, parametres, { stdio: ["ignore", "pipe", "pipe"] });
  let sortie = "", erreurs = "";
  proc.stdout.on("data", (d) => (sortie += d));
  proc.stderr.on("data", (d) => (erreurs += d));
  proc.once("error", rejeter);
  proc.once("exit", (code) =>
    code === 0 ? resoudre(sortie) : rejeter(new Error(`${commande} : code ${code}\n${erreurs.trim()}`)));
});

const existe = (chemin) => stat(chemin).then(() => true, () => false);

async function dimensions(chemin) {
  const sortie = await executer(FFPROBE, [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", chemin,
  ]);
  const [largeur, hauteur] = sortie.trim().split("x").map(Number);
  if (!largeur || !hauteur) throw new Error(`dimensions illisibles : ${chemin}`);
  return { largeur, hauteur };
}

// --- Contrôles préalables ---------------------------------------------------
const dossierSource = resolve(source);

if (mentionneDossierExclu(dossierSource)) {
  refuser(`Dossier refusé : ${dossierSource} — les dossiers FAMILLE et INDIVIDUEL ne sont pas publiés.`);
}
const rel = relative(dossierSource, dossierSortie);
if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
  refuser("Le dossier de sortie ne peut pas se trouver dans le dossier des originaux.");
}

const cheminDonnees = join(DOSSIER_DONNEES, `${slug}.json`);
let reportage;
try {
  reportage = JSON.parse(await readFile(cheminDonnees, "utf8"));
} catch (erreur) {
  refuser(`${cheminDonnees} : illisible (${erreur.code ?? erreur.message}).`);
}
const erreurs = validerReportage(reportage, cheminDonnees);
if (erreurs.length) refuser(erreurs.join("\n"));
if (reportage.slug !== slug) {
  refuser(`${cheminDonnees} : le slug du reportage (« ${reportage.slug} ») diffère de celui demandé (« ${slug} »).`);
}

const manquants = [];
for (const photo of reportage.photos) {
  const chemin = resolve(dossierSource, photo.file);
  if (!estDansDossier(dossierSource, chemin) || !(await existe(chemin))) manquants.push(photo.file);
}
if (manquants.length) {
  refuser(`Fichier(s) absent(s) de ${dossierSource} :\n  ${manquants.join("\n  ")}`);
}

await executer(FFMPEG, ["-hide_banner", "-encoders"]).then((liste) => {
  if (!/libwebp/.test(liste)) throw new Error("ffmpeg ne dispose pas de l'encodeur libwebp.");
});

// --- Manifeste précédent ----------------------------------------------------
// Utilisé seulement s'il est de la bonne version, du bon reportage et produit
// avec les paramètres actuels : sinon tous les dérivés sont à refaire.
const cheminDuManifeste = cheminManifeste(slug);
let ancien = {};
let motifGlobal = null;
const precedent = await readFile(cheminDuManifeste, "utf8").then(JSON.parse, () => null);
if (!precedent) motifGlobal = "aucun manifeste précédent";
else if (precedent.version !== 2 || precedent.slug !== slug) motifGlobal = "manifeste d'une autre version";
else if (JSON.stringify(precedent.params) !== empreinteParametres()) motifGlobal = "paramètres de conversion modifiés";
else if (typeof precedent.photos === "object" && precedent.photos !== null) ancien = precedent.photos;
if (forcer) motifGlobal = "--force";

if (!simulation) await mkdir(dossierSortie, { recursive: true });

// --- Traitement -------------------------------------------------------------

/**
 * Le dérivé peut-il être conservé ? Renvoie null s'il le peut, sinon la raison
 * de sa régénération.
 */
async function raisonDeRegeneration(precedente, attendu, empreinteOriginal) {
  if (motifGlobal) return motifGlobal;
  if (!precedente) return "photographie absente du manifeste précédent";
  if (precedente.sourceSha256 === null || precedente.sourceSha256 === undefined) {
    return "empreinte de l'original non enregistrée";
  }
  if (precedente.sourceSha256 !== empreinteOriginal) return "original modifié";
  const ancienDerive = [...(precedente.variants ?? []), ...(precedente.og ? [precedente.og] : [])]
    .find((d) => d?.file === attendu.file);
  if (!ancienDerive || ancienDerive.width !== attendu.width || ancienDerive.height !== attendu.height) {
    return "dimensions ou déclinaison modifiées";
  }
  const empreinte = await empreinteFichier(join(dossierSortie, attendu.file)).catch(() => null);
  if (empreinte === null) return "fichier absent";
  if (empreinte !== ancienDerive.sha256) return "fichier altéré";
  return null;
}

/** Écrit dans un fichier temporaire puis renomme : jamais de dérivé à moitié écrit. */
async function produire(parametresFfmpeg, fichier) {
  const temporaire = join(dossierSortie, `~tmp-${fichier}`);
  try {
    await executer(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...parametresFfmpeg, temporaire]);
    await rename(temporaire, join(dossierSortie, fichier));
  } catch (erreur) {
    await rm(temporaire, { force: true });
    throw erreur;
  }
}

const manifeste = { version: 2, slug, params: PARAMETRES_CONVERSION, photos: {} };
const attendus = new Set(["manifest.json"]);
let ecrits = 0, conserves = 0;

for (const photo of reportage.photos) {
  const original = join(dossierSource, photo.file);
  const avant = await empreinteFichier(original);
  const { largeur, hauteur } = await dimensions(original);
  const orientation = largeur >= hauteur ? "paysage" : "portrait";
  const precedente = Object.hasOwn(ancien, photo.id) ? ancien[photo.id] : null;

  // Jamais d'agrandissement : la plus grande déclinaison est bornée par l'original.
  const largeurs = LARGEURS[orientation].filter((l) => l < largeur);
  if (largeurs.length === 0) largeurs.push(largeur);

  const planifies = largeurs.map((l) => ({
    file: `${photo.id}-${l}.webp`, width: l, height: Math.round((hauteur * l) / largeur),
    ffmpeg: ["-i", original, "-vf", `scale=${l}:${Math.round((hauteur * l) / largeur)}:flags=${WEBP.reduction}`,
      "-map_metadata", "-1", "-c:v", "libwebp", "-preset", WEBP.preset, "-quality", String(WEBP.qualite),
      "-compression_level", String(WEBP.niveauCompression)],
  }));
  if (photo.id === reportage.cover) {
    // Jamais d'agrandissement non plus pour le visuel de partage.
    const lOg = Math.min(PARTAGE.largeur, largeur);
    const hOg = Math.round((hauteur * lOg) / largeur);
    planifies.push({
      file: `${photo.id}-og.jpg`, width: lOg, height: hOg, partage: true,
      ffmpeg: ["-i", original, "-vf", `scale=${lOg}:${hOg}:flags=${WEBP.reduction}`,
        "-map_metadata", "-1", "-q:v", String(PARTAGE.qualiteJpeg)],
    });
  }

  const derives = [];
  for (const d of planifies) {
    attendus.add(d.file);
    const raison = await raisonDeRegeneration(precedente, d, avant);
    if (raison === null) {
      conserves++;
    } else if (simulation) {
      console.log(`[simulation] ${photo.file} → ${d.file} (${raison})`);
    } else {
      await produire(d.ffmpeg, d.file);
      ecrits++;
    }
    const sha256 = simulation && raison !== null ? null : await empreinteFichier(join(dossierSortie, d.file));
    derives.push({ ...d, sha256 });
  }

  // L'original doit être resté strictement identique.
  if ((await empreinteFichier(original)) !== avant) {
    refuser(`ARRÊT : l'original ${original} a changé pendant le traitement.`, 2);
  }

  const versManifeste = ({ file, width, height, sha256 }) => ({ file, width, height, sha256 });
  const entree = {
    source: photo.file,
    sourceSha256: avant,
    width: largeur,
    height: hauteur,
    variants: derives.filter((d) => !d.partage).map(versManifeste),
  };
  const og = derives.find((d) => d.partage);
  if (og) entree.og = versManifeste(og);
  manifeste.photos[photo.id] = entree;
  console.log(`${photo.file} (${largeur}×${hauteur}) → ${entree.variants.map((v) => v.width).join(", ")} px`);
}

// --- Écriture du manifeste, puis nettoyage ----------------------------------
// Le manifeste n'est écrit qu'une fois TOUS les dérivés produits : un échec en
// cours de route laisse l'ancien manifeste, jamais un manifeste qui promet des
// fichiers absents. Les fichiers qu'il ne référence plus sont ensuite retirés.
let supprimes = 0;
if (!simulation) {
  const temporaire = join(dossierSortie, "~tmp-manifest.json");
  await writeFile(temporaire, `${JSON.stringify(manifeste, null, 2)}\n`, "utf8");
  await rename(temporaire, cheminDuManifeste);
  for (const nom of await readdir(dossierSortie)) {
    if (attendus.has(nom) || !/^(?:~tmp-.*|.*\.(?:webp|jpe?g))$/i.test(nom)) continue;
    await rm(join(dossierSortie, nom), { force: true });
    supprimes++;
    console.log(`supprimé (obsolète) : ${nom}`);
  }
}
console.log(`\n${ecrits} fichier(s) écrit(s), ${conserves} conservé(s)${supprimes ? `, ${supprimes} obsolète(s) supprimé(s)` : ""}. `
  + "Originaux vérifiés intacts (SHA-256).");
console.log("Étape suivante : node tools/build-reportages.mjs");
