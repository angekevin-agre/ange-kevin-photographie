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
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { lancerServeur } from "./serve.mjs";

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

const PAGES = ["index.html", "portfolio.html", "evenements.html", "a-propos.html", "contact.html", "404.html"];

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

// --- 0 bis. Serveur statique, aux conditions de GitHub Pages --------------
const serveur = BASE_EXTERNE
  ? null
  : (await lancerServeur({ port: PORT_HTTP, prefix: SOUS_CHEMIN })).serveur;

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

  const visitUrl = async (url, { width = 390, height = 844, mobile = true, reducedMotion = false, attente = 500 } = {}) => {
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

  await cdp.send("Emulation.setScriptExecutionDisabled", { value: false });

  // --- 3 bis. Contrastes WCAG, réellement calculés -------------------------
  await visit("index.html", { width: 1440, height: 900, mobile: false });
  const contrastes = await cdp.evaluate(`
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
      const cibles = [".lead", ".eyebrow", ".plate__caption", ".nav__list a", ".section__note",
                      ".site-footer__legal p", ".link", ".prose p", ".pending", ".strip__hint"];
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
  const pire = contrastes.reduce((min, c) => (c.ratio < min.ratio ? c : min), { ratio: 99, selecteur: "—" });
  record(`Contraste — texte courant ≥ 4,5:1 (minimum relevé ${pire.ratio}:1 sur ${pire.selecteur})`,
    pire.ratio >= 4.5);

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
  await visit("index.html", { width: 390, height: 844 });
  const cibles = await cdp.evaluate(`
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
      .map(({ el }) => el.tagName.toLowerCase() + "." + (el.getAttribute("class") || "sans-classe"))`);
  record("Cibles — toutes les commandes mesurent au moins 24 px",
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
  // L'URL publique n'étant pas confirmée, canonical et og:url doivent rester
  // ABSENTS : une adresse supposée puis corrigée désoriente les moteurs. Ce
  // test fige ce choix, et échouera si l'on publie une URL par inadvertance
  // sans passer par tools/finalize-urls.mjs.
  const metadonnees = [];
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

    const exige = {
      ogType: "website", ogSite: "Ange Kevin Photographie", ogLocale: "fr_FR",
      twitter: "summary_large_image", theme: "#0a0a0b",
    };
    for (const [cle, attendu] of Object.entries(exige)) {
      if (releve[cle] !== attendu) metadonnees.push(`${file} : ${cle} = ${releve[cle]}`);
    }
    for (const cle of ["ogTitre", "ogDescription", "ogImage", "ogImageAlt", "favicon"]) {
      if (!releve[cle]) metadonnees.push(`${file} : ${cle} absent`);
    }
    if (!releve.ldValide) metadonnees.push(`${file} : JSON-LD illisible`);
    if (releve.ld && releve.ld["@context"] !== "https://schema.org") {
      metadonnees.push(`${file} : JSON-LD sans contexte schema.org`);
    }
    if (releve.canonical) metadonnees.push(`${file} : canonical publié avant confirmation de l'URL (${releve.canonical})`);
    if (releve.ogUrl) metadonnees.push(`${file} : og:url publié avant confirmation de l'URL (${releve.ogUrl})`);
    if (file === "404.html" && !(releve.robots ?? "").includes("noindex")) {
      metadonnees.push("404.html : directive noindex absente");
    }
    if (file !== "404.html" && (releve.robots ?? "").includes("noindex")) {
      metadonnees.push(`${file} : noindex posé à tort`);
    }
  }
  record(`SEO — métadonnées de partage et données structurées (${PAGES.length} pages)`,
    metadonnees.length === 0, metadonnees.join(" ; "));

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
        skipAncre: skip.getAttribute("href"),
        skipCible: skip.hash === "#contenu" && !!document.getElementById("contenu"),
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
  }

  // Le lien d'évitement doit rester une ancre interne malgré <base>.
  record("404 imbriquée — le lien d'évitement reste une ancre de la page courante",
    avecJs.skipCible === true && avecJs.skipAncre.startsWith(`${SOUS_CHEMIN}/albums/2026/`),
    avecJs.skipAncre);

  // Servie directement, hors URL imbriquée, la page doit rester stylée : c'est
  // alors le script en ligne qui ramène la base au bon endroit.
  await visitUrl(`${BASE}/404.html`, { width: 1440, height: 900, mobile: false, attente: 600 });
  record("404 — servie directement, la page reste stylée et navigable",
    await cdp.evaluate(`
      [...document.styleSheets].filter((f) => f.href).length === 3
        && getComputedStyle(document.body).backgroundColor === "rgb(10, 10, 11)"
        && document.querySelector(".brand__mark").naturalWidth > 0`));
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
