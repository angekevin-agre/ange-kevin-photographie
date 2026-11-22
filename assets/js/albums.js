/**
 * Albums d'événements — point d'extension préparé pour PHOTO-02.
 *
 * Source unique : « assets/data/events.json ». L'accueil et la page
 * Événements consomment le même fichier, de sorte que publier une sélection
 * après un événement ne demande d'éditer aucune page HTML.
 *
 * Tant que ce fichier ne contient aucun album, la page conserve son état
 * d'attente écrit en HTML : rien n'est inventé, rien n'est masqué.
 *
 * Attributs du conteneur :
 *   data-albums        conteneur de rendu (obligatoire)
 *   data-limit="3"     nombre maximal d'albums (accueil)
 *   data-sizes="…"     valeur de l'attribut sizes des couvertures
 *
 * Un élément « [data-albums-status] » facultatif reçoit le compte rendu des
 * cas anormaux : fichier injoignable, données invalides, albums ignorés. Les
 * trois états sont distingués, de sorte qu'une panne de chargement ne soit
 * jamais présentée comme une absence d'album.
 *
 * Robustesse : les données sont validées avant le tri et le rendu. Un album
 * malformé, ou une déclinaison d'image malformée, est écarté individuellement ;
 * il ne peut pas faire disparaître les albums valides.
 *
 * Sécurité : le DOM est construit avec createElement et textContent. Aucune
 * donnée du fichier JSON n'est injectée via innerHTML.
 *
 * Hors du périmètre PHOTO-01, et donc volontairement absent : pages de détail
 * d'album, visionneuse, filtres, pagination.
 */

const SOURCE = "assets/data/events.json";

const CATEGORIES = {
  portraits: "Portraits",
  evenements: "Événements",
  ceremonies: "Cérémonies",
  reportages: "Reportages",
  autres: "Autres projets",
};

const MESSAGES = {
  erreur: "Les albums n'ont pas pu être chargés : le fichier des événements est injoignable.",
  invalide: "Les albums n'ont pas pu être affichés : les données des événements sont invalides.",
  partiel: (n) => `${n} album${n > 1 ? "s" : ""} ignoré${n > 1 ? "s" : ""} : données invalides.`,
};

const estTexte = (valeur) => typeof valeur === "string" && valeur.trim() !== "";
const estEntierPositif = (valeur) => Number.isInteger(valeur) && valeur > 0;

/**
 * Formate une date au format AAAA-MM-JJ.
 *
 * La date est reconstruite composante par composante, à minuit **local**.
 * « new Date("2026-10-18") » serait interprété comme minuit UTC : à l'ouest de
 * Greenwich, Intl.DateTimeFormat afficherait alors la veille — un décalage d'un
 * jour, par exemple à Los Angeles. Le format est volontairement strict : une
 * valeur non conforme est refusée plutôt que devinée.
 */
const formatDate = (valeur) => {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valeur ?? ""));
  if (!parts) return null;

  const [annee, mois, jour] = parts.slice(1).map(Number);
  const date = new Date(annee, mois - 1, jour);
  // Rejette les dates inexistantes (31 février), que Date reporterait au mois
  // suivant sans rien signaler.
  if (date.getFullYear() !== annee || date.getMonth() !== mois - 1 || date.getDate() !== jour) {
    return null;
  }

  return {
    iso: `${parts[1]}-${parts[2]}-${parts[3]}`,
    label: new Intl.DateTimeFormat("fr-FR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date),
  };
};

/**
 * N'accepte qu'un chemin relatif ou une adresse http(s). Le fichier JSON est
 * versionné avec le site, mais une valeur comme « javascript:… » affectée à
 * href ou src resterait un vecteur d'exécution : autant la refuser ici.
 */
const lienSur = (valeur) => {
  if (typeof valeur !== "string" || valeur.trim() === "") return null;
  try {
    const url = new URL(valeur, document.baseURI);
    return url.protocol === "http:" || url.protocol === "https:" ? valeur : null;
  } catch {
    return null;
  }
};

/**
 * Valide une photographie et en renvoie une copie normalisée, ou null.
 * Les dimensions sont exigées : sans elles, l'emplacement de l'image n'est pas
 * réservé et la mise en page saute au chargement.
 */
const photoValide = (photo) => {
  if (!photo || typeof photo !== "object") return null;
  const src = lienSur(photo.src);
  if (!src || !estEntierPositif(photo.width) || !estEntierPositif(photo.height)) return null;

  // Une déclinaison malformée est écartée seule : la couverture reste servie.
  const variants = (Array.isArray(photo.variants) ? photo.variants : []).filter(
    (v) => v && typeof v === "object" && lienSur(v.src) && estEntierPositif(v.width)
  );

  return {
    src,
    width: photo.width,
    height: photo.height,
    alt: typeof photo.alt === "string" ? photo.alt : "",
    variants,
  };
};

/**
 * Valide un album et en renvoie une copie normalisée, ou null.
 *
 * Exigences : un objet, un titre non vide, une date lisible si le champ est
 * présent (elle sert au tri), une couverture valide si le champ est présent.
 * Les champs facultatifs mal typés sont ignorés sans invalider l'album.
 */
