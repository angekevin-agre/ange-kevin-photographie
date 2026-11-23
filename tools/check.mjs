/**
 * Vérifications fonctionnelles et d'accessibilité, exécutées dans Chrome.
 *
 *   node tools/check.mjs
 *
 * Le serveur de test est lancé par ce script : « tools/serve.mjs », configuré
 * avec le sous-chemin de publication de GitHub Pages et le renvoi de 404.html
 * pour toute URL inexistante. Vérifier à la racine d'un serveur ordinaire
 * masquerait précisément les chemins qui cassent en production.
 *
 * Avec « --base=<url> », un serveur déjà lancé est utilisé à la place.
 *
 * Couvre ce qu'une relecture de code ne peut pas établir : le menu mobile
 * s'ouvre et se ferme réellement, le focus est restitué, le lien d'évitement
 * devient visible, les photographies restent accessibles quand les animations
 * sont désactivées, le contenu et la navigation survivent à l'absence de
 * JavaScript comme au blocage des modules, la page 404 fonctionne sous une URL
 * imbriquée, et les albums résistent à des données invalides.
 *
 * Sortie : une ligne par vérification, code de sortie 1 si l'une échoue.
 * Aucune dépendance (WebSocket et fetch natifs, Node 22+).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { lancerServeur } from "./serve.mjs";
import {
  DOSSIER_IMAGES, cheminManifeste, mentionneDossierExclu, ordrePhotos, validerManifeste, validerReportage,
} from "./reportages-lib.mjs";

const PORT = 9333;       // protocole DevTools
const PORT_HTTP = 8129;  // serveur statique lancé par ce script

/**
 * Sous-chemin de publication émulé. GitHub Pages sert un site de projet sous
 * « /<dépôt>/ » : c'est sous ce préfixe que les chemins relatifs doivent être
 * vérifiés, en particulier ceux de la page 404.
 */
const SOUS_CHEMIN = "/ange-kevin-photographie";

const BASE_EXTERNE = process.argv.find((a) => a.startsWith("--base="))?.slice(7);
const BASE = BASE_EXTERNE ?? `http://127.0.0.1:${PORT_HTTP}${SOUS_CHEMIN}`;

/** Page de reportage de référence, générée par tools/build-reportages.mjs. */
const REPORTAGE = "reportages/florent.html";

const PAGES = ["index.html", "portfolio.html", "evenements.html", "a-propos.html", "contact.html", "404.html", REPORTAGE];

/** Largeurs de référence du cahier des charges, du petit mobile au grand écran. */
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440, 1920];

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
  process.exit(1);
}

const results = [];
const record = (name, passed, detail = "") =>
  results.push({ name, passed, detail });

class Devtools {
  #socket;
  #nextId = 0;
  #pending = new Map();
  #handlers = new Map();

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
      this.#handlers.get(message.method)?.forEach((fn) => fn(message.params));
    });
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.#handlers.has(method)) this.#handlers.set(method, []);
    this.#handlers.get(method).push(fn);
  }

  /** Évalue une expression et renvoie sa valeur JSON. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }
}

// --- 0. Syntaxe des feuilles de style, avant même d'ouvrir un navigateur ---
// Un commentaire mal fermé fait silencieusement sauter la règle qui suit :
// le navigateur ne signale rien, la page s'affiche simplement de travers.
{
  const anomalies = [];
  for (const nom of ["tokens.css", "base.css", "site.css"]) {
    const source = await readFile(join("assets", "css", nom), "utf8");
    const horsCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, "");
    if (horsCommentaires.includes("/*") || horsCommentaires.includes("*/")) {
      anomalies.push(`${nom} : commentaire non fermé ou fragment orphelin`);
    }
    const horsChaines = horsCommentaires.replace(/"[^"]*"|'[^']*'/g, "");
    const ouvrantes = (horsChaines.match(/{/g) ?? []).length;
    const fermantes = (horsChaines.match(/}/g) ?? []).length;
    if (ouvrantes !== fermantes) {
      anomalies.push(`${nom} : ${ouvrantes} accolades ouvrantes pour ${fermantes} fermantes`);
    }
  }
  record("CSS — commentaires fermés et accolades équilibrées",
    anomalies.length === 0, anomalies.join(" ; "));
}

// --- 0 bis. Reportages : données, pages générées, images -----------------
// Vérifié sans navigateur : ces contrôles portent sur les fichiers.
const executerNode = (script, args) => new Promise((resoudre) => {
  const proc = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  let sortie = "";
  proc.stdout.on("data", (d) => (sortie += d));
  proc.stderr.on("data", (d) => (sortie += d));
  proc.once("exit", (code) => resoudre({ code, sortie }));
});
{
  const florent = JSON.parse(await readFile(join("content", "reportages", "florent.json"), "utf8"));

  record("Reportages — les données de Florent sont valides",
    validerReportage(florent, "florent.json").length === 0,
    validerReportage(florent, "florent.json").join(" ; "));

  const ordre = ordrePhotos(florent);
  record("Reportages — Florent : 25 photographies, chacune affichée une fois, couverture comprise",
    florent.photos.length === 25 && ordre.length === 25 && new Set(ordre).size === 25,
    `${florent.photos.length} déclarées, ${ordre.length} affichées, ${new Set(ordre).size} distinctes`);

  // Le validateur doit refuser chaque défaut, avec un message qui le nomme.
  const muter = (modifier) => { const copie = structuredClone(florent); modifier(copie); return validerReportage(copie, "essai"); };
  const CAS_INVALIDES = [
    ["texte alternatif manquant", (r) => { delete r.photos[3].alt; }, /alt/],
    ["photographie affichée deux fois", (r) => { r.chapters[0].frames[1].photos = ["dsc-0009"]; }, /utilisée 2 fois/],
    ["photographie déclarée mais jamais affichée", (r) => { r.chapters[5].frames.pop(); }, /jamais affichée/],
    ["identifiant inconnu dans un plan", (r) => { r.chapters[0].frames[0].photos = ["dsc-9999"]; }, /inconnue/],
    ["fichier pris dans le dossier FAMILLE", (r) => { r.photos[0].file = "FAMILLE/DSC_0148.jpg"; }, /sans dossier/],
    ["chemin remontant d'un dossier", (r) => { r.photos[0].file = "../DSC_0148.jpg"; }, /sans dossier/],
    ["diptyque à une seule image", (r) => { r.chapters[1].frames[0].photos.pop(); }, /attend 2/],
    ["composition inconnue", (r) => { r.chapters[0].frames[0].layout = "mosaique"; }, /layout/],
    ["catégorie inconnue", (r) => { r.category = "divers"; }, /category/],
    ["description trop longue pour le référencement", (r) => { r.description = "x".repeat(200); }, /description/],
  ];
  const nonDetectes = CAS_INVALIDES
    .filter(([, modifier, attendu]) => !muter(modifier).some((m) => attendu.test(m)))
    .map(([nom]) => nom);
  record(`Reportages — le validateur refuse les données invalides (${CAS_INVALIDES.length} cas)`,
    nonDetectes.length === 0, nonDetectes.join(" ; "));

  record("Reportages — les dossiers FAMILLE et INDIVIDUEL sont reconnus, quelle que soit la casse",
    mentionneDossierExclu("E:/PHOTO/FAMILLE") && mentionneDossierExclu("F:\\x\\Individuel\\")
      && !mentionneDossierExclu("D:/Photos/FINALE FLORENT 7 DECEMBRE/ANOTHER"));

  // optimize-photos.mjs doit refuser un dossier source exclu, avant toute lecture.
  const refus = await executerNode(join("tools", "optimize-photos.mjs"),
    ["florent", "--source=E:/PHOTO/FAMILLE", "--dry-run"]);
  record("Reportages — l'optimisation refuse un dossier source FAMILLE",
    refus.code === 1 && refus.sortie.includes("FAMILLE"), `code ${refus.code}`);

  // Les pages générées doivent correspondre aux données.
  const generation = await executerNode(join("tools", "build-reportages.mjs"), ["--check"]);
  record("Reportages — pages générées à jour (build-reportages.mjs --check)",
    generation.code === 0, generation.sortie.trim());

  // Sécurité et non-régression des outils : injections HTML, slug, fraîcheur
  // des images, SEO, intégrité de la feuille de style (sans navigateur).
  const securite = await executerNode(join("tools", "test-reportages.mjs"), []);
  record("Reportages — tests de sécurité et de non-régression (tools/test-reportages.mjs)",
    securite.code === 0,
    securite.sortie.split("\n").filter((l) => /^ECHEC/.test(l)).join(" | ").slice(0, 700) || `code ${securite.code}`);

  // Manifeste et fichiers optimisés.
  const manifeste = JSON.parse(await readFile(cheminManifeste("florent"), "utf8").catch(() => "null"));
  record("Reportages — manifeste des images cohérent avec les données",
    validerManifeste(florent, manifeste, "manifest.json").length === 0,
    validerManifeste(florent, manifeste, "manifest.json").join(" ; "));

  const defautsFichiers = [];
  const attendus = new Set(["manifest.json"]);
  for (const [id, entree] of Object.entries(manifeste?.photos ?? {})) {
    const fichiers = [...entree.variants.map((v) => ({ ...v, format: "webp" }))];
    if (entree.og) fichiers.push({ ...entree.og, format: "jpg" });
    for (const v of fichiers) {
      attendus.add(v.file);
      const octets = await readFile(join(DOSSIER_IMAGES, "florent", v.file)).catch(() => null);
      if (!octets) { defautsFichiers.push(`${v.file} absent`); continue; }
      const signature = v.format === "webp"
        ? octets.subarray(0, 4).toString() === "RIFF" && octets.subarray(8, 12).toString() === "WEBP"
        : octets[0] === 0xff && octets[1] === 0xd8;
      if (!signature) defautsFichiers.push(`${v.file} : format inattendu`);
      // Aucun recadrage : chaque déclinaison garde le rapport de l'original.
      if (Math.abs(v.width / v.height - entree.width / entree.height) > 0.01) {
        defautsFichiers.push(`${v.file} : proportions modifiées`);
      }
      // Aucune métadonnée d'appareil ni de localisation publiée.
      if (/Exif|NIKON|GPS/.test(octets.subarray(0, 4096).toString("latin1"))) {
        defautsFichiers.push(`${v.file} : métadonnées EXIF présentes`);
      }
    }
    if (entree.variants.at(-1).width > 2400) defautsFichiers.push(`${id} : déclinaison de plus de 2400 px`);
  }
  const presents = await readdir(join(DOSSIER_IMAGES, "florent")).catch(() => []);
  for (const nom of presents) if (!attendus.has(nom)) defautsFichiers.push(`${nom} : fichier orphelin`);
  record("Reportages — images web présentes, au bon format, non recadrées, sans EXIF ni orphelin",
    defautsFichiers.length === 0, defautsFichiers.join(" ; "));

  const html = await readFile(REPORTAGE, "utf8");
  record("Reportages — aucun fichier original ni dossier exclu référencé par la page",
    !/DSC_\d+\.jpg|FAMILLE|INDIVIDUEL/i.test(html));
}

