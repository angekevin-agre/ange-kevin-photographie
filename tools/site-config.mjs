/**
 * Configuration du site partagée entre les outils qui écrivent des URL :
 *   tools/finalize-urls.mjs      pose l'adresse publique (une fois confirmée)
 *   tools/build-reportages.mjs   régénère les pages de reportage avec cette adresse
 *   tools/check.mjs, tools/test-reportages.mjs   la contrôlent
 *
 * L'adresse publique est conservée dans « content/site.json » :
 *
 *   { "baseUrl": "https://exemple.org/depot" }
 *
 * Pourquoi un fichier plutôt que de relire le canonical des pages : les pages
 * de reportage sont GÉNÉRÉES. Sans mémoire de l'adresse, une régénération
 * après finalisation effaçait canonical, og:url et og:image absolue — le
 * référencement se dégradait en silence à la première retouche éditoriale.
 *
 * Tant que le fichier n'existe pas, l'adresse n'est pas confirmée : les pages
 * ne portent ni canonical ni og:url, et og:image reste relative (état voulu
 * avant publication ; voir finalize-urls.mjs).
 *
 * Compatible GitHub Pages : l'adresse peut contenir un sous-chemin de dépôt
 * (« https://utilisateur.github.io/depot »). Aucune dépendance.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const DOSSIER_CONFIG = "content";
export const CHEMIN_CONFIG_SITE = join(DOSSIER_CONFIG, "site.json");

/** http(s), hôte, port facultatif, segments de chemin simples — rien d'autre. */
const BASE_VALIDE = /^https?:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?(?:\/[A-Za-z0-9._~-]+)*$/;

/** Retire les barres finales ; renvoie null si l'adresse est invalide. */
export function normaliserBase(valeur) {
  if (typeof valeur !== "string") return null;
  const base = valeur.trim().replace(/\/+$/, "");
  if (!BASE_VALIDE.test(base) || base.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return base;
}

/** URL publique d'une page du site (« index.html » est servie à la racine). */
export const urlPage = (base, page) => (page === "index.html" ? `${base}/` : `${base}/${page}`);

/** URL publique d'une ressource du site, depuis la racine publiée. */
export const urlRessource = (base, chemin) => `${base}/${chemin.replace(/^\/+/, "")}`;

/**
 * Lit l'adresse publique confirmée. Renvoie null si elle ne l'est pas encore ;
 * lève une erreur si le fichier existe mais est invalide : mieux vaut
 * interrompre la génération que publier une adresse supposée.
 */
export async function lireBaseUrl(chemin = CHEMIN_CONFIG_SITE) {
  let texte;
  try { texte = await readFile(chemin, "utf8"); } catch { return null; }
  let donnees;
  try { donnees = JSON.parse(texte); } catch (erreur) { throw new Error(`${chemin} : JSON illisible (${erreur.message})`); }
  const base = normaliserBase(donnees?.baseUrl);
  if (base === null) throw new Error(`${chemin} : « baseUrl » doit être une adresse http(s) valide, sans paramètre ni fragment`);
  return base;
}

export async function ecrireBaseUrl(base, chemin = CHEMIN_CONFIG_SITE) {
  await mkdir(DOSSIER_CONFIG, { recursive: true });
  await writeFile(chemin, `${JSON.stringify({ baseUrl: base }, null, 2)}\n`, "utf8");
}
