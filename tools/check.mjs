/**
 * Vérifications fonctionnelles et d'accessibilité, exécutées dans Chrome.
 *
 *   python -m http.server 8123 --bind 127.0.0.1     (dans un autre terminal)
 *   node tools/check.mjs
 *
 * Couvre ce qu'une relecture de code ne peut pas établir : le menu mobile
 * s'ouvre et se ferme réellement, le focus est restitué, le lien d'évitement
 * devient visible, les photographies restent accessibles quand les animations
 * sont désactivées, et le rail de catégories suit la lecture.
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

const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "http://127.0.0.1:8123";
const PORT = 9333;

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

  const visit = async (file, { width = 390, height = 844, mobile = true, reducedMotion = false, attente = 500 } = {}) => {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile,
    });
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }],
    });
    const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
    await cdp.send("Page.navigate", { url: `${BASE}/${file}` });
    await loaded;
    await sleep(attente);
  };

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

  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*events.json*" }] });
  cdp.on("Fetch.requestPaused", ({ requestId }) => {
    cdp.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(JSON.stringify(JEU_ESSAI), "utf8").toString("base64"),
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
  await cdp.send("Network.setBlockedURLs", { urls: [] });

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
} finally {
  socket?.close();
  browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

for (const { name, passed, detail } of results) {
  console.log(`${passed ? "OK  " : "ECHEC"} ${name}${detail && !passed ? ` (${detail})` : ""}`);
}
const failed = results.filter((r) => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} vérifications réussies.`);
process.exit(failed ? 1 : 0);
