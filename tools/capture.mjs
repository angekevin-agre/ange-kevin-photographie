/**
 * Captures d'écran et relevé de console, via le protocole DevTools de Chrome.
 *
 *   node tools/capture.mjs
 *
 * Le serveur de test est lancé par ce script (« tools/serve.mjs »), avec le
 * sous-chemin de publication de GitHub Pages : les captures montrent donc le
 * site tel qu'il sera servi, page 404 comprise.
 *
 * Options :
 *   --base=<url>                   serveur déjà lancé, à utiliser à la place
 *   --out=.captures                répertoire de sortie (ignoré par Git)
 *   --port=9222                    port de débogage
 *   --http=8130                    port du serveur statique lancé ici
 *   --pages=a.html,b/c.html        limite les pages capturées
 *   --devices=mobile,desktop       limite les appareils (mobile, tablette, desktop)
 *   --timeout=10000                durée maximale d'une commande DevTools (ms)
 *   --inject-stall=N[,persist]     DIAGNOSTIC : la N-ième capture d'écran ne
 *                                  répond jamais (une fois, ou à chaque
 *                                  tentative avec « persist »). Sert à vérifier
 *                                  la reprise sur blocage (tools/test-capture.mjs).
 *
 * Code de sortie :
 *   0  toutes les captures attendues sont produites, aucune anomalie
 *   1  captures complètes, mais anomalies relevées (console, débordement)
 *   2  captures incomplètes : au moins une n'a pas été produite
 *
 * Blocage observé (PHOTO-02C) : sur une page de reportage, Chrome sans
 * interface cesse parfois de répondre à Page.captureScreenshot. La commande ne
 * rendait alors jamais la main, ou l'outil abandonnait les écrans suivants
 * tout en annonçant la page comme capturée. Désormais :
 *   - chaque commande DevTools est bornée ; un dépassement n'est jamais ignoré ;
 *   - après un dépassement, le navigateur entier est tué (arbre de processus
 *     compris) et relancé avec un profil neuf, puis la page est reprise du
 *     début — une cible bloquée ne se « débloque » pas, elle se remplace ;
 *   - les captures réellement écrites (fichier non vide) sont comptées et
 *     comparées à celles attendues ;
 *   - une capture manquante donne un code de sortie 2, sans exception.
 * Les délais ne sont pas allongés : ils bornent la perte, ils ne la masquent pas.
 *
 * Pourquoi le protocole DevTools plutôt que « chrome --screenshot » : sous
 * Windows, Chrome impose une largeur de fenêtre minimale d'environ 500 px.
 * Une capture demandée à 390 px est alors un recadrage d'un rendu plus large,
 * donc trompeuse. Emulation.setDeviceMetricsOverride impose la largeur réelle.
 *
 * Aucune dépendance : WebSocket et fetch sont natifs depuis Node 22.
 * Chrome est localisé via CHROME_PATH ou les emplacements usuels.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { lancerServeur } from "./serve.mjs";

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

const OUT = arg("out", ".captures");
const PORT = Number(arg("port", "9222"));
const PORT_HTTP = Number(arg("http", "8130"));
/** Arguments supplémentaires pour Chrome : --chrome-arg=--disable-gpu-compositing */
const ARGS_CHROME = process.argv.filter((a) => a.startsWith("--chrome-arg=")).map((a) => a.slice(13));
/** Diagnostic : --screens=7-9 ne capture que ces écrans des pages de reportage. */
const ECRANS = arg("screens", "").match(/^(\d+)-(\d+)$/)?.slice(1).map(Number) ?? null;
const BORNE = Number(arg("timeout", "10000"));
/** Reprises autorisées par page et par appareil, après blocage. */
const REPRISES = 2;

/** Sous-chemin de publication émulé, comme dans tools/check.mjs. */
const SOUS_CHEMIN = "/ange-kevin-photographie";

const BASE_EXTERNE = arg("base", "");

