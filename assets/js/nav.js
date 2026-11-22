/**
 * Navigation : état de l'entête, menu mobile, rail de catégories.
 * Chaque fonction est inopérante si son balisage est absent de la page.
 */

/**
 * Condense l'entête dès que la page a défilé.
 * Un repère de 1px placé juste après l'entête évite tout écouteur de scroll.
 */
export function initHeader() {
  const header = document.querySelector("[data-header]");
  const sentinel = document.querySelector("[data-header-sentinel]");
  if (!header || !sentinel || !("IntersectionObserver" in window)) return;

  new IntersectionObserver(
    ([entry]) => header.classList.toggle("is-pinned", !entry.isIntersecting),
    { threshold: 0 }
  ).observe(sentinel);
}

/**
 * Menu mobile bâti sur <dialog> en mode modal : piégeage du focus, fermeture
 * par Échap, arrière-plan rendu inerte et annonce de rôle sont pris en charge
 * par le navigateur.
 *
 * Amélioration progressive : la rangée de liens de l'entête est l'état par
 * défaut du balisage et de la feuille de style. Ce n'est qu'une fois le menu
 * entièrement câblé que « html.js-menu » est posée, laissant alors le bouton
 * remplacer la rangée en mobile (voir site.css, section 1). Si ce module n'est
 * pas chargé, ou si <dialog> n'est pas pris en charge, la classe n'est jamais
 * posée et la navigation reste atteignable.
 */
export function initMenu() {
  const dialog = document.querySelector("[data-menu]");
  const trigger = document.querySelector("[data-menu-open]");
  if (!dialog || !trigger) return;

  // <dialog> non pris en charge : la rangée de repli reste en place.
  if (typeof dialog.showModal !== "function") return;

  trigger.setAttribute("aria-controls", dialog.id);
  trigger.setAttribute("aria-expanded", "false");

  trigger.addEventListener("click", () => {
    dialog.showModal();
    trigger.setAttribute("aria-expanded", "true");
  });
  dialog.addEventListener("close", () => {
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus({ preventScroll: true });
  });

  // Clic sur l'arrière-plan du dialogue.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.querySelector("[data-menu-close]")?.addEventListener("click", () => dialog.close());

  // Fermeture explicite après navigation, y compris sur une ancre interne.
  for (const link of dialog.querySelectorAll("a[href]")) {
    link.addEventListener("click", () => dialog.close());
  }

  // Dernière instruction : la bascule d'interface n'a lieu qu'une fois tout
  // le comportement en place. Un échec plus haut laisse la rangée visible.
  document.documentElement.classList.add("js-menu");
}

/**
 * Rail de catégories : marque le lien correspondant à la section visible.
 * aria-current renseigne le lecteur d'écran autant que le repère visuel.
 */
export function initRail() {
  const links = [...document.querySelectorAll("[data-rail] a[href^='#']")];
  if (links.length === 0 || !("IntersectionObserver" in window)) return;

  const sections = new Map();
  for (const link of links) {
    const target = document.getElementById(decodeURIComponent(link.hash.slice(1)));
    if (target) sections.set(target, link);
  }
  if (sections.size === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links) link.removeAttribute("aria-current");
        sections.get(entry.target)?.setAttribute("aria-current", "true");
      }
    },
    { rootMargin: "-45% 0px -50% 0px" }
  );

  for (const section of sections.keys()) observer.observe(section);
}