// --- 0 bis. Serveur statique, aux conditions de GitHub Pages --------------
const serveur = BASE_EXTERNE
  ? null
  : (await lancerServeur({ port: PORT_HTTP, prefix: SOUS_CHEMIN })).serveur;

// --- 0 ter. Robustesse face à une URL malformée ---------------------------
// Une séquence d'échappement invalide (« % » seul, sans les deux chiffres
// hexadécimaux attendus) faisait tomber decodeURIComponent, et « //[ » faisait
// tomber le constructeur URL — dans les deux cas, le serveur entier s'arrêtait.
// Ces tests échoueraient en se bloquant si l'une des régressions revenait.
//
// « //[ » doit être envoyée telle quelle, octet pour octet : fetch() ré-encode
// les caractères qu'elle juge invalides dans une ligne de requête, ce qui
// masquerait la régression visée. Une socket brute reproduit la requête HTTP
// exacte reçue par le serveur.
{
  const { hostname, port, pathname } = new URL(BASE);
  const PREFIXE_BRUT = pathname.replace(/\/$/, "");

  const requeteBrute = (cibleBrute) => new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname, () => {
      socket.write(`GET ${cibleBrute} HTTP/1.1\r\nHost: ${hostname}\r\nConnection: close\r\n\r\n`);
    });
    let donnees = "";
    socket.on("data", (morceau) => (donnees += morceau));
    socket.on("end", () => resolve(Number(donnees.match(/^HTTP\/1\.[01] (\d{3})/)?.[1])));
    socket.on("error", reject);
  });

  const CAS_MALFORMES = ["/%", "/%GG", "/%E0%A4%A", "//["];
  for (const cas of CAS_MALFORMES) {
    // Le constructeur URL échoue dès le début du traitement, avant toute
    // vérification du sous-chemin : « //[ » n'a donc pas à le porter.
    const cible = cas === "//[" ? cas : `${PREFIXE_BRUT}${cas}`;
    const statutMalforme = await requeteBrute(cible);
    record(`Serveur — une URL malformée (« ${cas} ») renvoie 400 plutôt que de faire tomber le serveur`,
      statutMalforme === 400, String(statutMalforme));

    const statutValide = await requeteBrute(`${PREFIXE_BRUT}/index.html`);
    record(`Serveur — une requête valide suivant « ${cas} » reste servie normalement`,
      statutValide === 200, String(statutValide));
  }
}