const TOUTES_LES_PAGES = [
  "index.html", "portfolio.html", "evenements.html", "a-propos.html", "contact.html", "404.html",
  "reportages/florent.html",
];
const PAGES = arg("pages", "") ? arg("pages", "").split(",") : TOUTES_LES_PAGES;

/** Appareils de référence, alignés sur les largeurs auditées. */
const TOUS_LES_APPAREILS = [
  { id: "mobile", width: 390, height: 844, scale: 2, mobile: true },
  { id: "tablette", width: 768, height: 1024, scale: 2, mobile: true },
  { id: "desktop", width: 1440, height: 900, scale: 1, mobile: false },
];
const FILTRE_APPAREILS = arg("devices", "") ? arg("devices", "").split(",") : null;
const DEVICES = FILTRE_APPAREILS
  ? TOUS_LES_APPAREILS.filter((d) => FILTRE_APPAREILS.includes(d.id))
  : TOUS_LES_APPAREILS;

if (DEVICES.length === 0) {
  console.error(`Aucun appareil reconnu dans --devices (${TOUS_LES_APPAREILS.map((d) => d.id).join(", ")}).`);
  process.exit(2);
}

// Blocage simulé : « --inject-stall=3 » ou « --inject-stall=3,persist ».
const [stallN, stallMode] = arg("inject-stall", "").split(",");
const BLOCAGE_SIMULE = stallN ? { n: Number(stallN), persistant: stallMode === "persist" } : null;
let appelsCapture = 0;
let blocageDejaInjecte = false;

const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));

if (!CHROME) {
  console.error("Chrome introuvable. Définir CHROME_PATH.");
  process.exit(2);
}

/** Dépassement d'une commande bornée : la cible est à remplacer. */
class DelaiDepasse extends Error {}

/** Borne une promesse ; le minuteur est toujours libéré. */
function borner(promesse, ms, quoi) {
  let minuteur;
  const delai = new Promise((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new DelaiDepasse(`${quoi} : aucune réponse en ${ms} ms`)), ms);
  });
  return Promise.race([promesse, delai]).finally(() => clearTimeout(minuteur));
}

