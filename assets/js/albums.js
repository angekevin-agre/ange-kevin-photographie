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

const formatDate = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return null;
  return {
    iso,
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
  const source = lienSur(cover.src);
  if (!source) return null;

  const image = document.createElement("img");
  image.src = source;
  image.width = cover.width;
  image.height = cover.height;
  image.alt = cover.alt ?? "";
  image.loading = "lazy";
  image.decoding = "async";

  const variantes = (Array.isArray(cover.variants) ? cover.variants : [])
    .filter((v) => lienSur(v.src) && Number.isFinite(v.width));
  if (variantes.length > 0) {
    image.srcset = variantes.map((v) => `${v.src} ${v.width}w`).join(", ");
    if (sizes) image.sizes = sizes;
  }
  return image;
}

function buildAlbum(album, sizes) {
  const article = el("article", "album plate");
  article.dataset.reveal = "wipe";

  const lien = lienSur(album.url);
  const frame = lien ? el("a", "plate__frame") : el("div", "plate__frame");
  if (lien) {
    frame.href = lien;
    frame.setAttribute("aria-label", `Voir l'album ${album.title}`);
  }
  const couverture = album.cover ? buildCover(album.cover, sizes) : null;
  if (couverture) frame.append(couverture);
  article.append(frame);

  const heading = el("h3", "album__title");
  if (lien) {
    const ancre = el("a", null, album.title);
    ancre.href = lien;
    heading.append(ancre);
  } else {
    heading.textContent = album.title;
  }
  article.append(heading);

  const meta = el("p", "plate__caption mono");
  const date = album.date ? formatDate(album.date) : null;
  if (date) {
    const time = el("time", null, date.label);
    time.dateTime = date.iso;
    meta.append(time);
  }
  const facts = [
    CATEGORIES[album.category] ?? album.category,
    Array.isArray(album.photos) && album.photos.length > 0
      ? `${album.photos.length} photographies`
      : null,
  ].filter(Boolean);
  for (const fact of facts) meta.append(el("span", null, fact));
  article.append(meta);

  if (album.description) article.append(el("p", "album__desc", album.description));

  return article;
}

/**
 * @returns {Promise<HTMLElement|null>} Le conteneur rempli, pour que l'appelant
 *   puisse y réappliquer la révélation au défilement, ou null si rien n'a été
 *   rendu.
 */
export async function initAlbums() {
  const mount = document.querySelector("[data-albums]");
  if (!mount) return null;

  let payload;
  try {
    const response = await fetch(SOURCE, { cache: "no-cache" });
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null; // Hors serveur HTTP (protocole file:) ou fichier absent.
  }

  const albums = Array.isArray(payload?.albums) ? payload.albums : [];
  if (albums.length === 0) return null; // L'état d'attente en HTML reste affiché.

  // Du plus récent au plus ancien, puis troncature éventuelle (accueil).
  const ordered = [...albums].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const limit = Number.parseInt(mount.dataset.limit ?? "", 10);
  const selection = Number.isInteger(limit) && limit > 0 ? ordered.slice(0, limit) : ordered;

  const fragment = document.createDocumentFragment();
  for (const album of selection) {
    if (!album?.title) continue;
    fragment.append(buildAlbum(album, mount.dataset.sizes));
  }
  if (!fragment.childElementCount) return null;

  const fallback = document.querySelector("[data-albums-empty]");
  if (fallback) fallback.hidden = true;

  mount.replaceChildren(fragment);
  mount.hidden = false;
  return mount;
}
