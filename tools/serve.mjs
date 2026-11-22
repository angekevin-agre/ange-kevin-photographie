/**
 * Serveur statique de développement et de test, sans dépendance.
 *
 *   node tools/serve.mjs                                    → http://127.0.0.1:8123/
 *   node tools/serve.mjs --prefix=ange-kevin-photographie
 *
 * Pourquoi un serveur dédié plutôt que « python -m http.server » : GitHub
 * Pages publie un site de projet sous un sous-chemin (« /<dépôt>/ ») et sert
 * « 404.html » — avec le statut 404 — pour toute URL inexistante, en
 * conservant l'adresse demandée. Ces deux comportements changent la façon dont
 * les chemins relatifs se résolvent ; sans les reproduire en local, la page
 * d'erreur ne peut pas être vérifiée.
 *
 * Les scripts de « tools/ » importent « lancerServeur » et n'ont donc aucun
 * serveur externe à attendre. Lancé directement, ce fichier sert le site.
 *
 * Aucune mise en cache : les vérifications lisent toujours le disque.
 */

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff2": "font/woff2",
};

/**
 * Normalise un sous-chemin de publication en « /segment », ou « » pour la
 * racine. La barre initiale est facultative : certains shells (Git Bash)
 * traduisent un argument commençant par « / » en chemin de fichier.
 */
export const normaliserPrefixe = (valeur) => {
  const segments = String(valeur ?? "").split("/").filter(Boolean);
  return segments.length ? `/${segments.join("/")}` : "";
};

/**
 * Lance le serveur et renvoie son instance ainsi que l'adresse de base du
 * site, sous-chemin compris.
 *
 * @returns {Promise<{serveur: import("node:http").Server, base: string}>}
 */
export function lancerServeur({ port = 8123, host = "127.0.0.1", racine = ".", prefix = "" } = {}) {
  const RACINE = resolve(racine);
  const PREFIXE = normaliserPrefixe(prefix);

  /**
   * Résout une URL vers un fichier du disque, ou null si elle n'existe pas ou
   * sort de la racine. Le chemin est reconstruit segment par segment : aucune
   * remontée (« .. ») ne peut échapper à la racine servie.
   */
  const fichier = async (chemin) => {
    const segments = decodeURIComponent(chemin).split("/").filter((s) => s && s !== ".");
    if (segments.includes("..")) return null;

    const cible = join(RACINE, ...segments);
    if (cible !== RACINE && !cible.startsWith(RACINE + sep)) return null;

    try {
      if (!(await stat(cible)).isDirectory()) return cible;
    } catch {
      return null;
    }

    // Répertoire : on sert son index, s'il existe.
    const index = join(cible, "index.html");
    try {
      return (await stat(index)).isFile() ? index : null;
    } catch {
      return null;
    }
  };

  const envoyer = (reponse, code, chemin) => {
    reponse.writeHead(code, {
      "Content-Type": TYPES[extname(chemin).toLowerCase()] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(chemin).pipe(reponse);
  };

  const serveur = createServer(async (requete, reponse) => {
    const { pathname } = new URL(requete.url, `http://${host}`);

    // Hors du sous-chemin de publication : ce que renvoie GitHub Pages.
    if (PREFIXE && !(pathname === PREFIXE || pathname.startsWith(`${PREFIXE}/`))) {
      reponse.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      reponse.end("404 — hors du sous-chemin de publication\n");
      return;
    }

    const interne = PREFIXE ? pathname.slice(PREFIXE.length) || "/" : pathname;
    const cible = await fichier(interne);
    if (cible) {
      envoyer(reponse, 200, cible);
      return;
    }

    // URL inexistante : page 404 du site, avec le statut 404 et l'adresse
    // demandée telle quelle.
    const page = await fichier("/404.html");
    if (page) {
      envoyer(reponse, 404, page);
      return;
    }
    reponse.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    reponse.end("404\n");
  });

  return new Promise((resolve_, reject) => {
    serveur.once("error", reject);
    serveur.listen(port, host, () => {
      resolve_({ serveur, base: `http://${host}:${port}${PREFIXE}` });
    });
  });
}

// --- Exécution directe ------------------------------------------------------
const estEntree =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (estEntree) {
  const arg = (nom, defaut) =>
    process.argv.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3) ?? defaut;

  const { base } = await lancerServeur({
    port: Number(arg("port", "8123")),
    host: arg("host", "127.0.0.1"),
    racine: arg("root", "."),
    prefix: arg("prefix", ""),
  });
  console.log(`Site servi sur ${base}/`);
  console.log("Ctrl+C pour arrêter.");
}