const albumValide = (album) => {
  if (!album || typeof album !== "object" || Array.isArray(album)) return null;
  if (!estTexte(album.title)) return null;

  const dateFournie = album.date !== undefined && album.date !== null;
  const date = dateFournie ? formatDate(album.date) : null;
  if (dateFournie && !date) return null;

  const coverFournie = album.cover !== undefined && album.cover !== null;
  const cover = coverFournie ? photoValide(album.cover) : null;
  if (coverFournie && !cover) return null;

  return {
    title: album.title.trim(),
    date,
    cover,
    url: lienSur(album.url),
    category: estTexte(album.category) ? album.category : null,
    description: estTexte(album.description) ? album.description.trim() : null,
    nombrePhotos: Array.isArray(album.photos) ? album.photos.length : 0,
  };
};

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/**
 * Construit l'image de couverture. « variants » est facultatif : s'il est
 * fourni, srcset et sizes sont renseignés pour servir la largeur utile.
 */
function buildCover(cover, sizes) {
  const image = document.createElement("img");
  image.src = cover.src;
  image.width = cover.width;
  image.height = cover.height;
  image.alt = cover.alt;
  image.loading = "lazy";
  image.decoding = "async";

  if (cover.variants.length > 0) {
    image.srcset = cover.variants.map((v) => `${v.src} ${v.width}w`).join(", ");
    if (sizes) image.sizes = sizes;
  }
  return image;
}

function buildAlbum(album, sizes) {
  const article = el("article", "album plate");
  article.dataset.reveal = "wipe";

  const frame = album.url ? el("a", "plate__frame") : el("div", "plate__frame");
  if (album.url) {
    frame.href = album.url;
    frame.setAttribute("aria-label", `Voir l'album ${album.title}`);
  }
  if (album.cover) frame.append(buildCover(album.cover, sizes));
  article.append(frame);

  const heading = el("h3", "album__title");
  if (album.url) {
    const ancre = el("a", null, album.title);
    ancre.href = album.url;
    heading.append(ancre);
  } else {
    heading.textContent = album.title;
  }
  article.append(heading);

  const meta = el("p", "plate__caption mono");
  if (album.date) {
    const time = el("time", null, album.date.label);
    time.dateTime = album.date.iso;
    meta.append(time);
  }
  const facts = [
    album.category ? (CATEGORIES[album.category] ?? album.category) : null,
    album.nombrePhotos > 0 ? `${album.nombrePhotos} photographies` : null,
  ].filter(Boolean);
  for (const fact of facts) meta.append(el("span", null, fact));
  article.append(meta);

  if (album.description) article.append(el("p", "album__desc", album.description));

  return article;
}

/** Affiche, ou masque, le compte rendu destiné au visiteur. */
function annoncer(message) {
  const status = document.querySelector("[data-albums-status]");
  if (!status) return;
  if (message) {
    status.textContent = message;
    status.hidden = false;
  } else {
    status.hidden = true;
  }
}

/**
 * @returns {Promise<{mount: HTMLElement|null, etat: string, rejetes: number}>}
 *   « etat » vaut « rendu », « vide », « invalide », « erreur » ou « absent ».
 *   « mount » n'est renseigné qu'en cas de rendu, pour que l'appelant puisse y
 *   réappliquer la révélation au défilement.
 */
export async function initAlbums() {
  const mount = document.querySelector("[data-albums]");
  if (!mount) return { mount: null, etat: "absent", rejetes: 0 };

  let payload;
  try {
    const response = await fetch(SOURCE, { cache: "no-cache" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
  } catch {
    // Fichier absent, réseau coupé, JSON illisible, ou protocole file:.
    annoncer(MESSAGES.erreur);
    return { mount: null, etat: "erreur", rejetes: 0 };
  }

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.albums)) {
    annoncer(MESSAGES.invalide);
    return { mount: null, etat: "invalide", rejetes: 0 };
  }

  if (payload.albums.length === 0) {
    annoncer(null); // L'état d'attente écrit en HTML reste affiché.
    return { mount: null, etat: "vide", rejetes: 0 };
  }

  // Validation avant tri et rendu : un album malformé est écarté seul.
  const valides = [];
  let rejetes = 0;
  for (const brut of payload.albums) {
    const album = albumValide(brut);
    if (album) valides.push(album);
    else rejetes++;
  }

  if (valides.length === 0) {
    annoncer(MESSAGES.invalide);
    return { mount: null, etat: "invalide", rejetes };
  }

  // Du plus récent au plus ancien, puis troncature éventuelle (accueil).
  // Un album sans date passe en dernier plutôt que de brouiller le tri.
  valides.sort((a, b) => String(b.date?.iso ?? "").localeCompare(String(a.date?.iso ?? "")));
  const limit = Number.parseInt(mount.dataset.limit ?? "", 10);
  const selection = Number.isInteger(limit) && limit > 0 ? valides.slice(0, limit) : valides;

  const fragment = document.createDocumentFragment();
  for (const album of selection) fragment.append(buildAlbum(album, mount.dataset.sizes));

  const fallback = document.querySelector("[data-albums-empty]");
  if (fallback) fallback.hidden = true;

  mount.replaceChildren(fragment);
  mount.hidden = false;
  annoncer(rejetes > 0 ? MESSAGES.partiel(rejetes) : null);
  return { mount, etat: "rendu", rejetes };
}