/** Client minimal du protocole DevTools. */
class Devtools {
  #socket;
  #nextId = 0;
  #pending = new Map();
  handlers = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== undefined) {
        const slot = this.#pending.get(message.id);
        if (!slot) return;
        this.#pending.delete(message.id);
        message.error ? slot.reject(new Error(message.error.message)) : slot.resolve(message.result);
        return;
      }
      this.handlers.get(message.method)?.slice().forEach((fn) => fn(message.params));
    });
    socket.addEventListener("close", () => {
      for (const slot of this.#pending.values()) slot.reject(new Error("connexion DevTools fermée"));
      this.#pending.clear();
    });
  }

  /** Commande bornée : un dépassement lève DelaiDepasse, jamais un silence. */
  send(method, params = {}, ms = BORNE) {
    const id = ++this.#nextId;
    const reponse = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
    return borner(reponse, ms, method).catch((erreur) => {
      this.#pending.delete(id);
      throw erreur;
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }

  /** Attend une occurrence de l'événement, avec délai ; l'écouteur est retiré. */
  attendre(method, ms, quoi) {
    return borner(new Promise((resolve) => {
      const liste = this.handlers.get(method) ?? [];
      const fn = (params) => {
        this.handlers.set(method, (this.handlers.get(method) ?? []).filter((f) => f !== fn));
        resolve(params);
      };
      liste.push(fn);
      this.handlers.set(method, liste);
    }), ms, quoi);
  }

  close() {
    try { this.#socket.close(); } catch { /* déjà fermé */ }
  }
}

/** Un navigateur jetable : lancé, utilisé, puis tué avec ses processus fils. */
class Navigateur {
  #processus = null;
  #profil = null;
  cdp = null;
  /** Numéro de lancement, pour un profil neuf à chaque fois. */
  static compteur = 0;

  async demarrer(surProbleme, courante) {
    this.#profil = resolve(OUT, `chrome-profile-${++Navigateur.compteur}`);
    this.#processus = spawn(CHROME, [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      "--hide-scrollbars",
      // Une page jamais au premier plan peut cesser de produire des images :
      // les captures d'écran en dépendent.
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      ...ARGS_CHROME,
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${this.#profil}`,
      "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    this.#processus.stderr.on("data", (d) => process.env.CAPTURE_DEBUG && process.stderr.write(d));
    this.#processus.on("error", (e) => console.error("lancement de Chrome impossible :", e.message));

    const wsBrowser = await this.#attendreEndpoint();
    void wsBrowser;
    const cibles = await borner(fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json()), BORNE, "liste des cibles");
    const page = cibles.find((t) => t.type === "page");
    if (!page) throw new Error("Chrome n'a ouvert aucune page.");
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await borner(new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("connexion DevTools impossible")), { once: true });
    }), BORNE, "connexion DevTools");

    this.cdp = new Devtools(socket);
    this.cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (type !== "error" && type !== "warning") return;
      surProbleme(`${courante()} — console.${type} : ${args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`);
    });
    this.cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
      surProbleme(`${courante()} — exception : ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    });
    this.cdp.on("Log.entryAdded", ({ entry }) => {
      if (entry.level === "error") surProbleme(`${courante()} — ${entry.source} : ${entry.text}`);
    });
    await this.cdp.send("Page.enable");
    await this.cdp.send("Runtime.enable");
    await this.cdp.send("Log.enable");
    await this.cdp.send("Page.bringToFront");
  }

  async #attendreEndpoint() {
    for (let essai = 0; essai < 60; essai++) {
      try {
        const reponse = await borner(fetch(`http://127.0.0.1:${PORT}/json/version`), 2000, "json/version");
        if (reponse.ok) return (await reponse.json()).webSocketDebuggerUrl;
      } catch {
        /* le navigateur n'écoute pas encore */
      }
      await sleep(250);
    }
    throw new Error("Chrome n'a pas ouvert le port de débogage.");
  }

  /** Tue l'arbre de processus : « kill() » seul laisse les fils sous Windows. */
  async arreter() {
    this.cdp?.close();
    this.cdp = null;
    const pid = this.#processus?.pid;
    if (pid) {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
      else this.#processus.kill("SIGKILL");
    }
    this.#processus = null;
    // Le profil peut rester verrouillé un instant : suppression au mieux.
    if (this.#profil) await sleep(300).then(() => rm(this.#profil, { recursive: true, force: true })).catch(() => {});
    this.#profil = null;
  }
}

// --- Exécution ----------------------------------------------------------------

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const serveur = BASE_EXTERNE
  ? null
  : (await lancerServeur({ port: PORT_HTTP, prefix: SOUS_CHEMIN })).serveur;
const BASE = BASE_EXTERNE || `http://127.0.0.1:${PORT_HTTP}${SOUS_CHEMIN}`;

const problems = [];
let courante = "";
const navigateur = new Navigateur();

/** Bilan par page et par appareil : capturées / attendues. */
const bilan = [];

/** Écrit une capture et vérifie qu'elle existe et n'est pas vide. */
async function ecrire(nom, donnees) {
  const chemin = join(OUT, nom);
  await writeFile(chemin, Buffer.from(donnees, "base64"));
  return (await stat(chemin)).size > 0;
}

/** Capture d'écran bornée, avec le blocage simulé du diagnostic. */
async function capturerEcran(cdp, params) {
  appelsCapture++;
  const bloquer = BLOCAGE_SIMULE && appelsCapture === BLOCAGE_SIMULE.n
    || BLOCAGE_SIMULE?.persistant && appelsCapture >= BLOCAGE_SIMULE.n;
  if (bloquer && (BLOCAGE_SIMULE.persistant || !blocageDejaInjecte)) {
    blocageDejaInjecte = true;
    return borner(new Promise(() => {}), BORNE, "Page.captureScreenshot (blocage simulé)");
  }
  return cdp.send("Page.captureScreenshot", params);
}

