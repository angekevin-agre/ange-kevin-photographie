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
 * par le navigateur. Si <dialog> n'est pas disponible, la page retombe sur la
 * navigation en ligne (voir site.css, « html.no-dialog »).
 */
export function initMenu() {
  const dialog = document.querySelector("[data-menu]");
  const trigger = document.querySelector("[data-menu-open]");
  if (!dialog || !trigger) return;

  if (typeof dialog.showModal !== "function") {
    document.documentElement.classList.add("no-dialog");
    return;
  }

  trigger.addEventListener("click", () => dialog.showModal());
  dialog.addEventListener("close", () => trigger.focus({ preventScroll: true }));

  // Clic sur l'arrière-plan du dialogue.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.querySelector("[data-menu-close]")?.addEventListener("click", () => dialog.close());

  // Fermeture explicite après navigation, y compris sur une ancre interne.
  for (const link of dialog.querySelectorAll("a[href]")) {
    link.addEventListener("click", () => dialog.close());
  }
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
