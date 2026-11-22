/**
 * Révélation des photographies à l'entrée dans le viewport.
 *
 * Un seul IntersectionObserver par appel, chaque élément cessant d'être
 * observé après sa révélation : pas d'écouteur de défilement, pas de travail
 * résiduel. Les animations ne portent que sur opacity, transform et clip-path.
 *
 * @param {ParentNode} [root] Racine à parcourir. Permet de prendre en charge
 *   les éléments ajoutés après le premier rendu (albums chargés en JSON).
 */

const REDUCED = "(prefers-reduced-motion: reduce)";

export function initReveal(root = document) {
  // Signale au filet de sécurité du script en ligne que le module a démarré.
  // Le nom est distinct de « data-reveal » : cet attribut-là est un sélecteur
  // de style, le poser sur <html> masquerait la page entière.
  document.documentElement.dataset.revealReady = "on";

  const items = root.querySelectorAll("[data-reveal]:not(.is-revealed)");
  if (items.length === 0) return;

  const show = () => {
    for (const item of items) item.classList.add("is-revealed");
  };

  // Mouvement réduit ou API absente : le contenu est affiché immédiatement.
  if (!("IntersectionObserver" in window) || window.matchMedia(REDUCED).matches) {
    show();
    return;
  }

  const observer = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        obs.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.15 }
  );

  // Ce qui était déjà visible au chargement a été révélé par le court script
  // en ligne de fin de page, et le sélecteur ci-dessus l'exclut. Ne restent
  // ici que les éléments à révéler au défilement.
  for (const item of items) observer.observe(item);

  // Si la réduction des animations est activée en cours de visite, le contenu
  // restant est révélé sans attendre.
  window.matchMedia(REDUCED).addEventListener("change", (event) => {
    if (!event.matches) return;
    observer.disconnect();
    show();
  });
}