/** Un dépassement de délai ou une connexion perdue : la cible est à remplacer. */
const estBlocage = (erreur) => erreur instanceof DelaiDepasse || /connexion DevTools/.test(erreur.message);

/** Remplace le navigateur : tué avec ses fils, relancé avec un profil neuf. */
async function relancer() {
  await navigateur.arreter();
  await navigateur.demarrer((p) => problems.push(p), () => courante);
}

/**
 * Charge la page à la taille de l'appareil, parcourt le document pour
 * déclencher les révélations, puis revient en haut. Renvoie ses dimensions.
 * Lève DelaiDepasse si Chrome ne répond plus.
 */
async function preparerPage(device, file, signaler) {
  const cdp = navigateur.cdp;
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: device.width, height: device.height, deviceScaleFactor: device.scale, mobile: device.mobile,
  });

  const charge = cdp.attendre("Page.loadEventFired", 20000, `chargement de ${file}`);
  await cdp.send("Page.navigate", { url: `${BASE}/${file}` });
  await charge;
  await sleep(600); // séquence d'entrée

  // Sans ce parcours, une capture montrerait les photographies encore masquées.
  await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    expression: `(async () => {
      // Le défilement doux du site empêcherait d'atteindre réellement
      // chaque position : on le neutralise le temps du parcours.
      const root = document.documentElement;
      const previous = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      const step = window.innerHeight * 0.8;
      for (let y = 0; y < root.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 140));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 300));
      root.style.scrollBehavior = previous;
    })()`,
  }, 60000);

  const metrics = await cdp.send("Page.getLayoutMetrics");
  const { clientWidth } = metrics.cssLayoutViewport;
  const contentWidth = Math.round(metrics.contentSize.width);
  if (signaler && contentWidth > clientWidth + 1) {
    problems.push(`${courante} — débordement horizontal : ${contentWidth}px > ${clientWidth}px`);
  }

  const { result } = await cdp.send("Runtime.evaluate", {
    expression: `(document.documentElement.style.scrollBehavior = "auto",
      [Boolean(document.querySelector(".story")), document.documentElement.scrollHeight, innerHeight])`,
    returnByValue: true,
  });
  const [parEcran, hauteur, fenetre] = result.value;
  return { parEcran, hauteur, fenetre };
}

/**
 * Capture une page pour un appareil, en notant dans « entree » ce qui est
 * réellement écrit. Les pages de reportage bornent la hauteur des images à une
 * fraction de la fenêtre (unités svh) : une capture « pleine page » agrandit la
 * fenêtre à la hauteur du document, les images grandissent avec elle, la page
 * s'allonge d'autant, et Chrome ne termine jamais. Elles sont donc capturées
 * écran par écran, telles qu'un visiteur les voit.
 *
 * Un écran qui bloque Chrome n'emporte pas les suivants : le navigateur est
 * remplacé, l'écran retenté, et s'il résiste il est compté manquant avant de
 * passer au suivant.
 */
