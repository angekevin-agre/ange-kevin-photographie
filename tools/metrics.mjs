/**
 * Mesure des indicateurs de performance, dans des conditions explicites.
 *
 *   python -m http.server 8123 --bind 127.0.0.1     (dans un autre terminal)
 *   node tools/metrics.mjs
 *
 * Conditions appliquées, alignées sur le profil mobile usuel :
 *   - viewport 390 × 844, émulation mobile ;
 *   - processeur bridé 4×  ;
 *   - réseau bridé à 1,6 Mb/s en réception, 750 kb/s en émission, 150 ms RTT ;
 *   - serveur local, cache vidé à chaque page.
 *
 * Ce n'est PAS un audit Lighthouse et ce ne sont PAS des données de terrain :
 * un hébergement réel ajoute la latence du CDN et la variabilité des appareils.
 * Les valeurs servent à comparer les pages entre elles et à détecter une
 * régression, pas à annoncer un score.
 *
 * INP n'est pas mesuré : il exige des interactions réelles d'utilisateurs.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "http://127.0.0.1:8123";
const PORT = 9355;
const PAGES = ["index.html", "portfolio.html", "evenements.html", "a-propos.html", "contact.html"];

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

/** Observateurs installés avant tout script de la page. */
const SONDE = `
  window.__mesures = { lcp: 0, cls: 0, fcp: 0 };
  new PerformanceObserver((liste) => {
    for (const e of liste.getEntries()) window.__mesures.lcp = e.startTime;
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((liste) => {
    for (const e of liste.getEntries()) if (!e.hadRecentInput) window.__mesures.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((liste) => {
    for (const e of liste.getEntries()) if (e.name === "first-contentful-paint") window.__mesures.fcp = e.startTime;
  }).observe({ type: "paint", buffered: true });
`;

class Devtools {
  #socket; #nextId = 0; #pending = new Map(); #handlers = new Map();
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
  async evaluate(expression) {
    const { result } = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    return result.value;
  }
}

const profile = await mkdtemp(join(tmpdir(), "akp-metrics-"));
const browser = spawn(CHROME, [
  "--headless", "--disable-gpu", "--no-sandbox", "--disable-extensions",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let socket;
const lignes = [];
try {
  let cible;
  for (let i = 0; i < 60 && !cible; i++) {
    try {
      const reponse = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (reponse.ok) cible = (await reponse.json()).find((t) => t.type === "page");
    } catch { /* pas encore prêt */ }
    if (!cible) await sleep(250);
  }
  if (!cible) throw new Error("Chrome n'a pas ouvert le port de débogage.");

  socket = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const cdp = new Devtools(socket);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SONDE });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });

  for (const page of PAGES) {
    await cdp.send("Network.clearBrowserCache");
    const charge = new Promise((resolve) => cdp.on("Page.loadEventFired", resolve));
    await cdp.send("Page.navigate", { url: `${BASE}/${page}` });
    await charge;
    await sleep(2500); // laisser les observateurs se stabiliser

    const mesure = await cdp.evaluate(`
      (() => {
        const ressources = performance.getEntriesByType("resource");
        const navigation = performance.getEntriesByType("navigation")[0];
        const octets = ressources.reduce((total, r) => total + (r.transferSize || 0), 0)
          + (navigation?.transferSize || 0);
        return {
          lcp: Math.round(window.__mesures.lcp),
          cls: Math.round(window.__mesures.cls * 1000) / 1000,
          fcp: Math.round(window.__mesures.fcp),
          requetes: ressources.length + 1,
          ko: Math.round(octets / 1024),
        };
      })()`);
    lignes.push({ page, ...mesure });
  }
} finally {
  socket?.close();
  browser.kill();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

const colonne = (v, n) => String(v).padStart(n);
console.log("\nMobile 390×844 · CPU ×4 · 1,6 Mb/s · RTT 150 ms · serveur local, cache vidé\n");
console.log("page                 FCP      LCP      CLS   requêtes    poids");
console.log("-".repeat(64));
for (const l of lignes) {
  console.log(
    `${l.page.padEnd(18)} ${colonne(l.fcp + " ms", 7)} ${colonne(l.lcp + " ms", 8)} ${colonne(l.cls, 8)} ${colonne(l.requetes, 10)} ${colonne(l.ko + " Ko", 8)}`
  );
}
const pireLcp = Math.max(...lignes.map((l) => l.lcp));
const pireCls = Math.max(...lignes.map((l) => l.cls));
console.log("-".repeat(64));
console.log(`LCP le plus élevé : ${pireLcp} ms (cible ≤ 2500 ms) — ${pireLcp <= 2500 ? "atteinte" : "NON atteinte"}`);
console.log(`CLS le plus élevé : ${pireCls} (cible ≤ 0,1) — ${pireCls <= 0.1 ? "atteinte" : "NON atteinte"}`);
console.log("INP non mesuré : il requiert des interactions réelles d'utilisateurs.");
console.log(
  "\nLe serveur de test (python -m http.server) répond en HTTP/1.1 sans\n" +
  "multiplexage : les requêtes se suivent au lieu de se superposer. Le LCP\n" +
  "mesuré est donc pessimiste par rapport à GitHub Pages, servi en HTTP/2."
);
