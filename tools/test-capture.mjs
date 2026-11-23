/**
 * Tests de tools/capture.mjs : un blocage de Chrome ne doit jamais passer pour
 * une réussite.
 *
 *   node tools/test-capture.mjs
 *
 * Chrome est lancé pour de vrai. Le blocage est simulé par l'option de
 * diagnostic « --inject-stall » de capture.mjs : la N-ième capture d'écran ne
 * répond jamais, exactement comme lors du blocage observé sur les pages de
 * reportage.
 *
 *   1. capture normale : 1/1, code 0, fichier PNG non vide ;
 *   2. blocage ponctuel : le navigateur est relancé, la capture est reprise,
 *      le résultat est complet (code 0) et la reprise est annoncée ;
 *   3. blocage persistant : le résultat est incomplet, annoncé comme tel, avec
 *      le code de sortie 2 et le décompte exact des captures produites ;
 *   4. appareil inconnu : refus net, code 2, aucune capture.
 *
 * Aucune dépendance. Les ports de débogage et HTTP diffèrent de ceux de
 * check.mjs et de capture.mjs, pour pouvoir tourner à côté.
 */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEPOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CAPTURE = join(DEPOT, "tools", "capture.mjs");

const lancer = (args) => new Promise((resoudre) => {
  const debut = Date.now();
  const proc = spawn(process.execPath, [CAPTURE, "--port=9455", "--http=8155", ...args], { cwd: DEPOT, stdio: ["ignore", "pipe", "pipe"] });
  let sortie = "";
  proc.stdout.on("data", (d) => (sortie += d));
  proc.stderr.on("data", (d) => (sortie += d));
  // Filet : le test lui-même ne doit pas pouvoir rester bloqué.
  const filet = setTimeout(() => proc.kill("SIGKILL"), 120000);
  proc.once("exit", (code, signal) => { clearTimeout(filet); resoudre({ code: signal ? `signal ${signal}` : code, sortie, duree: Date.now() - debut }); });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const resultats = [];
const essai = async (nom, corps) => {
  const defauts = [];
  const dossier = await mkdtemp(join(tmpdir(), "akp-capture-"));
  try { await corps(dossier, defauts); } catch (erreur) { defauts.push(`exception : ${erreur.message}`); }
  finally { await rm(dossier, { recursive: true, force: true }).catch(() => {}); }
  resultats.push({ nom, defauts });
};

const pngs = async (dossier) => (await readdir(dossier)).filter((n) => n.endsWith(".png"));
const octetsValides = async (dossier, nom) => (await readFile(join(dossier, nom))).subarray(0, 4).equals(PNG);

const COMMUN = ["--pages=404.html", "--devices=desktop"];

await essai("Captures — exécution normale : 1/1, code 0, PNG valide", async (out, defauts) => {
  const r = await lancer([...COMMUN, `--out=${out}`]);
  if (r.code !== 0) defauts.push(`code ${r.code}`);
  if (!/1\/1 capture\(s\) produite\(s\)/.test(r.sortie)) defauts.push("décompte « 1/1 » absent");
  const fichiers = await pngs(out);
  if (fichiers.length !== 1) defauts.push(`${fichiers.length} PNG au lieu de 1`);
  else if (!(await octetsValides(out, fichiers[0]))) defauts.push("PNG invalide ou vide");
});

await essai("Captures — un blocage ponctuel de Chrome est réparé : navigateur relancé, capture reprise, code 0", async (out, defauts) => {
  const r = await lancer([...COMMUN, `--out=${out}`, "--inject-stall=1", "--timeout=2500"]);
  if (r.code !== 0) defauts.push(`code ${r.code} au lieu de 0 — ${r.sortie.trim().split("\n").slice(-3).join(" / ")}`);
  if (!/navigateur relancé/.test(r.sortie)) defauts.push("la relance du navigateur n'est pas annoncée");
  if (!/1\/1 capture\(s\) produite\(s\)/.test(r.sortie)) defauts.push("décompte « 1/1 » absent après reprise");
  if ((await pngs(out)).length !== 1) defauts.push("capture manquante après reprise");
  if (/RÉSULTAT INCOMPLET/.test(r.sortie)) defauts.push("annoncé incomplet à tort");
});

await essai("Captures — un blocage persistant donne un résultat INCOMPLET, code 2, jamais un succès", async (out, defauts) => {
  const r = await lancer([...COMMUN, `--out=${out}`, "--inject-stall=1,persist", "--timeout=2000"]);
  if (r.code !== 2) defauts.push(`code ${r.code} au lieu de 2`);
  if (!/RÉSULTAT INCOMPLET/.test(r.sortie)) defauts.push("« RÉSULTAT INCOMPLET » absent");
  if (!/0\/1 capture\(s\) produite\(s\)/.test(r.sortie)) defauts.push("décompte « 0/1 » absent");
  if (/Aucune erreur console/.test(r.sortie)) defauts.push("« aucune erreur » annoncé malgré l'échec");
  if (/\bok\s+404\.html/.test(r.sortie)) defauts.push("la page est annoncée « ok » malgré l'échec");
  if ((await pngs(out)).length !== 0) defauts.push("une capture existe malgré le blocage");
  if (typeof r.duree === "number" && r.duree > 100000) defauts.push(`trop long (${r.duree} ms) : les délais ne bornent pas`);
});

await essai("Captures — un appareil inconnu est refusé (code 2), sans capture", async (out, defauts) => {
  const r = await lancer(["--pages=404.html", "--devices=telephone-imaginaire", `--out=${out}`]);
  if (r.code !== 2) defauts.push(`code ${r.code} au lieu de 2`);
  if ((await pngs(out)).length !== 0) defauts.push("une capture a été produite");
});

let echecs = 0;
for (const { nom, defauts } of resultats) {
  console.log(`${defauts.length ? "ECHEC" : "OK   "} ${nom}${defauts.length ? ` (${defauts.join(" ; ")})` : ""}`);
  if (defauts.length) echecs++;
}
console.log(`\n${resultats.length - echecs}/${resultats.length} tests réussis.`);
process.exit(echecs ? 1 : 0);