async function capturerPage(device, file, entree) {
  const base = file.replace(/\.html$/, "").replaceAll("/", "-");
  const { parEcran, hauteur, fenetre } = await preparerPage(device, file, true);

  if (!parEcran) {
    entree.attendues = 1;
    const { data } = await capturerEcran(navigateur.cdp, { format: "png", captureBeyondViewport: true });
    const nom = `${base}-${device.id}.png`;
    if (await ecrire(nom, data)) entree.noms.add(nom);
    else problems.push(`${courante} — ${nom} : fichier vide`);
    return;
  }

  const ecrans = Math.ceil(hauteur / fenetre);
  const [premier, dernier] = ECRANS ?? [1, ecrans];
  const derniere = Math.min(dernier, ecrans);
  entree.attendues = derniere - premier + 1;
  for (let s = premier - 1; s < derniere; s++) {
    const nom = `${base}-${device.id}-${String(s + 1).padStart(2, "0")}.png`;
    for (let tentative = 0; ; tentative++) {
      try {
        await navigateur.cdp.send("Runtime.evaluate", { expression: `scrollTo({ top: ${s * fenetre}, behavior: "instant" })` });
        await sleep(350);
        const capture = await capturerEcran(navigateur.cdp, { format: "png" });
        if (await ecrire(nom, capture.data)) entree.noms.add(nom);
        else problems.push(`${courante} — ${nom} : fichier vide`);
        break;
      } catch (erreur) {
        if (!estBlocage(erreur)) throw erreur;
        if (tentative >= REPRISES) {
          problems.push(`${courante} — écran ${s + 1} manquant : ${erreur.message} ; abandon après ${tentative + 1} tentative(s)`);
          // Le navigateur est sain pour la suite : l'écran suivant repart d'une cible neuve.
          await relancer();
          await preparerPage(device, file, false);
          break;
        }
        entree.reprises++;
        console.log(`  ${courante} écran ${s + 1} : ${erreur.message} — navigateur relancé, reprise de l'écran`);
        await relancer();
        await preparerPage(device, file, false);
      }
    }
  }
}

try {
  await navigateur.demarrer((p) => problems.push(p), () => courante);

  for (const device of DEVICES) {
    for (const file of PAGES) {
      courante = `${file} @${device.width}px`;
      // « attendues » reste à null tant que le nombre d'écrans est inconnu :
      // une page qui n'a jamais été chargée compte comme incomplète.
      const entree = { page: file, appareil: device.id, attendues: null, noms: new Set(), reprises: 0 };
      bilan.push(entree);

      for (let tentative = 0; ; tentative++) {
        try {
          await capturerPage(device, file, entree);
          break;
        } catch (erreur) {
          if (!estBlocage(erreur)) {
            problems.push(`${courante} — ${erreur.message}`);
            break;
          }
          if (tentative >= REPRISES) {
            problems.push(`${courante} — ${erreur.message} ; abandon après ${tentative + 1} tentative(s)`);
            await relancer().catch(() => {});
            break;
          }
          entree.reprises++;
          console.log(`  ${courante} : ${erreur.message} — navigateur relancé, reprise de la page`);
          await relancer();
        }
      }

      const produites = entree.noms.size;
      const complet = entree.attendues !== null && produites === entree.attendues;
      console.log(`  ${complet ? "ok " : "MANQUE"} ${file} @${device.id} : ${produites}/${entree.attendues ?? "?"} capture(s)${entree.reprises ? ` (${entree.reprises} reprise(s))` : ""}`);
    }
  }
} catch (erreur) {
  problems.push(`arrêt anticipé : ${erreur.message}`);
} finally {
  await navigateur.arreter();
  serveur?.close();
}

// --- Bilan --------------------------------------------------------------------

const attendues = bilan.reduce((n, e) => n + (e.attendues ?? 1), 0);
const produites = bilan.reduce((n, e) => n + e.noms.size, 0);
const lignesTotales = DEVICES.length * PAGES.length;
// Incomplet : un arrêt anticipé laisse des pages jamais traitées.
const incomplet = bilan.length < lignesTotales
  || bilan.some((e) => e.attendues === null || e.noms.size !== e.attendues);

console.log(`\n${produites}/${attendues} capture(s) produite(s) pour ${bilan.length}/${lignesTotales} combinaison(s) page × appareil.`);
if (problems.length) console.log(`${problems.length} anomalie(s) :\n- ${problems.join("\n- ")}`);
else console.log("Aucune erreur console, aucun débordement.");

if (incomplet) {
  console.error("\nRÉSULTAT INCOMPLET : des captures n'ont pas été produites. Ne pas le tenir pour une réussite.");
  process.exit(2);
}
process.exit(problems.length ? 1 : 0);