const profile = await mkdtemp(join(tmpdir(), "akp-check-"));
const browser = spawn(CHROME, [
  "--headless", "--disable-gpu", "--no-sandbox", "--disable-extensions",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let socket;
try {
  let endpoint;
  for (let i = 0; i < 60 && !endpoint; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (response.ok) endpoint = (await response.json()).find((t) => t.type === "page");
    } catch { /* pas encore prêt */ }
    if (!endpoint) await sleep(250);
  }
  if (!endpoint) throw new Error("Chrome n'a pas ouvert le port de débogage.");

  socket = new WebSocket(endpoint.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const cdp = new Devtools(socket);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  // Sans cela, la fenêtre headless n'a pas le focus document et :focus ne
  // correspond jamais — les vérifications clavier seraient faussées.
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp.send("Network.enable");

  // Erreurs JavaScript : relevées pendant toute l'exécution, sur toutes les
  // pages et à toutes les largeurs. Les scénarios dégradés volontaires
  // (modules bloqués, données invalides) ne doivent pas en produire non plus :
  // le code les traite sans lever d'exception.
  const erreursJs = [];
  let urlCourante = "";
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    erreursJs.push(`${urlCourante} : ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  });
  cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type === "error") erreursJs.push(`${urlCourante} : console.error ${args.map((a) => a.value ?? a.description).join(" ")}`);
  });

  const visitUrl = async (url, { width = 390, height = 844, mobile = true, reducedMotion = false, attente = 500 } = {}) => {
    urlCourante = url.replace(BASE, "");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile,
    });
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }],
    });
    const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
    await cdp.send("Page.navigate", { url });
    await loaded;
    await sleep(attente);
  };

  const visit = (file, options) => visitUrl(`${BASE}/${file}`, options);

  // --- 1. Menu mobile : ouverture, focus, Échap, restitution du focus ------
  await visit("index.html");

  record("Menu — le bouton est visible en mobile",
    await cdp.evaluate(`getComputedStyle(document.querySelector("[data-menu-open]")).display !== "none"`));

  await cdp.evaluate(`document.querySelector("[data-menu-open]").click()`);
  await sleep(350);
  record("Menu — s'ouvre au clic",
    await cdp.evaluate(`document.querySelector("[data-menu]").open === true`));
  record("Menu — le focus entre dans le dialogue",
    await cdp.evaluate(`document.querySelector("[data-menu]").contains(document.activeElement)`));
  record("Menu — l'arrière-plan ne défile plus",
    await cdp.evaluate(`getComputedStyle(document.documentElement).overflow === "hidden"`));

  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(500);
  record("Menu — se ferme avec Échap",
    await cdp.evaluate(`document.querySelector("[data-menu]").open === false`));
  record("Menu — le focus revient sur le bouton",
    await cdp.evaluate(`document.activeElement === document.querySelector("[data-menu-open]")`));

  // Fermeture après navigation vers une ancre interne.
  await cdp.evaluate(`document.querySelector("[data-menu-open]").click()`);
  await sleep(300);
  await cdp.evaluate(`document.querySelector("[data-menu] a[href]").click()`);
  await sleep(400);
  record("Menu — se ferme après un clic sur un lien",
    await cdp.evaluate(`document.querySelector("[data-menu]").open === false`));

  // --- 2. Lien d'évitement -------------------------------------------------
  await visit("index.html", { width: 1440, height: 900, mobile: false });
  record("Clavier — le lien d'évitement est le premier élément focusable",
    await cdp.evaluate(`
      (() => {
        const first = document.querySelector("a[href], button, [tabindex]:not([tabindex='-1'])");
        return first?.classList.contains("skip") === true;
      })()`));
  record("Clavier — le lien d'évitement devient visible au focus",
    await cdp.evaluate(`
      (async () => {
        const skip = document.querySelector(".skip");
        const avant = skip.getBoundingClientRect().top;
        skip.focus();
        await new Promise((r) => setTimeout(r, 400)); // laisser jouer la transition
        return avant < 0 && skip.getBoundingClientRect().top >= 0;
      })()`));
  record("Clavier — la cible du lien d'évitement existe",
    await cdp.evaluate(`!!document.getElementById(document.querySelector(".skip").hash.slice(1))`));

  // --- 3. Animations réduites : rien ne reste masqué -----------------------
  await visit("index.html", { width: 1440, height: 900, mobile: false, reducedMotion: true });
  const hidden = await cdp.evaluate(`
    [...document.querySelectorAll("[data-reveal], [data-intro]")]
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length`);
  record("Mouvement réduit — aucun contenu ne reste masqué", hidden === 0, `${hidden} élément(s)`);

  // Sans JavaScript, le contenu doit également rester visible et navigable.
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  await visit("index.html", { width: 390, height: 844 });
  const masqueSansJs = await cdp.evaluate(`
    [...document.querySelectorAll("[data-reveal], [data-intro]")]
      .filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length`);
  record("Sans JavaScript — le contenu reste visible", masqueSansJs === 0, `${masqueSansJs} élément(s)`);
  record("Sans JavaScript — la navigation reste atteignable en mobile",
    await cdp.evaluate(`getComputedStyle(document.querySelector(".nav")).display !== "none"`));

  // Rétablir la seule opacité ne suffit pas : « wipe » rogne l'image par
  // clip-path et la décale par transform. Sans JavaScript, aucune des deux
  // propriétés ne doit subsister, sinon couvertures et légendes sont amputées.
  const wipeSansJs = await cdp.evaluate(`
    (() => {
      const defauts = [];
      for (const el of document.querySelectorAll('[data-reveal="wipe"]')) {
        const style = getComputedStyle(el);
        const marque = el.tagName.toLowerCase() + "." + (el.getAttribute("class") || "");
        if (style.clipPath !== "none") defauts.push(marque + " clip-path:" + style.clipPath);
        if (style.transform !== "none") defauts.push(marque + " transform:" + style.transform);
        if (Number(style.opacity) < 0.99) defauts.push(marque + " opacity:" + style.opacity);
      }
      return { nombre: document.querySelectorAll('[data-reveal="wipe"]').length, defauts };
    })()`);
  record("Sans JavaScript — les vues en balayage ne sont ni rognées ni décalées",
    wipeSansJs.nombre > 0 && wipeSansJs.defauts.length === 0, wipeSansJs.defauts.join(" ; "));

  // Et l'image comme sa légende sont effectivement rendues en entier.
  const ampute = await cdp.evaluate(`
    (() => {
      const defauts = [];
      for (const vue of document.querySelectorAll('[data-reveal="wipe"]')) {
        const image = vue.querySelector("img");
        const legende = vue.querySelector(".plate__caption");
        const cadre = vue.querySelector(".plate__frame");
        if (image && cadre) {
          const i = image.getBoundingClientRect(), c = cadre.getBoundingClientRect();
          // Le cadre ne doit pas masquer le bas de l'image (voile de 24 %).
          if (i.height - c.height > 1) defauts.push("image rognée de " + Math.round(i.height - c.height) + "px");
        }
        if (legende) {
          const r = legende.getBoundingClientRect();
          if (r.height < 1 || Number(getComputedStyle(legende).opacity) < 0.99) defauts.push("légende masquée");
        }
      }
      return defauts;
    })()`);
  record("Sans JavaScript — images et légendes restent entièrement visibles",
    ampute.length === 0, ampute.join(" ; "));

  // Chevauchement entête / navigation sur les deux plus petites largeurs.
  const chevauchements = [];
  for (const width of [320, 390]) {
    await visit("index.html", { width, height: 844, attente: 300 });
    const defaut = await cdp.evaluate(`
      (() => {
        const nav = document.querySelector(".nav");
        if (getComputedStyle(nav).display === "none") return "navigation masquée";
        const marque = document.querySelector(".brand").getBoundingClientRect();
        const liens = [...document.querySelectorAll(".nav__list a")];
        const croises = liens.filter((a) => {
          const r = a.getBoundingClientRect();
          return r.width > 0 && r.left < marque.right - 0.5 && r.right > marque.left + 0.5
            && r.top < marque.bottom - 0.5 && r.bottom > marque.top + 0.5;
        });
        if (croises.length > 0) return croises.length + " lien(s) sous la marque";
        // Le premier lien doit aussi être réellement cliquable.
        const r = liens[0].getBoundingClientRect();
        const dessus = document.elementFromPoint(r.left + Math.min(4, r.width / 2), r.top + r.height / 2);
        return dessus && dessus.closest(".nav") ? "" : "premier lien recouvert";
      })()`);
    if (defaut) chevauchements.push(`${width}px : ${defaut}`);
  }
  record("Sans JavaScript — marque et liens ne se chevauchent pas (320 et 390 px)",
    chevauchements.length === 0, chevauchements.join(" ; "));

  // En repli, l'entête occupe deux lignes : le rail collant du portfolio et
  // les ancres de section doivent se décaler d'autant, sinon le rail passe
  // sous l'entête et les titres visés sont masqués à l'arrivée.
  await visit("portfolio.html", { width: 390, height: 844, attente: 400 });
  await cdp.evaluate(`
    (document.documentElement.style.scrollBehavior = "auto", window.scrollTo(0, 1500), 1)`);
  await sleep(300);
  const railRepli = await cdp.evaluate(`
    (() => {
      const entete = document.querySelector(".site-header").getBoundingClientRect();
      const rail = document.querySelector(".rail").getBoundingClientRect();
      const lien = document.querySelector(".rail a").getBoundingClientRect();
      const dessus = document.elementFromPoint(lien.left + lien.width / 2, lien.top + lien.height / 2);
      return {
        enteteBas: Math.round(entete.bottom),
        railHaut: Math.round(rail.top),
        recouvert: !(dessus && dessus.closest(".rail")),
      };
    })()`);
  // Tolérance de 3 px : le rail est volontairement remonté d'un pixel pour que
  // son filet supérieur se confonde avec le filet inférieur de l'entête.
  record("Sans JavaScript — le rail collant ne passe pas sous l'entête",
    railRepli.railHaut >= railRepli.enteteBas - 3 && !railRepli.recouvert,
    `entête jusqu'à ${railRepli.enteteBas}px, rail à ${railRepli.railHaut}px` +
      (railRepli.recouvert ? ", premier lien recouvert" : ""));

  await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });

  // --- 3 bis. Contrastes WCAG, réellement calculés -------------------------
  const mesurerContrastes = (cibles) => cdp.evaluate(`
    (() => {
      const canal = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const luminance = ([r, g, b]) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
      const lire = (valeur) => (valeur.match(/[\\d.]+/g) ?? []).map(Number);
      const fond = (el) => {
        for (let n = el; n; n = n.parentElement) {
          const c = lire(getComputedStyle(n).backgroundColor);
          if (c.length >= 3 && (c[3] === undefined || c[3] > 0.95)) return c.slice(0, 3);
        }
        return [0, 0, 0];
      };
      const cibles = ${JSON.stringify(cibles)};
      const releve = [];
      for (const selecteur of cibles) {
        const el = document.querySelector(selecteur);
        if (!el) continue;
        const couleur = lire(getComputedStyle(el).color);
        if (couleur[3] !== undefined && couleur[3] < 0.95) continue;
        const a = luminance(couleur), b = luminance(fond(el));
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        releve.push({ selecteur, ratio: Math.round(ratio * 10) / 10 });
      }
      return releve;
    })()`);
  const plusFaible = (releve) => releve.reduce((min, c) => (c.ratio < min.ratio ? c : min), { ratio: 99, selecteur: "—" });

  await visit("index.html", { width: 1440, height: 900, mobile: false });
  const pire = plusFaible(await mesurerContrastes([".lead", ".eyebrow", ".plate__caption", ".nav__list a",
    ".section__note", ".site-footer__legal p", ".link", ".prose p", ".pending", ".strip__hint"]));
  record(`Contraste — texte courant ≥ 4,5:1 (minimum relevé ${pire.ratio}:1 sur ${pire.selecteur})`,
    pire.ratio >= 4.5);

  await visit(REPORTAGE, { width: 1440, height: 900, mobile: false });
  const pireReportage = plusFaible(await mesurerContrastes([".story-crumb", ".story-meta dt", ".story-meta dd",
    ".story-hero__subtitle", ".story-intro__text p", ".story-chapter__text", ".story-note", ".plate__ref",
    ".plate__caption b", ".rail a", ".rail__num", ".eyebrow", ".link"]));
  record(`Contraste — reportage ≥ 4,5:1 (minimum relevé ${pireReportage.ratio}:1 sur ${pireReportage.selecteur})`,
    pireReportage.ratio >= 4.5);

  // --- 4. Révélation au défilement ----------------------------------------
  await visit("index.html", { width: 1440, height: 900, mobile: false });
  const revealed = await cdp.evaluate(`
    (async () => {
      const root = document.documentElement;
      root.style.scrollBehavior = "auto";
      for (let y = 0; y < root.scrollHeight; y += window.innerHeight * 0.8) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 140));
      }
      await new Promise((r) => setTimeout(r, 400));
      return [...document.querySelectorAll("[data-reveal]")]
        .filter((el) => !el.classList.contains("is-revealed"))
        .map((el) => el.tagName.toLowerCase() + "." + (el.getAttribute("class") || "").split(" ").join("."));
    })()`);
  record("Défilement — toutes les photographies sont révélées", revealed.length === 0, revealed.join(", "));

  // --- 5. Rail de catégories ----------------------------------------------
  await visit("portfolio.html", { width: 1440, height: 900, mobile: false });
  const railActive = await cdp.evaluate(`
    (async () => {
      const root = document.documentElement;
      root.style.scrollBehavior = "auto";
      const target = document.getElementById("ceremonies");
      window.scrollTo(0, target.offsetTop + 10);
      await new Promise((r) => setTimeout(r, 600));
      const active = document.querySelector("[data-rail] a[aria-current]");
      return active ? active.getAttribute("href") : null;
    })()`);
  record("Portfolio — le rail suit la section lue", railActive === "#ceremonies", String(railActive));

  // La carte du reportage : un seul lien annoncé, mais toute la carte cliquable.
  const carteRep = await cdp.evaluate(`
    (async () => {
      const carte = document.querySelector(".reportage-card");
      if (!carte) return { absente: true };
      carte.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 600));
      const r = carte.querySelector("img").getBoundingClientRect();
      const dessus = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { href: dessus?.closest("a")?.getAttribute("href") ?? null, liens: carte.querySelectorAll("a[href]").length };
    })()`);
  record("Portfolio — la carte du reportage est cliquable en entier, avec un seul lien",
    carteRep.href === REPORTAGE && carteRep.liens === 1, JSON.stringify(carteRep));

  // --- 5 bis. Reportage : chargement, lecture, sommaire --------------------
  await visit(REPORTAGE, { width: 1440, height: 900, mobile: false, attente: 600 });
  const chargementRep = await cdp.evaluate(`
    (() => {
      const images = [...document.querySelectorAll("main img")];
      const couverture = document.querySelector(".story-hero img");
      return {
        nombre: images.length,
        couverturePrioritaire: couverture?.getAttribute("fetchpriority") === "high" && !couverture.hasAttribute("loading"),
        nonDifferees: images.filter((i) => i !== couverture && i.getAttribute("loading") !== "lazy").length,
        sansSrcset: images.filter((i) => !i.getAttribute("srcset") || !i.getAttribute("sizes")).length,
        sansAlt: images.filter((i) => !(i.getAttribute("alt") ?? "").trim()).length,
        chapitres: document.querySelectorAll(".story-chapter").length,
        liensSommaire: document.querySelectorAll("[data-rail] a[href^='#']").length,
      };
    })()`);
  record("Reportage — 25 photographies : couverture prioritaire, toutes les autres en chargement différé",
    chargementRep.nombre === 25 && chargementRep.couverturePrioritaire && chargementRep.nonDifferees === 0,
    JSON.stringify(chargementRep));
  record("Reportage — chaque photographie a srcset, sizes et un texte alternatif",
    chargementRep.sansSrcset === 0 && chargementRep.sansAlt === 0, JSON.stringify(chargementRep));
  record("Reportage — le sommaire couvre l'introduction et chaque chapitre",
    chargementRep.chapitres === 6 && chargementRep.liensSommaire === 7, JSON.stringify(chargementRep));

  // Parcours complet : tout est révélé, chargé, jamais rogné ni déformé, et
  // aucune image ne dépasse la hauteur de la fenêtre. Mesures de mise en page
  // (offsetWidth / offsetHeight) : insensibles aux transformations de révélation.
  const PARCOURS_REPORTAGE = `
    (async () => {
      const root = document.documentElement;
      root.style.scrollBehavior = "auto";
      for (let y = 0; y < root.scrollHeight; y += innerHeight * 0.6) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 160));
      }
      await new Promise((r) => setTimeout(r, 600));
      await Promise.all([...document.images].map((i) => i.complete ? 0
        : new Promise((r) => { i.addEventListener("load", r); i.addEventListener("error", r); })));
      const defauts = [];
      for (const fig of document.querySelectorAll(".story-photo")) {
        const img = fig.querySelector("img"), cadre = fig.querySelector(".plate__frame");
        const nom = img.currentSrc.split("/").pop();
        if (img.offsetHeight - cadre.clientHeight > 1 || Math.abs(img.offsetWidth - cadre.clientWidth) > 1) defauts.push(nom + " rognée");
        if (Math.abs(img.offsetWidth / img.offsetHeight - img.naturalWidth / img.naturalHeight) > 0.02) defauts.push(nom + " déformée");
        if (img.offsetHeight > innerHeight * 0.92 + 1) defauts.push(nom + " plus haute que la fenêtre (" + img.offsetHeight + "px)");
      }
      return {
        nonRevelees: [...document.querySelectorAll("[data-reveal]")].filter((e) => !e.classList.contains("is-revealed")).length,
        nonChargees: [...document.images].filter((i) => !(i.complete && i.naturalWidth > 0)).map((i) => i.src.split("/").pop()),
        defauts,
      };
    })()`;
  for (const [width, height, mobile] of [[390, 844, true], [1440, 900, false], [1024, 640, false]]) {
    await visit(REPORTAGE, { width, height, mobile, attente: 400 });
    const p = await cdp.evaluate(PARCOURS_REPORTAGE);
    record(`Reportage @${width}×${height} — tout est révélé et chargé après lecture`,
      p.nonRevelees === 0 && p.nonChargees.length === 0,
      `${p.nonRevelees} non révélé(s) ; non chargées : ${p.nonChargees.join(", ")}`);
    record(`Reportage @${width}×${height} — aucune image rognée, déformée ou plus haute que la fenêtre`,
      p.defauts.length === 0, p.defauts.join(" ; "));
  }

  // Le sommaire suit la lecture.
  await visit(REPORTAGE, { width: 1440, height: 900, mobile: false });
  const chapitreActif = await cdp.evaluate(`
    (async () => {
      document.documentElement.style.scrollBehavior = "auto";
      const cible = document.getElementById("chapitre-les-voix");
      scrollTo(0, cible.getBoundingClientRect().top + scrollY + 40);
      await new Promise((r) => setTimeout(r, 700));
      return document.querySelector("[data-rail] a[aria-current]")?.getAttribute("href") ?? null;
    })()`);
  record("Reportage — le sommaire suit le chapitre lu", chapitreActif === "#chapitre-les-voix", String(chapitreActif));

  // Le mouvement doit être réellement perceptible : à l'entrée d'un chapitre,
  // le titre est observé en cours de transition (ni masqué, ni déjà achevé),
  // puis entièrement visible. Un test « tout est révélé à la fin » ne prouve
  // pas qu'un visiteur voit quoi que ce soit bouger.
  await visit(REPORTAGE, { width: 1440, height: 900, mobile: false });
  const mouvement = await cdp.evaluate(`
    (async () => {
      document.documentElement.style.scrollBehavior = "auto";
      const titre = document.getElementById("t-chapitre-les-tenues");
      scrollTo(0, titre.getBoundingClientRect().top + scrollY - innerHeight * 0.55);
      const lire = () => ({ o: Number(getComputedStyle(titre).opacity), t: getComputedStyle(titre).transform });
      await new Promise((r) => setTimeout(r, 250));
      const milieu = lire();
      await new Promise((r) => setTimeout(r, 1500));
      const fin = lire();
      const section = document.getElementById("chapitre-les-tenues");
      return { milieu, fin, courant: section.hasAttribute("data-current") };
    })()`);
  record("Reportage — l'entrée d'un chapitre s'anime de façon perceptible, puis tout est visible",
    mouvement.milieu.o > 0.02 && mouvement.milieu.o < 0.98 && mouvement.milieu.t !== "none" && mouvement.fin.o === 1 && mouvement.fin.t === "none" && mouvement.courant,
    JSON.stringify(mouvement));

  // Intégrité visuelle : une photographie reste entière et fidèle au fichier
  // optimisé à chaque instant — animation d'entrée, révélation au défilement,
  // survol. Ni filtre, ni transformation, ni rognage sur l'image ; le cadre et
  // la figure ne rognent pas non plus (clip-path, filtre). Seuls des fondus et
  // glissements de conteneur sont admis, et ils ne changent pas la taille.
  const VERIFIER_IMAGE = `
    const defauts = [];
    const verifier = (img, quand) => {
      const nom = img.currentSrc.split("/").pop() || img.getAttribute("src");
      const lot = [["image", img], ["cadre", img.closest(".plate__frame")], ["figure", img.closest(".plate")]];
      for (const [role, el] of lot) {
        if (!el) continue;
        const s = getComputedStyle(el);
        if (s.filter !== "none") defauts.push(quand + " : " + nom + " — filtre sur " + role + " (" + s.filter + ")");
        if (s.clipPath !== "none") defauts.push(quand + " : " + nom + " — rognage sur " + role + " (" + s.clipPath + ")");
        if (role === "image" && s.transform !== "none") defauts.push(quand + " : " + nom + " — transformation de l'image (" + s.transform + ")");
        if (role === "image" && (s.objectFit !== "fill" || s.objectPosition !== "50% 50%")) defauts.push(quand + " : " + nom + " — object-fit " + s.objectFit);
      }
      const cadre = img.closest(".plate__frame");
      if (cadre && (img.offsetHeight - cadre.clientHeight > 1 || Math.abs(img.offsetWidth - cadre.clientWidth) > 1)) {
        defauts.push(quand + " : " + nom + " — image rognée par son cadre");
      }
    };`;

  await visit(REPORTAGE, { width: 1440, height: 900, mobile: false, attente: 1500 });
  const integriteAnimation = await cdp.evaluate(`
    (async () => {
      ${VERIFIER_IMAGE}
      const cadre = document.querySelector(".story-hero__plate .plate__frame");
      const img = cadre.querySelector("img");
      const animations = cadre.getAnimations();
      if (animations.length === 0) defauts.push("aucune animation d'entrée sur la couverture : test sans objet");
      const largeur = img.getBoundingClientRect().width;
      for (const animation of animations) {
        animation.pause();
        const duree = animation.effect.getComputedTiming().duration;
        for (const t of [0, duree * 0.25, duree * 0.5, duree * 0.75, duree]) {
          animation.currentTime = t;
          verifier(img, "entrée de la couverture à " + Math.round(t) + " ms");
          if (Math.abs(img.getBoundingClientRect().width - largeur) > 0.5) defauts.push("la couverture change de taille à " + Math.round(t) + " ms");
        }
        animation.finish();
      }
      // Révélation : photographies pas encore révélées, puis en cours de révélation.
      const attente = [...document.querySelectorAll(".story-photo[data-reveal]:not(.is-revealed)")];
      for (const fig of attente) verifier(fig.querySelector("img"), "avant révélation");
      document.documentElement.style.scrollBehavior = "auto";
      const cible = attente[0];
      scrollTo(0, cible.getBoundingClientRect().top + scrollY - innerHeight * 0.5);
      for (const delai of [60, 200, 400, 900]) {
        await new Promise((r) => setTimeout(r, delai));
        verifier(cible.querySelector("img"), "révélation à +" + delai + " ms");
      }
      return { defauts: defauts.slice(0, 8), animations: animations.length, observees: attente.length };
    })()`);
  record("Reportage — les photographies restent entières et fidèles pendant l'animation d'entrée et la révélation",
    integriteAnimation.defauts.length === 0 && integriteAnimation.animations > 0 && integriteAnimation.observees > 5,
    JSON.stringify(integriteAnimation));

  // Survol : la taille et le rendu de l'image ne bougent pas.
  const survolReportage = async (url, selecteurImage, nom) => {
    await visit(url, { width: 1440, height: 900, mobile: false, attente: 600 });
    const avant = await cdp.evaluate(`
      (async () => {
        document.documentElement.style.scrollBehavior = "auto";
        const img = document.querySelector(${JSON.stringify(selecteurImage)});
        scrollTo(0, img.getBoundingClientRect().top + scrollY - innerHeight * 0.3);
        await new Promise((r) => setTimeout(r, 1200));
        const r = img.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
      })()`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: avant.x, y: avant.y });
    await sleep(900); // plus long que toute transition du site
    const apres = await cdp.evaluate(`
      (() => {
        ${VERIFIER_IMAGE}
        const img = document.querySelector(${JSON.stringify(selecteurImage)});
        verifier(img, ${JSON.stringify(nom)});
        const r = img.getBoundingClientRect();
        // Sur la carte du portfolio, le lien étiré recouvre l'image : c'est la carte qui est survolée.
        return { survol: (img.closest(".reportage-card, .plate") ?? img).matches(":hover"), defauts, w: r.width, h: r.height };
      })()`);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
    const taille = Math.abs(apres.w - avant.w) < 0.5 && Math.abs(apres.h - avant.h) < 0.5;
    record(`Survol — ${nom} : l'image ne change ni de taille, ni de rendu`,
      apres.survol && taille && apres.defauts.length === 0, JSON.stringify({ avant, apres }));
  };
  await survolReportage(REPORTAGE, ".story-frame--gauche img", "photographie du reportage");
  await survolReportage("portfolio.html", ".reportage-card__media img", "couverture de la carte du portfolio");

  // En mobile, le sommaire défile horizontalement : l'entrée active doit y
  // être ramenée dans la partie visible, sinon elle reste hors champ.
  await visit(REPORTAGE, { width: 390, height: 844 });
  const actifVisible = await cdp.evaluate(`
    (async () => {
      document.documentElement.style.scrollBehavior = "auto";
      const cible = document.getElementById("chapitre-le-gateau");
      scrollTo(0, cible.getBoundingClientRect().top + scrollY + 40);
      await new Promise((r) => setTimeout(r, 1200));
      const lien = document.querySelector("[data-rail] a[aria-current]");
      if (!lien) return "aucune entrée active";
      const liste = lien.closest("ol").getBoundingClientRect(), r = lien.getBoundingClientRect();
      return lien.getAttribute("href") === "#chapitre-le-gateau" && r.left >= liste.left - 1 && r.right <= liste.right + 1
        ? "" : lien.getAttribute("href") + " hors champ (" + Math.round(r.left) + "–" + Math.round(r.right) + " pour " + Math.round(liste.left) + "–" + Math.round(liste.right) + ")";
    })()`);
  record("Reportage — en mobile, l'entrée active du sommaire est ramenée dans le champ",
    actifVisible === "", actifVisible);

  // Clavier : un lien du sommaire activé par Entrée mène au chapitre, dont le
  // titre n'est masqué ni par l'entête ni par le sommaire collant.
  for (const [width, height, mobile] of [[1440, 900, false], [390, 844, true]]) {
    await visit(REPORTAGE, { width, height, mobile });
    await cdp.evaluate(`(document.documentElement.style.scrollBehavior = "auto",
      document.querySelector('[data-rail] a[href="#chapitre-le-gateau"]').focus(), 1)`);
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    await sleep(600);
    const arrivee = await cdp.evaluate(`
      (() => {
        const titre = document.getElementById("t-chapitre-le-gateau").getBoundingClientRect();
        const rail = document.querySelector(".rail").getBoundingClientRect();
        const entete = document.querySelector(".site-header").getBoundingClientRect();
        return {
          hash: location.hash,
          titre: Math.round(titre.top),
          dessous: Math.round(Math.max(rail.bottom, entete.bottom)),
          visible: titre.top >= Math.max(rail.bottom, entete.bottom) - 1 && titre.top < innerHeight,
        };
      })()`);
    record(`Reportage @${width}px — le sommaire est utilisable au clavier, le chapitre visé reste visible`,
      arrivee.hash === "#chapitre-le-gateau" && arrivee.visible, JSON.stringify(arrivee));
  }

  // Mouvement réduit : rien de masqué, aucune animation liée au défilement.
  await visit(REPORTAGE, { width: 390, height: 844, reducedMotion: true });
  const reduitRep = await cdp.evaluate(`
    (() => ({
      masques: [...document.querySelectorAll("[data-reveal], [data-intro]")]
        .filter((el) => Number(getComputedStyle(el).opacity) < 0.99).length,
      animees: [...document.querySelectorAll(".story-frame--pleine img")]
        .filter((img) => getComputedStyle(img).animationName !== "none").length,
    }))()`);
  record("Reportage — mouvement réduit : aucun contenu masqué, aucune animation au défilement",
    reduitRep.masques === 0 && reduitRep.animees === 0, JSON.stringify(reduitRep));

  // Sans JavaScript : le récit complet reste lisible, images comprises.
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  await visit(REPORTAGE, { width: 390, height: 844 });
  const sansJsRep = await cdp.evaluate(`
    (() => ({
      masques: [...document.querySelectorAll("[data-reveal], [data-intro]")].filter((el) => {
        const s = getComputedStyle(el);
        return Number(s.opacity) < 0.99 || (el.dataset.reveal === "wipe" && (s.clipPath !== "none" || s.transform !== "none"));
      }).length,
      paragraphes: document.querySelectorAll(".story-intro__text p, .story-chapter__text p").length,
      navigation: getComputedStyle(document.querySelector(".nav")).display !== "none",
    }))()`);
  record("Reportage — sans JavaScript : texte, images et navigation restent accessibles",
    sansJsRep.masques === 0 && sansJsRep.paragraphes > 10 && sansJsRep.navigation, JSON.stringify(sansJsRep));
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });

  // « sizes » : la valeur déclarée n'est jamais inférieure à la largeur
  // rendue, pour aucune image du reportage ni de la carte du portfolio.
  // Les valeurs contiennent des virgules à l'intérieur de min() : le
  // découpage tient compte des parenthèses.
  const MESURE_SIZES_TOUTES = `
    (() => {
      const decouper = (texte) => {
        const morceaux = []; let profondeur = 0, courant = "";
        for (const c of texte) {
          if (c === "(") profondeur++;
          if (c === ")") profondeur--;
          if (c === "," && profondeur === 0) { morceaux.push(courant.trim()); courant = ""; } else courant += c;
        }
        morceaux.push(courant.trim());
        return morceaux;
      };
      const sonde = document.createElement("div");
      sonde.style.cssText = "position:absolute;visibility:hidden;height:0;top:0;left:0";
      document.body.append(sonde);
      const resoudre = (sizes) => {
        for (const morceau of decouper(sizes)) {
          let condition = "", valeur = morceau;
          if (morceau.startsWith("(")) {
            let profondeur = 0, fin = 0;
            for (let i = 0; i < morceau.length; i++) {
              if (morceau[i] === "(") profondeur++;
              if (morceau[i] === ")" && --profondeur === 0) { fin = i; break; }
            }
            condition = morceau.slice(0, fin + 1);
            valeur = morceau.slice(fin + 1).trim();
          }
          if (condition && !matchMedia(condition).matches) continue;
          sonde.style.width = "";
          sonde.style.width = valeur;
          return sonde.style.width ? sonde.getBoundingClientRect().width : null;
        }
        return null;
      };
      const releve = [...document.querySelectorAll("main img[sizes]")].map((img) => ({
        nom: img.currentSrc.split("/").pop() || img.getAttribute("src").split("/").pop(),
        declaree: resoudre(img.getAttribute("sizes")),
        reelle: img.offsetWidth,
      }));
      sonde.remove();
      return releve;
    })()`;
  const sousDeclareRep = [];
  const surDeclareRep = [];
  for (const file of [REPORTAGE, "portfolio.html"]) {
    for (const [width, height] of [...WIDTHS.map((w) => [w, 900]), [1440, 640], [390, 640], [1920, 1200]]) {
      await visit(file, { width, height, mobile: width < 768, attente: 250 });
      for (const m of await cdp.evaluate(MESURE_SIZES_TOUTES)) {
        const trace = `${file} @${width}×${height} ${m.nom} : déclaré ${Math.round(m.declaree)}px pour ${m.reelle}px`;
        if (m.declaree === null) sousDeclareRep.push(`${trace} (sizes non résolu)`);
        else if (m.declaree < m.reelle - 1) sousDeclareRep.push(trace);
        else if (height === 900 && m.reelle > 0 && m.declaree > m.reelle * 1.4) surDeclareRep.push(trace);
      }
    }
  }
  record("Reportage — « sizes » n'est jamais inférieur à la largeur rendue (2 pages, 11 formats d'écran)",
    sousDeclareRep.length === 0, sousDeclareRep.slice(0, 6).join(" ; "));
  record("Reportage — « sizes » reste à moins de 40 % au-dessus de la largeur rendue",
    surDeclareRep.length === 0, surDeclareRep.slice(0, 6).join(" ; "));

  // --- 6. Données d'événements --------------------------------------------
  await visit("evenements.html", { width: 1440, height: 900, mobile: false });
  record("Événements — l'état d'attente reste affiché tant qu'aucun album n'existe",
    await cdp.evaluate(`
      (() => {
        const empty = document.querySelector("[data-albums-empty]");
        const mount = document.querySelector("[data-albums]");
        return !empty.hidden && mount.hidden;
      })()`));

  // --- 6 bis. Rendu des albums, avec un jeu d'essai ------------------------
  // La requête vers events.json est interceptée et satisfaite en mémoire :
  // le fichier versionné n'est jamais modifié. Sans cela, ce chemin de code
  // ne serait jamais exercé tant qu'aucun album réel n'existe.
  const JEU_ESSAI = {
    albums: [
      {
        id: "essai-ancien", title: "Album plus ancien", date: "2026-03-02",
        category: "portraits",
        cover: { src: "assets/img/placeholders/plate-3x2-b.svg", width: 1800, height: 1200, alt: "" },
      },
      {
        id: "essai-recent", title: "Album le plus récent", date: "2026-10-18",
        category: "ceremonies", description: "Une description d'essai.",
        url: "javascript:alert(1)", // doit être refusée
        cover: {
          src: "assets/img/placeholders/plate-3x2-a.svg", width: 1800, height: 1200, alt: "Couverture",
          variants: [
            { src: "assets/img/placeholders/plate-3x2-a.svg", width: 900 },
            { src: "assets/img/placeholders/plate-3x2-b.svg", width: 1800 },
          ],
        },
        photos: [{ src: "assets/img/placeholders/plate-1x1-a.svg", width: 1400, height: 1400, alt: "" }],
      },
    ],
  };

  /** Réponse servie à la place d'events.json, modifiable entre deux visites. */
  let reponseAlbums = { statut: 200, corps: JSON.stringify(JEU_ESSAI) };

  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*events.json*" }] });
  cdp.on("Fetch.requestPaused", ({ requestId }) => {
    cdp.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: reponseAlbums.statut,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(reponseAlbums.corps, "utf8").toString("base64"),
    }).catch(() => {});
  });

  await visit("evenements.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  const rendu = await cdp.evaluate(`
    (() => {
      const mount = document.querySelector("[data-albums]");
      const titres = [...mount.querySelectorAll(".album__title")].map((h) => h.textContent.trim());
      const image = mount.querySelector("img");
      return {
        nombre: mount.children.length,
        masque: mount.hidden,
        attenteMasquee: document.querySelector("[data-albums-empty]").hidden,
        titres,
        srcset: image?.getAttribute("srcset") ?? "",
        sizes: image?.getAttribute("sizes") ?? "",
        lazy: image?.getAttribute("loading"),
        datetime: mount.querySelector("time")?.getAttribute("datetime") ?? "",
        dateLisible: mount.querySelector("time")?.textContent ?? "",
        liens: mount.querySelectorAll("a[href]").length,
        hrefs: [...mount.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
      };
    })()`);

  record("Albums — les albums du fichier JSON sont rendus", rendu.nombre === 2 && !rendu.masque);
  record("Albums — l'état d'attente disparaît", rendu.attenteMasquee === true);
  record("Albums — tri du plus récent au plus ancien",
    rendu.titres[0] === "Album le plus récent", rendu.titres.join(" / "));
  record("Albums — srcset et sizes renseignés depuis les déclinaisons",
    rendu.srcset.includes("900w") && rendu.srcset.includes("1800w") && rendu.sizes.length > 0,
    `${rendu.srcset} | ${rendu.sizes}`);
  record("Albums — couvertures en chargement différé", rendu.lazy === "lazy");
  record("Albums — date lisible et attribut datetime",
    rendu.datetime === "2026-10-18"
      && ["18", "octobre", "2026"].every((part) => rendu.dateLisible.includes(part)),
    `${rendu.datetime} / ${rendu.dateLisible}`);
  record("Albums — une URL « javascript: » est refusée",
    rendu.liens === 0, rendu.hrefs.join(", "));

  await visit("index.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  record("Albums — l'accueil n'en affiche que les plus récents (data-limit)",
    await cdp.evaluate(`document.querySelector("[data-albums]").children.length <= 3`));

  // --- 6 quinquies. Fuseau horaire : aucun décalage d'un jour --------------
  // « new Date("2026-10-18") » est interprété comme minuit UTC : à l'ouest de
  // Greenwich, la date affichée reculerait d'un jour.
  await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "America/Los_Angeles" });
  await visit("evenements.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  const dateOuest = await cdp.evaluate(`
    (() => {
      const time = document.querySelector("[data-albums] time");
      return {
        fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone,
        datetime: time?.getAttribute("datetime") ?? "",
        texte: time?.textContent ?? "",
      };
    })()`);
  record("Albums — la date ne recule pas d'un jour à America/Los_Angeles",
    dateOuest.fuseau === "America/Los_Angeles"
      && dateOuest.datetime === "2026-10-18"
      && ["18", "octobre", "2026"].every((part) => dateOuest.texte.includes(part)),
    `${dateOuest.fuseau} → ${dateOuest.datetime} / ${dateOuest.texte}`);
  await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "" });

  // --- 6 sexies. Données invalides : les albums valides survivent ----------
  // Un album malformé, ou une déclinaison d'image malformée, ne doit pas faire
  // disparaître les albums corrects — ni interrompre le rendu par une erreur.
  const JEU_INVALIDE = {
    albums: [
      null,
      "pas un album",
      42,
      // Titre manquant.
      { id: "sans-titre", date: "2026-05-01", category: "portraits",
        cover: { src: "assets/img/placeholders/plate-3x2-a.svg", width: 1800, height: 1200, alt: "" } },
      // Date inexistante.
      { id: "date-impossible", title: "Date impossible", date: "2026-02-31" },
      // Couverture sans dimensions : l'emplacement ne serait pas réservé.
      { id: "sans-dimensions", title: "Couverture sans dimensions", date: "2026-04-01",
        cover: { src: "assets/img/placeholders/plate-3x2-a.svg", alt: "" } },
      // Seul album valide, avec trois déclinaisons malformées sur quatre.
      { id: "valide", title: "Album valide", date: "2026-06-12", category: "reportages",
        cover: {
          src: "assets/img/placeholders/plate-3x2-a.svg", width: 1800, height: 1200, alt: "Couverture",
          variants: [
            null,
            { src: "javascript:alert(1)", width: 900 },
            { src: "assets/img/placeholders/plate-3x2-b.svg" },
            { src: "assets/img/placeholders/plate-3x2-b.svg", width: 1800 },
          ],
        } },
    ],
  };

  reponseAlbums = { statut: 200, corps: JSON.stringify(JEU_INVALIDE) };
  await visit("evenements.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  const partiel = await cdp.evaluate(`
    (() => {
      const mount = document.querySelector("[data-albums]");
      const statut = document.querySelector("[data-albums-status]");
      const image = mount.querySelector("img");
      return {
        nombre: mount.children.length,
        masque: mount.hidden,
        titres: [...mount.querySelectorAll(".album__title")].map((h) => h.textContent.trim()),
        srcset: image?.getAttribute("srcset") ?? "",
        statutVisible: statut ? !statut.hidden : false,
        statutTexte: statut?.textContent ?? "",
      };
    })()`);
  record("Albums — un album invalide ne fait pas disparaître les albums valides",
    partiel.nombre === 1 && !partiel.masque && partiel.titres[0] === "Album valide",
    `${partiel.nombre} rendu(s) : ${partiel.titres.join(" / ")}`);
  record("Albums — une déclinaison malformée est écartée seule",
    partiel.srcset === "assets/img/placeholders/plate-3x2-b.svg 1800w", partiel.srcset);
  record("Albums — les albums écartés sont signalés au visiteur",
    partiel.statutVisible && partiel.statutTexte.includes("6 albums ignorés"), partiel.statutTexte);

  // Tous les albums invalides : état distinct de la liste vide.
  reponseAlbums = { statut: 200, corps: JSON.stringify({ albums: [null, {}, { title: "   " }] }) };
  await visit("evenements.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  const invalide = await cdp.evaluate(`
    (() => {
      const statut = document.querySelector("[data-albums-status]");
      return {
        masque: document.querySelector("[data-albums]").hidden,
        attenteVisible: !document.querySelector("[data-albums-empty]").hidden,
        texte: statut && !statut.hidden ? statut.textContent : "",
      };
    })()`);
  record("Albums — données entièrement invalides : état distinct, annoncé",
    invalide.masque && invalide.attenteVisible && invalide.texte.includes("invalides"),
    invalide.texte);

  // Structure du fichier non conforme.
  reponseAlbums = { statut: 200, corps: JSON.stringify({ albums: "ceci n'est pas une liste" }) };
  await visit("evenements.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  record("Albums — un fichier de structure non conforme est signalé comme invalide",
    await cdp.evaluate(`
      (document.querySelector("[data-albums-status]")?.textContent ?? "").includes("invalides")`));

  // Erreur de chargement : à distinguer d'une absence d'album.
  reponseAlbums = { statut: 500, corps: "erreur" };
  await visit("evenements.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  record("Albums — une erreur de chargement est distinguée d'une liste vide",
    await cdp.evaluate(`
      (() => {
        const statut = document.querySelector("[data-albums-status]");
        return !statut.hidden
          && statut.textContent.includes("injoignable")
          && !document.querySelector("[data-albums-empty]").hidden;
      })()`));

  // JSON illisible : même traitement qu'une erreur réseau.
  reponseAlbums = { statut: 200, corps: "<!doctype html><title>oups</title>" };
  await visit("evenements.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  record("Albums — un JSON illisible est traité comme une erreur de chargement",
    await cdp.evaluate(`
      (document.querySelector("[data-albums-status]")?.textContent ?? "").includes("injoignable")`));

  // Liste vide : aucun message, l'état d'attente écrit en HTML suffit.
  reponseAlbums = { statut: 200, corps: JSON.stringify({ albums: [] }) };
  await visit("evenements.html", { width: 1440, height: 900, mobile: false, attente: 1200 });
  record("Albums — une liste vide n'affiche aucun message d'anomalie",
    await cdp.evaluate(`
      document.querySelector("[data-albums-status]").hidden
        && !document.querySelector("[data-albums-empty]").hidden`));

  // --- 6 septies. « sizes » doit refléter la largeur réelle des couvertures -
  // Sous-déclarer fait servir une déclinaison trop petite, donc floue ; la
  // valeur est donc comparée à la largeur de rendu mesurée, à chaque palier du
  // nombre de colonnes.
  reponseAlbums = { statut: 200, corps: JSON.stringify(JEU_ESSAI) };
  const MESURE_SIZES = `
    (() => {
      const img = document.querySelector("[data-albums] img[sizes]");
      if (!img) return null;

      // Résolution de l'attribut sizes : première condition média satisfaite,
      // puis conversion de la longueur en pixels par une sonde.
      const sonde = document.createElement("div");
      sonde.style.cssText = "position:absolute;visibility:hidden;height:0;top:0;left:0";
      document.body.append(sonde);
      let declaree = null;
      for (const morceau of img.getAttribute("sizes").split(",")) {
        const texte = morceau.trim();
        let condition = "", valeur = texte;
        if (texte.startsWith("(")) {
          const fin = texte.lastIndexOf(")");
          condition = texte.slice(0, fin + 1);
          valeur = texte.slice(fin + 1).trim();
        }
        if (condition && !window.matchMedia(condition).matches) continue;
        sonde.style.width = valeur;
        declaree = sonde.getBoundingClientRect().width;
        break;
      }
      sonde.remove();

      const conteneur = img.closest("[data-albums]");
      const enfants = [...conteneur.children];
      const hautPremier = enfants[0].getBoundingClientRect().top;
      const colonnes = enfants.filter((e) => Math.abs(e.getBoundingClientRect().top - hautPremier) < 2).length;
      return {
        declaree: declaree === null ? null : Math.round(declaree),
        reelle: Math.round(img.getBoundingClientRect().width),
        colonnes,
      };
    })()`;

  // Aux largeurs de référence s'ajoutent les abords des seuils où une colonne
  // supplémentaire apparaît : c'est là qu'une déclaration approximative se
  // trahit.
  const LARGEURS_SIZES = [...new Set([...WIDTHS, 500, 704, 712, 1100, 1120, 1540, 1560])]
    .sort((a, b) => a - b);

  const sousDeclare = [];  // défaut réel : déclinaison trop petite, donc floue
  const impreciss = [];    // simple gaspillage, toléré aux abords des seuils
  for (const file of ["evenements.html", "index.html"]) {
    for (const width of LARGEURS_SIZES) {
      await visit(file, { width, height: 900, mobile: width < 768, attente: 700 });
      const m = await cdp.evaluate(MESURE_SIZES);
      if (!m || m.declaree === null) { sousDeclare.push(`${file} @${width}px : sizes non résolu`); continue; }
      const trace = `${file} @${width}px : déclaré ${m.declaree}px pour ${m.reelle}px rendus sur ${m.colonnes} colonne(s)`;
      if (m.declaree < m.reelle - 1) sousDeclare.push(trace);
      else if (WIDTHS.includes(width) && m.declaree > m.reelle * 1.4) impreciss.push(trace);
    }
  }
  record(`Albums — « sizes » n'est jamais inférieur à la largeur de rendu (2 pages × ${LARGEURS_SIZES.length} largeurs)`,
    sousDeclare.length === 0, sousDeclare.join(" ; "));
  record(`Albums — « sizes » reste à moins de 40 % au-dessus aux ${WIDTHS.length} largeurs de référence`,
    impreciss.length === 0, impreciss.join(" ; "));

  await cdp.send("Fetch.disable");

  // --- 6 ter. Filet de sécurité si les modules ne se chargent pas ----------
  // JavaScript est actif mais les modules sont injoignables : le cas le plus
  // sournois, car la feuille de style masque les photographies en attendant.
  await cdp.send("Network.setBlockedURLs", { urls: ["*/assets/js/*"] });
  await visit("index.html", { width: 1440, height: 900, mobile: false, attente: 4200 });
  record("Modules injoignables — le contenu finit par s'afficher",
    await cdp.evaluate(`
      [...document.querySelectorAll("[data-reveal]")]
        .every((el) => Number(getComputedStyle(el).opacity) > 0.99)`));

  // Et surtout : le visiteur doit pouvoir continuer à naviguer. L'interface
  // mobile dépendant de JavaScript (bouton + <dialog>) ne doit donc jamais
  // remplacer la rangée de liens avant que nav.js ait abouti.
  await visit("index.html", { width: 390, height: 844, attente: 4200 });
  const naviguable = await cdp.evaluate(`
    (() => {
      const nav = document.querySelector(".nav");
      const bouton = document.querySelector("[data-menu-open]");
      if (getComputedStyle(nav).display === "none") return "rangée de liens masquée";
      if (getComputedStyle(bouton).display !== "none") return "bouton de menu inopérant affiché";
      if (document.documentElement.classList.contains("js-menu")) return "classe js-menu posée à tort";
      const lien = [...document.querySelectorAll(".nav__list a")]
        .find((a) => a.getAttribute("href") === "portfolio.html");
      if (!lien) return "lien Portfolio absent";
      const r = lien.getBoundingClientRect();
      if (r.width < 1 || r.height < 24) return "lien Portfolio trop petit (" + Math.round(r.height) + "px)";
      const dessus = document.elementFromPoint(r.left + Math.min(4, r.width / 2), r.top + r.height / 2);
      return dessus && dessus.closest(".nav") ? "" : "lien Portfolio recouvert";
    })()`);
  record("Modules injoignables — la navigation mobile reste utilisable",
    naviguable === "", String(naviguable));

  await cdp.send("Network.setBlockedURLs", { urls: [] });

  // Contrôle inverse : une fois les modules chargés, le bouton reprend bien
  // la main. Sans cela, le repli ci-dessus pourrait masquer une régression.
  await visit("index.html", { width: 390, height: 844, attente: 800 });
  record("Modules chargés — le bouton de menu remplace la rangée de liens",
    await cdp.evaluate(`
      document.documentElement.classList.contains("js-menu")
        && getComputedStyle(document.querySelector(".nav")).display === "none"
        && getComputedStyle(document.querySelector("[data-menu-open]")).display !== "none"`));

  // --- 6 quater. Taille des cibles (WCAG 2.2, Target Size Minimum) -------
  const cibles = [];
  for (const file of ["index.html", "portfolio.html", REPORTAGE]) {
  await visit(file, { width: 390, height: 844 });
  cibles.push(...(await cdp.evaluate(`
    [...document.querySelectorAll("a[href], button")]
      .filter((el) => {
        // Exception « inline » du critère 2.5.8 : un lien inséré dans une
        // phrase est contraint par l'interligne du texte qui l'entoure.
        const parent = el.parentElement;
        const enPhrase = getComputedStyle(el).display === "inline"
          && parent && parent.textContent.trim().length > el.textContent.trim().length;
        return !enPhrase;
      })
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24))
      .map(({ el }) => "${file} " + el.tagName.toLowerCase() + "." + (el.getAttribute("class") || "sans-classe"))`)));
  }
  record("Cibles — toutes les commandes mesurent au moins 24 px (accueil, portfolio, reportage)",
    cibles.length === 0, cibles.join(", "));

  // --- 7. Balayage responsive sur les largeurs de référence ----------------
  const debordements = [];
  for (const file of PAGES) {
    for (const width of WIDTHS) {
      await visit(file, { width, height: 900, mobile: width < 768, attente: 220 });
      const { contenu, vue } = await cdp.evaluate(
        `({ contenu: document.documentElement.scrollWidth, vue: document.documentElement.clientWidth })`
      );
      if (contenu > vue + 1) debordements.push(`${file} @${width}px (${contenu} > ${vue})`);
    }
  }
  record(
    `Responsive — aucun débordement horizontal (${PAGES.length} pages × ${WIDTHS.length} largeurs)`,
    debordements.length === 0,
    debordements.join(" ; ")
  );

  // --- 8. Référencement technique -----------------------------------------
  const titres = new Map();
  const seo = [];
  for (const file of PAGES) {
    await visit(file, { width: 1440, height: 900, mobile: false, attente: 300 });
    const releve = await cdp.evaluate(`
      (async () => {
        const images = [...document.images];
        let precedent = 0, sauts = 0;
        for (const titre of document.querySelectorAll("h1, h2, h3, h4")) {
          const niveau = Number(titre.tagName[1]);
          if (precedent && niveau > precedent + 1) sauts++;
          precedent = niveau;
        }
        const liens = [...new Set([...document.querySelectorAll("a[href]")]
          .map((a) => a.getAttribute("href"))
          .filter((h) => h && !h.startsWith("#") && !/^(https?:|mailto:|tel:)/.test(h)))];
        const casses = [];
        for (const href of liens) {
          try { if (!(await fetch(href, { method: "HEAD" })).ok) casses.push(href); }
          catch { casses.push(href); }
        }
        for (const ancre of document.querySelectorAll('a[href^="#"]')) {
          const id = decodeURIComponent(ancre.getAttribute("href").slice(1));
          if (id && !document.getElementById(id)) casses.push("#" + id);
        }
        return {
          titre: document.title,
          h1: document.querySelectorAll("h1").length,
          description: document.querySelector('meta[name="description"]')?.content.length ?? 0,
          lang: document.documentElement.lang,
          sansDimension: images.filter((i) => !i.getAttribute("width") || !i.getAttribute("height")).length,
          sansAlt: images.filter((i) => i.getAttribute("alt") === null).length,
          cassees: images.filter((i) => i.complete && i.naturalWidth === 0).length,
          sauts,
          og: Boolean(document.querySelector('meta[property="og:title"]')),
          liensCasses: casses,
        };
      })()`);

    if (releve.h1 !== 1) seo.push(`${file} : ${releve.h1} <h1>`);
    if (!releve.titre) seo.push(`${file} : <title> absent`);
    if (releve.titre.length > 65) seo.push(`${file} : <title> de ${releve.titre.length} caractères`);
    if (titres.has(releve.titre)) seo.push(`${file} : <title> identique à ${titres.get(releve.titre)}`);
    titres.set(releve.titre, file);
    if (releve.description < 70 || releve.description > 165) seo.push(`${file} : description de ${releve.description} caractères`);
    if (releve.lang !== "fr") seo.push(`${file} : lang="${releve.lang}"`);
    if (releve.sansDimension) seo.push(`${file} : ${releve.sansDimension} image(s) sans dimensions`);
    if (releve.sansAlt) seo.push(`${file} : ${releve.sansAlt} image(s) sans alt`);
    if (releve.cassees) seo.push(`${file} : ${releve.cassees} image(s) non chargée(s)`);
    if (releve.sauts) seo.push(`${file} : ${releve.sauts} saut(s) de niveau de titre`);
    if (!releve.og) seo.push(`${file} : métadonnées Open Graph absentes`);
    if (releve.liensCasses.length) seo.push(`${file} : lien(s) cassé(s) ${releve.liensCasses.join(", ")}`);
  }
  record(`SEO — balisage, titres, images et liens conformes (${PAGES.length} pages)`,
    seo.length === 0, seo.join(" ; "));

  // --- 8 bis. Métadonnées de partage et données structurées ---------------
  // Avant confirmation de l'URL publique, canonical et og:url doivent rester
  // ABSENTS : une adresse supposée puis corrigée désoriente les moteurs. Une
  // fois tools/finalize-urls.mjs exécuté sur les fichiers de travail, ils
  // doivent au contraire être présents et cohérents entre les pages — sans
  // qu'aucun domaine précis ne soit imposé ici, puisque l'adresse réelle
  // n'est confirmée qu'au moment de la publication. L'état est déduit de la
  // première page (index.html) et imposé aux suivantes.
  const metadonnees = [];
  let basePubliee;
  for (const file of PAGES) {
    await visit(file, { width: 1440, height: 900, mobile: false, attente: 250 });
    const releve = await cdp.evaluate(`
      (() => {
        const meta = (cle, attribut = "name") =>
          document.querySelector('meta[' + attribut + '="' + cle + '"]')?.content ?? null;
        let ld = null, ldValide = true;
        const script = document.querySelector('script[type="application/ld+json"]');
        if (script) {
          try { ld = JSON.parse(script.textContent); } catch { ldValide = false; }
        }
        return {
          ogType: meta("og:type", "property"),
          ogSite: meta("og:site_name", "property"),
          ogLocale: meta("og:locale", "property"),
          ogTitre: meta("og:title", "property"),
          ogDescription: meta("og:description", "property"),
          ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? null,
          ogImageAlt: meta("og:image:alt", "property"),
          twitter: meta("twitter:card"),
          theme: meta("theme-color"),
          favicon: document.querySelector('link[rel="icon"]')?.getAttribute("href") ?? null,
          canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
          ogUrl: meta("og:url", "property"),
          robots: meta("robots"),
          ld, ldValide,
        };
      })()`);

    // Un reportage est un article, avec son propre visuel de partage (JPEG
    // tiré de la couverture) et des données structurées « Article ».
    const estReportage = file.startsWith("reportages/");
    const exige = {
      ogType: estReportage ? "article" : "website", ogSite: "Ange Kevin Photographie", ogLocale: "fr_FR",
      twitter: "summary_large_image", theme: "#0a0a0b",
    };
    for (const [cle, attendu] of Object.entries(exige)) {
      if (releve[cle] !== attendu) metadonnees.push(`${file} : ${cle} = ${releve[cle]}`);
    }
    if (estReportage) {
      if (!/assets\/img\/reportages\/[^/]+\/[^/]+-og\.jpg$/.test(releve.ogImage ?? "")) {
        metadonnees.push(`${file} : og:image ne pointe pas vers le visuel de partage du reportage (${releve.ogImage})`);
      }
      if (releve.ld?.["@type"] !== "Article" || !releve.ld?.headline) {
        metadonnees.push(`${file} : JSON-LD Article attendu`);
      }
    }
    for (const cle of ["ogTitre", "ogDescription", "ogImage", "ogImageAlt", "favicon"]) {
      if (!releve[cle]) metadonnees.push(`${file} : ${cle} absent`);
    }
    if (!releve.ldValide) metadonnees.push(`${file} : JSON-LD illisible`);
    if (releve.ld && releve.ld["@context"] !== "https://schema.org") {
      metadonnees.push(`${file} : JSON-LD sans contexte schema.org`);
    }
    if (file === "index.html") basePubliee = releve.canonical ? releve.canonical.replace(/\/$/, "") : null;

    if (!basePubliee) {
      if (releve.canonical) metadonnees.push(`${file} : canonical publié avant confirmation de l'URL (${releve.canonical})`);
      if (releve.ogUrl) metadonnees.push(`${file} : og:url publié avant confirmation de l'URL (${releve.ogUrl})`);
    } else {
      const attendu = file === "index.html" ? `${basePubliee}/` : `${basePubliee}/${file}`;
      if (releve.canonical !== attendu) metadonnees.push(`${file} : canonical = ${releve.canonical}`);
      if (releve.ogUrl !== attendu) metadonnees.push(`${file} : og:url = ${releve.ogUrl}`);
    }
    if (file === "404.html" && !(releve.robots ?? "").includes("noindex")) {
      metadonnees.push("404.html : directive noindex absente");
    }
    if (file !== "404.html" && (releve.robots ?? "").includes("noindex")) {
      metadonnees.push(`${file} : noindex posé à tort`);
    }
  }
  if (basePubliee) {
    const sitemap = await readFile("sitemap.xml", "utf8").catch(() => null);
    if (!sitemap) {
      metadonnees.push("sitemap.xml absent malgré des URL publiées");
    } else {
      for (const file of PAGES) {
        if (file === "404.html") continue;
        const url = file === "index.html" ? `${basePubliee}/` : `${basePubliee}/${file}`;
        if (!sitemap.includes(`<loc>${url}</loc>`)) metadonnees.push(`sitemap.xml : ${url} absente`);
      }
    }
  }
  record(`SEO — métadonnées de partage et données structurées (${PAGES.length} pages)`,
    metadonnees.length === 0, metadonnees.join(" ; "));

  // --- 8 ter. Finalisation des URL, en répertoire isolé --------------------
  // tools/finalize-urls.mjs écrit canonical, og:url, og:image, sitemap.xml et
  // la base de 404.html une fois l'adresse publique confirmée — l'état que le
  // test ci-dessus refuse tant qu'il n'est pas exécuté. On le vérifie donc ici
  // séparément, sur une copie temporaire des pages : les fichiers de travail
  // ne sont jamais touchés, et aucun domaine réel n'est présumé.
  {
    const FAUX_BASE = "https://exemple.invalid/essai";
    const avant = new Map();
    for (const nom of [...PAGES, "robots.txt"]) avant.set(nom, await readFile(nom, "utf8"));

    const temp = await mkdtemp(join(tmpdir(), "akp-finalize-"));
    try {
      for (const nom of [...PAGES, "robots.txt"]) {
        await mkdir(join(temp, nom, ".."), { recursive: true });
        await cp(nom, join(temp, nom));
      }

      const finaliser = (base) => new Promise((resoudre, rejeter) => {
        const proc = spawn(
          process.execPath,
          [join(process.cwd(), "tools", "finalize-urls.mjs"), base],
          { cwd: temp, stdio: "ignore" }
        );
        proc.once("exit", (code) => (code === 0 ? resoudre() : rejeter(new Error(`finalize-urls.mjs : code ${code}`))));
        proc.once("error", rejeter);
      });
      const ogImage = async (page) =>
        (await readFile(join(temp, page), "utf8")).match(/<meta property="og:image" content="([^"]*)">/)?.[1];

      await finaliser(FAUX_BASE);

      const probleme = [];
      // og:image : chaque page garde son propre visuel, rendu absolu.
      const ogAttendus = {
        "index.html": `${FAUX_BASE}/assets/img/og-cover.png`,
        [REPORTAGE]: `${FAUX_BASE}/assets/img/reportages/florent/dsc-0148-og.jpg`,
      };
      for (const [page, attendu] of Object.entries(ogAttendus)) {
        const valeur = await ogImage(page);
        if (valeur !== attendu) probleme.push(`${page} : og:image = ${valeur}`);
      }
      for (const page of PAGES) {
        const html = await readFile(join(temp, page), "utf8");
        const url = page === "index.html" ? `${FAUX_BASE}/` : `${FAUX_BASE}/${page}`;
        const canonical = html.match(/<link rel="canonical" href="([^"]*)">/)?.[1];
        const ogUrl = html.match(/<meta property="og:url" content="([^"]*)">/)?.[1];
        if (canonical !== url) probleme.push(`${page} : canonical = ${canonical}`);
        if (ogUrl !== url) probleme.push(`${page} : og:url = ${ogUrl}`);
        if (page === "404.html") {
          const base404 = html.match(/<base href="([^"]*)">/)?.[1];
          if (base404 !== "/essai/") probleme.push(`404.html : base = ${base404}`);
        }
      }

      const sitemap = await readFile(join(temp, "sitemap.xml"), "utf8").catch(() => null);
      const pagesSansErreur = PAGES.filter((p) => p !== "404.html");
      if (!sitemap) {
        probleme.push("sitemap.xml non écrit");
      } else {
        for (const page of pagesSansErreur) {
          const url = page === "index.html" ? `${FAUX_BASE}/` : `${FAUX_BASE}/${page}`;
          if (!sitemap.includes(`<loc>${url}</loc>`)) probleme.push(`sitemap.xml : ${url} absente`);
        }
        if (sitemap.includes(`<loc>${FAUX_BASE}/404.html</loc>`)) probleme.push("sitemap.xml : 404.html ne devrait pas y figurer");
      }

      const robots = await readFile(join(temp, "robots.txt"), "utf8").catch(() => "");
      if (!robots.includes(`Sitemap: ${FAUX_BASE}/sitemap.xml`)) probleme.push("robots.txt : directive Sitemap absente ou incorrecte");

      record("Finalisation des URL — canonical, og:url, og:image, sitemap et base cohérents, reportages compris (répertoire isolé)",
        probleme.length === 0, probleme.join(" ; "));

      // Relancé avec une autre adresse : les URL sont remplacées, jamais empilées.
      const AUTRE_BASE = "https://autre.invalid";
      await finaliser(AUTRE_BASE);
      const relance = [];
      for (const [page, attendu] of Object.entries(ogAttendus)) {
        const valeur = await ogImage(page);
        if (valeur !== attendu.replace(FAUX_BASE, AUTRE_BASE)) relance.push(`${page} : og:image = ${valeur}`);
      }
      const canoniqueRep = (await readFile(join(temp, REPORTAGE), "utf8")).match(/<link rel="canonical" href="([^"]*)">/)?.[1];
      if (canoniqueRep !== `${AUTRE_BASE}/${REPORTAGE}`) relance.push(`${REPORTAGE} : canonical = ${canoniqueRep}`);
      record("Finalisation des URL — une seconde exécution remplace l'adresse sans empiler les segments",
        relance.length === 0, relance.join(" ; "));

      const inchanges = [];
      for (const [nom, contenu] of avant) {
        const actuel = await readFile(nom, "utf8");
        if (actuel !== contenu) inchanges.push(nom);
      }
      record("Finalisation des URL — les fichiers de travail restent intacts",
        inchanges.length === 0, inchanges.join(" ; "));
    } finally {
      await rm(temp, { recursive: true, force: true }).catch(() => {});
    }
  }

  // --- 9. Page 404 servie sous une URL imbriquée inexistante ---------------
  // Cas réel de GitHub Pages : l'adresse demandée est conservée, de sorte que
  // les chemins relatifs se résoudraient depuis un répertoire qui n'existe pas.
  const URL_INTROUVABLE = `${BASE}/albums/2026/ete-inexistant`;

  const reponse404 = await fetch(URL_INTROUVABLE);
  record("404 — statut 404 renvoyé pour une URL imbriquée inexistante",
    reponse404.status === 404, String(reponse404.status));

  const SONDE_404 = `
    (async () => {
      const logo = document.querySelector(".brand__mark");
      const feuilles = [...document.styleSheets].filter((f) => f.href);
      let regles = 0;
      for (const feuille of feuilles) {
        try { regles += feuille.cssRules.length; } catch { /* inaccessible */ }
      }

      // Tous les liens non ancrés doivent résoudre depuis l'URL demandée.
      const casses = [];
      const liens = [...new Set([...document.querySelectorAll("a[href]")]
        .map((a) => a.href)
        .filter((h) => !h.includes("#")))];
      for (const href of liens) {
        try { if (!(await fetch(href, { method: "HEAD" })).ok) casses.push(href); }
        catch { casses.push(href); }
      }

      const skip = document.querySelector(".skip");
      return {
        feuilles: feuilles.length,
        regles,
        fond: getComputedStyle(document.body).backgroundColor,
        logoCharge: logo.complete && logo.naturalWidth > 0,
        accueil: new URL(document.querySelector(".brand").href).pathname,
        robots: document.querySelector('meta[name="robots"]')?.content ?? "",
        titre: document.querySelector("h1")?.textContent.trim() ?? "",
        skipHref: skip.href,
        casses,
      };
    })()`;

  await visitUrl(URL_INTROUVABLE, { width: 1440, height: 900, mobile: false, attente: 800 });
  const avecJs = await cdp.evaluate(SONDE_404);

  // Sans JavaScript : la base écrite en dur dans la page doit suffire, puisque
  // c'est l'état réel du déploiement GitHub Pages.
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: true });
  await visitUrl(URL_INTROUVABLE, { width: 1440, height: 900, mobile: false, attente: 800 });
  const sansJs = await cdp.evaluate(SONDE_404);
  await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });

  for (const [mode, releve] of [["avec JavaScript", avecJs], ["sans JavaScript", sansJs]]) {
    record(`404 imbriquée (${mode}) — les trois feuilles de style sont appliquées`,
      releve.feuilles === 3 && releve.regles > 0 && releve.fond === "rgb(10, 10, 11)",
      `${releve.feuilles} feuille(s), ${releve.regles} règle(s), fond ${releve.fond}`);
    record(`404 imbriquée (${mode}) — le logo est chargé`, releve.logoCharge === true);
    record(`404 imbriquée (${mode}) — les liens de navigation résolvent`,
      releve.casses.length === 0 && releve.accueil === `${SOUS_CHEMIN}/index.html`,
      `accueil ${releve.accueil} ; cassés : ${releve.casses.join(", ")}`);
    record(`404 imbriquée (${mode}) — statut noindex et contenu conservés`,
      releve.robots.includes("noindex") && releve.titre.length > 0,
      `${releve.robots} / « ${releve.titre} »`);

    // Le lien d'évitement doit rester sur la page 404 malgré <base>, qu'une
    // ancre nue ferait résoudre vers l'accueil (voir 404.html) — sans dépendre
    // de JavaScript pour corriger la cible.
    const skip = new URL(releve.skipHref);
    record(`404 imbriquée (${mode}) — le lien d'évitement reste sur la page 404`,
      skip.pathname === `${SOUS_CHEMIN}/404.html` && skip.hash === "#contenu",
      releve.skipHref);
  }

  // Servie directement, hors URL imbriquée, la page doit rester stylée : c'est
  // alors le script en ligne qui ramène la base au bon endroit.
  await visitUrl(`${BASE}/404.html`, { width: 1440, height: 900, mobile: false, attente: 600 });
  record("404 — servie directement, la page reste stylée et navigable",
    await cdp.evaluate(`
      [...document.styleSheets].filter((f) => f.href).length === 3
        && getComputedStyle(document.body).backgroundColor === "rgb(10, 10, 11)"
        && document.querySelector(".brand__mark").naturalWidth > 0`));

  record(`JavaScript — aucune exception ni console.error sur l'ensemble du parcours (${PAGES.length} pages)`,
    erreursJs.length === 0, [...new Set(erreursJs)].slice(0, 8).join(" ; "));
} finally {
  socket?.close();
  browser.kill();
  serveur?.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

for (const { name, passed, detail } of results) {
  console.log(`${passed ? "OK  " : "ECHEC"} ${name}${detail && !passed ? ` (${detail})` : ""}`);
}
const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies.`);
process.exit(failed ? 1 : 0);
