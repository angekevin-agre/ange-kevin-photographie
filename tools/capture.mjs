/**
 * Captures d'écran et relevé de console, via le protocole DevTools de Chrome.
 *
 *   python -m http.server 8123 --bind 127.0.0.1     (dans un autre terminal)
 *   node tools/capture.mjs
 *
 * Options :
 *   --base=http://127.0.0.1:8123   racine du serveur local
 *   --out=.captures                répertoire de sortie (ignoré par Git)
 *   --port=9222                    port de débogage
 *
 * Pourquoi le protocole DevTools plutôt que « chrome --screenshot » : sous
 * Windows, Chrome impose une largeur de fenêtre minimale d'environ 500 px.
 * Une capture demandée à 390 px est alors un recadrage d'un rendu plus large,
 * donc trompeuse. Emulation.setDeviceMetricsOverride impose la largeur réelle.
 *
 * Aucune dépendance : WebSocket et fetch sont natifs depuis Node 22.
 * Chrome est localisé via CHROME_PATH ou les emplacements usuels.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const arg = (name, fallback) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? fallback;

const BASE = arg("base", "http://127.0.0.1:8123");
const OUT = arg("out", ".captures");
const PORT = Number(arg("port", "9222"));

const PAGES = ["index.html", "portfolio.html", "evenements.html", "a-propos.html", "contact.html", "404.html"];

/** Appareils de référence, alignés sur les largeurs auditées. */
const DEVICES = [
  { id: "mobile", width: 390, height: 844, scale: 2, mobile: true },
  { id: "tablette", width: 768, height: 1024, scale: 2, mobile: true },
  { id: "desktop", width: 1440, height: 900, scale: 1, mobile: false },
];

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
      this.handlers.get(message.method)?.forEach((fn) => fn(message.params));
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
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
}

async function waitForEndpoint() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      /* le navigateur n'écoute pas encore */
    }
    await sleep(250);
  }
  throw new Error("Chrome n'a pas ouvert le port de débogage.");
}

// Chrome exige un chemin absolu pour son profil.
const profile = resolve(OUT, "chrome-profile");
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const browser = spawn(CHROME, [
  "--headless",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-extensions",
  "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
browser.stderr.on("data", (d) => process.env.CAPTURE_DEBUG && process.stderr.write(d));
browser.on("error", (e) => console.error("lancement de Chrome impossible :", e.message));

const problems = [];
let socket;

try {
  await waitForEndpoint();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const cdp = new Devtools(socket);
  let current = "";

  cdp.on("Runtime.consoleAPICalled", ({ type, args }) => {
    if (type !== "error" && type !== "warning") return;
    problems.push(`${current} — console.${type} : ${args.map((a) => a.value ?? a.description ?? a.type).join(" ")}`);
  });
  cdp.on("Runtime.exceptionThrown", ({ exceptionDetails }) => {
    problems.push(`${current} — exception : ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  });
  cdp.on("Log.entryAdded", ({ entry }) => {
    if (entry.level === "error") problems.push(`${current} — ${entry.source} : ${entry.text}`);
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");

  for (const device of DEVICES) {
    for (const file of PAGES) {
      current = `${file} @${device.width}px`;
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: device.width,
        height: device.height,
        deviceScaleFactor: device.scale,
        mobile: device.mobile,
      });

      const loaded = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
      await cdp.send("Page.navigate", { url: `${BASE}/${file}` });
      await loaded;
      await sleep(600); // séquence d'entrée

      // Parcourt la page pour déclencher les révélations au défilement, puis
      // revient en haut : sans cela, une capture pleine page montrerait les
      // photographies encore masquées.
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
      });

      const metrics = await cdp.send("Page.getLayoutMetrics");
      const { clientWidth } = metrics.cssLayoutViewport;
      const contentWidth = Math.round(metrics.contentSize.width);
      if (contentWidth > clientWidth + 1) {
        problems.push(`${current} — débordement horizontal : ${contentWidth}px > ${clientWidth}px`);
      }

      const { data } = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
      });
      const name = `${file.replace(/\.html$/, "")}-${device.id}.png`;
      await writeFile(join(OUT, name), Buffer.from(data, "base64"));
      process.stdout.write(`  ${name}\n`);
    }
  }
} finally {
  socket?.close();
  browser.kill();
}

console.log(problems.length ? `\n${problems.length} anomalie(s) :\n- ${problems.join("\n- ")}` : "\nAucune erreur console, aucun débordement.");
