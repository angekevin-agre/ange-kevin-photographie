/**
 * Point d'entrée. Module différé par nature : il ne bloque pas le rendu.
 *
 * Aucune des fonctions appelées n'est requise pour accéder au contenu : si ce
 * fichier ne se charge pas, les pages restent lisibles et navigables (voir la
 * section « Langage de mouvement » de site.css et le repli « html:not(.js) »).
 */

import { initHeader, initMenu, initRail } from "./nav.js";
import { initReveal } from "./reveal.js";
import { initAlbums } from "./albums.js";

initHeader();
initMenu();
initRail();
initReveal();

// Les albums arrivent après le premier rendu : on leur applique la même
// révélation une fois insérés. Les autres états — liste vide, données
// invalides, fichier injoignable — sont annoncés par le module lui-même.
initAlbums().then(({ mount }) => {
  if (mount) initReveal(mount);
});
