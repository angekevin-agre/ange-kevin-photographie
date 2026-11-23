# Ange Kevin Photographie

Portfolio photographique éditorial : portraits, cérémonies, événements et
reportages. Site statique, sans dépendance ni étape de build, destiné à
GitHub Pages.

> **État du projet.** Le site compte **sept pages HTML** : cinq pages
> principales, la page 404 et une page de reportage générée. **PHOTO-01** a
> posé la direction artistique, les cinq pages principales, le langage
> d'animation, le socle SEO, l'accessibilité et la
> structure de données des événements. **PHOTO-02** ajoute les **reportages
> photographiques** : une architecture réutilisable (une source de données par
> reportage, des pages statiques générées) et un premier récit, *Florent — Une
> célébration, une histoire*, avec 25 photographies du photographe. Le logo
> définitif remplace la marque provisoire. Le récit de la page À propos et les
> coordonnées professionnelles restent à fournir — rien n'a été inventé pour
> combler ces vides.

---

## Sommaire

- [Direction artistique](#direction-artistique)
- [Stack technique](#stack-technique)
- [Architecture](#architecture)
- [Ce qui est développé](#ce-qui-est-développé)
- [Animations et interactions](#animations-et-interactions)
- [Accessibilité](#accessibilité)
- [Référencement](#référencement)
- [Performance](#performance)
- [Reportages](#reportages)
- [Ajouter des photographies](#ajouter-des-photographies)
- [Lancer le site en local](#lancer-le-site-en-local)
- [Tests et vérifications](#tests-et-vérifications)
- [Déploiement GitHub Pages](#déploiement-github-pages)
- [Workflow Git](#workflow-git)
- [Prochaines évolutions](#prochaines-évolutions)
- [Limites connues](#limites-connues)
- [Licence et crédits](#licence-et-crédits)

---

## Direction artistique

La direction retenue, « Chambre Claire », emprunte son vocabulaire au tirage
photographique plutôt qu'aux conventions du web : repères de vue en
caractères à chasse fixe, rebord de tirage autour de chaque image, bande
d'essai tonale, folios de section, filets de 1 pixel. Aucun angle arrondi,
aucun dégradé décoratif, aucune ombre portée — la structure est portée par le
filet et par l'espace.

Trois directions ont été comparées avant de coder ; celle-ci a été retenue
parce qu'elle reste reconnaissable sans dépendre d'une tendance, qu'elle met
les photographies en valeur sur fond encre, et qu'elle fournit un langage de
mouvement cohérent : l'image qui **se développe**, plutôt qu'un empilement
d'effets.

Quelques partis pris concrets :

| Décision | Raison |
| --- | --- |
| Piles de polices système, aucune requête de police | Zéro requête réseau, zéro décalage de rendu. Le serif humaniste (Palatino / Iowan Old Style) porte l'identité, le monospace porte les métadonnées. |
| Fond encre `#0a0a0b`, texte papier `#f2efe8` | 16,4:1 de contraste ; une photographie posée dessus n'entre en concurrence avec rien. |
| Accent ambre employé pour les filets et repères, variante plus claire pour le texte | L'ambre de base n'atteint pas 4,5:1 en texte ; deux jetons distincts évitent l'erreur. |
| Compositions nommées plutôt qu'une grille d'utilitaires | Cinq mises en page explicites (`--lead`, `--duo`, `--trio`, `--spread`, `--albums`) au lieu de cartes répétées. |

Le design system complet — couleurs, échelle typographique fluide,
espacements, règles de mouvement — tient dans
[`assets/css/tokens.css`](assets/css/tokens.css), qui en est la source unique.

---

## Stack technique

HTML, CSS et JavaScript, sans framework et sans étape de compilation.

- **HTML5 sémantique**, une page par section du site.
- **CSS moderne** : variables personnalisées, `grid`, `clamp()` pour une
  typographie fluide, `color-mix()`, `:has()`, `@starting-style`,
  `@view-transition` pour les transitions entre pages, `animation-timeline:
  scroll()` pour la barre de progression.
- **JavaScript en modules ES**, sans dépendance : 4 fichiers, 17,9 Ko au total
  avant compression.
- **Node.js 22.4 ou plus récent** pour les scripts de `tools/` (serveur local,
  tests, captures, mesures, génération des emplacements) : ils utilisent les
  `fetch` et `WebSocket` natifs. Aucun `package.json`, aucun `node_modules` :
  rien à installer. Les scripts de test pilotent **Chrome**, localisé
  automatiquement ou désigné par `CHROME_PATH`.

Poids de la couche CSS + JS, mesuré sur les fichiers le 23 novembre 2026
(1 Ko = 1 024 octets ; « gzip » = `gzip -9`, fichier par fichier) :

| | Non compressé | gzip -9 |
| --- | --- | --- |
| CSS (3 feuilles) | 51,0 Ko | 15,0 Ko |
| JS (4 modules) | 17,9 Ko | 7,5 Ko |
| **Total** | **68,9 Ko** | **22,5 Ko** |

soit 1 895 lignes, commentaires compris. GitHub Pages compresse les réponses ;
le serveur de test, non.

---

## Architecture

```
.
├── index.html              Accueil — hero, sélection, événements, présentation, contact
├── portfolio.html          Portfolio par catégorie, avec rail d'index collant
├── evenements.html         Événements couverts, alimenté par events.json
├── a-propos.html           Gabarit en quatre chapitres, prêt à recevoir le récit
├── contact.html            Moyens de contact (sans formulaire, sans serveur)
├── 404.html                Page d'erreur servie par GitHub Pages, sous n'importe quelle URL
├── robots.txt              Exploration autorisée — sans effet sous un sous-chemin (voir le fichier)
├── .nojekyll               Publication des fichiers tels quels
│
├── reportages/
│   └── florent.html        Page de reportage — GÉNÉRÉE, ne pas modifier à la main
│
├── content/
│   ├── site.json           Adresse publique confirmée — écrit par finalize-urls.mjs (absent tant qu'elle ne l'est pas)
│   └── reportages/
│       ├── florent.json            Récit, chapitres, photographies, textes alternatifs
│       └── reportage.schema.json   Schéma documentant chaque champ
│
├── assets/
│   ├── css/
│   │   ├── tokens.css      Design system : couleurs, typographie, espacements, mouvement
│   │   ├── base.css        Remise à zéro, typographie de base, accessibilité, utilitaires
│   │   └── site.css        Structure, composants, langage de mouvement
│   ├── js/
│   │   ├── main.js         Point d'entrée, câble les modules
│   │   ├── nav.js          État de l'entête, menu mobile, rail de catégories
│   │   ├── reveal.js       Révélation des photographies au défilement
│   │   └── albums.js       Rendu des albums depuis events.json
│   ├── data/
│   │   ├── events.json     Source unique des événements publiés
│   │   └── events.schema.json  Schéma JSON documentant chaque champ
│   └── img/
│       ├── brand/          Logo fourni par le photographe : original (PNG) et déclinaisons WebP
│       ├── reportages/
│       │   └── florent/    Formats web des 25 photographies + manifest.json (GÉNÉRÉS)
│       ├── favicon.svg
│       ├── og-cover.png    Visuel de partage, 1200 × 630
│       └── placeholders/   Emplacements photographiques (8 formats)
│
└── tools/                  Scripts Node sans dépendance
    ├── serve.mjs           Serveur local reproduisant GitHub Pages (sous-chemin, 404)
    ├── check.mjs           Vérifications dans Chrome : fonctionnel, accessibilité, SEO, responsive, reportages
    ├── test-reportages.mjs Tests sans navigateur : validation, injections HTML, slug, fraîcheur des images, SEO
    ├── test-capture.mjs    Tests de capture.mjs : blocage de Chrome simulé, code de sortie
    ├── capture.mjs         Captures d'écran, 3 appareils, relevé de console, reprise sur blocage
    ├── metrics.mjs         Mesure LCP, CLS, FCP, poids et requêtes
    ├── finalize-urls.mjs   Pose canonical, og:url, sitemap.xml, la base de 404.html, et mémorise l'adresse
    ├── site-config.mjs     Adresse publique : lecture, validation, URL (partagée par les outils)
    ├── make-placeholders.mjs  Génère les emplacements SVG
    ├── reportages-lib.mjs  Validation des reportages et des manifestes, paramètres de conversion (partagée)
    ├── optimize-photos.mjs Formats web d'un reportage, depuis les originaux (lecture seule)
    └── build-reportages.mjs  Génère les pages de reportage et leurs cartes du portfolio
```

**Choix structurants**

- *Pages HTML indépendantes.* Sans générateur de site, l'entête, le pied de
  page et le menu sont dupliqués dans les six pages écrites à la main (les
  cinq pages principales et la 404) ; la page de reportage les reçoit de son
  générateur. C'est le compromis assumé d'un site sans build : le
  référencement et le fonctionnement sans JavaScript sont préservés, au prix
  d'une modification à répercuter six fois, plus une dans le générateur. Un générateur statique reste possible si le nombre de pages croît.
- *Trois feuilles de style, pas une de plus.* Les jetons sont isolés pour
  qu'une évolution d'identité ne touche qu'un fichier.
- *Chemins relatifs partout, à une exception documentée.* Aucun chemin absolu,
  afin que le site fonctionne sous le sous-répertoire de GitHub Pages comme à
  la racine d'un domaine. L'exception est `404.html` : GitHub Pages la sert
  pour **n'importe quelle** URL inexistante, y compris imbriquée
  (`/<dépôt>/albums/2026/ete`), en conservant l'adresse demandée. Les chemins
  relatifs s'y résoudraient alors depuis un répertoire inexistant. La page
  porte donc une balise `<base>` écrite en dur sur le sous-chemin du dépôt —
  un seul endroit à modifier, et `tools/finalize-urls.mjs` la met à jour —
  qu'un script en ligne ramène à la racine lorsque le site n'est pas servi
  sous ce sous-chemin.
- *Les données avant le balisage.* Les événements vivent dans un seul fichier
  JSON, lu à la fois par l'accueil et par la page Événements.
- *Reportages : données éditées, pages générées et versionnées.* Un
  reportage est décrit par un fichier JSON ; `tools/build-reportages.mjs` en
  tire une page HTML statique complète. La page est commitée : GitHub Pages la
  sert sans étape de build, elle est indexable et lisible sans JavaScript, et
  sa première image ne dépend d'aucun chargement de données. Le générateur
  n'est qu'un outil d'édition, sans dépendance. Voir [Reportages](#reportages).

---

## Ce qui est développé

| Page | Contenu |
| --- | --- |
| **Accueil** | Hero photographique avec séquence d'entrée, trois compositions de sélection au rythme différent, bande d'événements à défilement horizontal, courte présentation, invitation au contact. |
| **Portfolio** | Cinq catégories (portraits, événements, cérémonies, reportages, autres projets), rail d'index collant dont l'entrée active suit la lecture, une composition distincte par catégorie. La catégorie Reportages présente une carte par reportage publié, générée. |
| **Reportage** (`reportages/florent.html`) | Récit photographique à la première personne : ouverture avec couverture, introduction, six chapitres et clôture. 25 photographies en cinq compositions (pleine largeur, image à gauche, image à droite, diptyque, portrait centré), sommaire collant des chapitres. |
| **Événements** | État d'attente explicite tant qu'aucun album n'existe ; rendu automatique dès qu'un album est ajouté à `events.json`. |
| **À propos** | Quatre chapitres — la découverte, le parcours, les expériences, la vision — chacun marqué « texte à venir » et accompagné d'un commentaire HTML indiquant où coller le texte. |
| **Contact** | Canaux de contact marqués « à renseigner », et ce qu'il est utile de préciser dans un message. Aucun formulaire : le site ne collecte rien. |

Les emplacements photographiques sont des SVG locaux de 1,5 Ko, explicitement
identifiés comme emplacements. **Aucune image générée n'est présentée comme une
photographie du studio, et aucun événement fictif n'est affiché.**

---

## Animations et interactions

Le mouvement suit une grammaire unique, définie par les jetons `--dur-*` et
`--ease-*` de `tokens.css`. Tout passe par `opacity` et `transform`, afin de
rester sur le compositeur. **Une photographie n'est jamais zoomée, rognée ni
retouchée par une animation ou un survol** : seuls ses conteneurs et les
textes bougent (voir « Intégrité visuelle » ci-dessous).

| Animation | Mise en œuvre |
| --- | --- |
| **Séquence d'entrée** | Titre, accroche et navigation montent en cascade (90 ms d'écart) ; le filet du hero se trace. Déclenchée par un script en ligne de 6 lignes, indépendant des modules. |
| **Entrée du tirage principal** | Le cadre de l'image du reportage apparaît par fondu (de 55 % à 100 % d'opacité) et un glissement de 0,75 rem. L'image elle-même n'est ni zoomée, ni rognée, ni éclaircie. Le fondu part d'une opacité déjà marquée pour ne pas retarder le plus grand rendu de contenu. |
| **Révélation au défilement** | Un `IntersectionObserver` unique ; chaque élément cesse d'être observé après sa révélation. Trois variantes : montée, balayage, tracé de filet. Aucun écouteur de `scroll`. |
| **Menu mobile** | Élément `<dialog>` en mode modal : piégeage du focus, fermeture par <kbd>Échap</kbd>, arrière-plan inerte et annonce de rôle sont pris en charge par le navigateur. Transition par `@starting-style` et `allow-discrete`. |
| **Transitions entre pages** | `@view-transition` natif, zéro JavaScript ; l'entête est exclu du fondu via `view-transition-name`. La navigation reste strictement native. |
| **Barre de progression** | `animation-timeline: scroll()`, sans aucun écouteur ; ignorée là où elle n'est pas prise en charge. |
| **Micro-interactions** | Soulignement qui se rétracte, repère de catégorie, repère de vue qui s'allume au survol d'une photographie, titre de carte de reportage qui prend l'accent. La photographie, elle, ne change pas au survol. |
| **Reportage : lecture** | Mêmes révélations que le reste du site, au fil des chapitres : un filet se trace, le titre et le texte montent, les images se dévoilent. Texte, filets et images montent de 2 rem en fondu (1000 ms), la légende suit l'image avec 380 ms de retard ; le chapitre lu allume son numéro. Seuls `opacity` et `transform` sont animés : aucun zoom, aucun rognage, aucun filtre sur les photographies. Désactivé sous `prefers-reduced-motion: reduce`. Aucun défilement imposé, aucun effet de parallaxe. |
| **Sommaire des chapitres** | Rail collant réutilisé du portfolio : l'entrée active suit la lecture (soulignement qui se trace, numéro en accent) et, en mobile, est ramenée dans la partie visible du rail. |

**Intégrité visuelle.** Aucune règle de `site.css` n'applique `scale()`,
`filter` (luminosité, contraste…), `clip-path` autre que `none`, `object-fit`
ni `mix-blend-mode` : un test de `tools/test-reportages.mjs` lit la feuille de
style hors commentaires et échoue si l'un d'eux réapparaît. `tools/check.mjs`
mesure en plus, dans Chrome, que les photographies sont entières — sans
filtre, transformation ni rognage sur l'image, son cadre ou sa figure — à cinq
instants de l'animation d'entrée, à quatre instants d'une révélation au
défilement, et pendant le survol (aussi pour la carte du portfolio), la taille
affichée restant inchangée.

**Trois garde-fous**, chacun couvert par un test automatisé :

1. `prefers-reduced-motion: reduce` neutralise animations et transitions, et
   force l'affichage de tout contenu qui serait resté masqué.
2. Sans JavaScript, aucun état masqué n'est appliqué : `opacity` et
   `transform` de la révélation sont conditionnés à `html.js`. La variante
   « balayage » ne fait plus que décaler et fondre : elle ne rogne plus l'image.
3. Amélioration progressive de la navigation : la rangée de liens est l'état
   par défaut, y compris en mobile. Le bouton de menu ne la remplace qu'une
   fois `nav.js` arrivé au bout de son initialisation (classe `html.js-menu`).
   Si les modules sont bloqués, ou si `<dialog>` n'est pas pris en charge, le
   visiteur navigue toujours. Un minuteur de 3 secondes, posé par le script en
   ligne, rend par ailleurs tout le contenu visible.

---

## Accessibilité

Cible : WCAG 2.2 AA.

- Lien d'évitement en premier élément focusable, visible dès qu'il reçoit le
  focus (`:focus`, et non `:focus-visible`).
- Repère de focus à fort contraste, avec décalage, sur l'ensemble du site.
- Menu mobile bâti sur `<dialog>` : focus piégé, <kbd>Échap</kbd>, focus
  restitué au bouton à la fermeture, fermeture après navigation.
- `aria-current` sur la page courante et sur la catégorie lue.
- Bande horizontale focusable et étiquetée, donc pilotable au clavier.
- Cibles d'au moins 24 px sur toutes les commandes (critère 2.5.8), et d'au
  moins 44 px sur les commandes principalement tactiles : bouton de menu,
  fermeture du menu, appel au défilement.
- Hiérarchie de titres sans saut de niveau, un seul `<h1>` par page.
- Contrastes **mesurés** : minimum relevé **5,5:1** sur le texte courant.

---

## Référencement

- HTML sémantique, un `<h1>` unique par page, hiérarchie `h2`/`h3` continue.
- `<title>` et `<meta name="description">` uniques et de longueur maîtrisée.
- Open Graph et `twitter:card` sur les sept pages. Visuel de partage 1200 × 630
  pour les pages principales ; pour un reportage, un JPEG de sa couverture
  (1200 px au plus de large, jamais agrandi).
- Données structurées JSON-LD sur **deux pages seulement**, limitées à des
  informations vérifiables : l'accueil (`Person` : nom, métier, domaines) et
  chaque reportage (`Article` : titre, description, genre, lieu, auteur).
  Portfolio, événements, à propos, contact et 404 n'en portent pas. Aucune
  coordonnée, aucune note, aucun chiffre inventé.
- Favicon SVG, `lang="fr"`, page 404 en `noindex, follow`.
- `robots.txt` présent, mais **sans effet tant que le site est publié sous un
  sous-chemin** : un robot ne lit ce fichier qu'à la racine d'un hôte, et
  `https://<compte>.github.io/robots.txt` relève du dépôt `<compte>.github.io`,
  pas de celui-ci. Sans conséquence ici, puisque rien n'est interdit — mais la
  future directive `Sitemap` subira la même limite et le sitemap devra être
  déclaré directement dans l'outil pour webmasters du moteur. Le détail est
  écrit dans [`robots.txt`](robots.txt) lui-même, et `finalize-urls.mjs` le
  rappelle à l'exécution.
- Dimensions explicites, `loading="lazy"` et `decoding="async"` sur toutes les
  images sauf l'image LCP de chaque page, qui est en `fetchpriority="high"`.

**Métadonnées vérifiées.** Un test automatisé contrôle sur les sept pages la
présence et la valeur de `og:type`, `og:site_name`, `og:locale`, `og:title`,
`og:description`, `og:image`, `og:image:alt`, `twitter:card`, `theme-color` et
du favicon, la validité du JSON-LD, le `noindex` de la page 404 — et **l'absence**
de `canonical` et d'`og:url`, pour que ce choix ne puisse pas être défait par
inadvertance.

**Ce qui reste à poser, avant publication :** le lien canonique, `og:url`
absolu et `sitemap.xml` exigent une URL publique confirmée. Les publier avant
confirmation enverrait un mauvais signal aux moteurs si l'adresse changeait.
Une fois l'adresse arrêtée :

```bash
node tools/finalize-urls.mjs https://angekevin-agre.github.io/ange-kevin-photographie
```

Le script écrit le canonique et `og:url` dans chaque page (reportages compris),
absolutise `og:image`, met la balise `<base>` de `404.html` au sous-chemin
réel, génère `sitemap.xml`, ajoute la directive `Sitemap` à `robots.txt` et
**mémorise l'adresse dans `content/site.json`**. Il peut être relancé sans
dommage, avec une autre adresse si elle change.

**Pourquoi `content/site.json`.** Les pages de reportage sont générées : sans
mémoire de l'adresse, régénérer une page après une retouche éditoriale
effaçait son canonical, son `og:url` et son `og:image` absolue. Désormais
`build-reportages.mjs` relit `content/site.json` et produit exactement le
balisage de `finalize-urls.mjs` : la séquence finalisation → retouche →
régénération laisse les trois balises justes, et `build-reportages.mjs --check`
ne signale rien juste après une finalisation. Tant que le fichier est absent,
aucune adresse n'est supposée. Un fichier illisible ou une adresse invalide
interrompt la génération. Compatible avec un sous-chemin GitHub Pages ; tous
les chemins des pages restent relatifs.

Liste de contrôle avant mise en ligne :

| À faire | Pourquoi c'est en attente |
| --- | --- |
| Confirmer l'URL publique, puis lancer `finalize-urls.mjs` (et versionner `content/site.json`) | Canonical, `og:url` et sitemap exigent une adresse certaine |
| Déclarer le sitemap dans l'outil pour webmasters | `robots.txt` n'est pas lu sous un sous-chemin |
| Vérifier la balise `<base>` de `404.html` si le dépôt est renommé | Elle porte le sous-chemin en dur ; le script la met à jour |
| Remplacer le visuel Open Graph typographique | Aucune photographie disponible à ce jour |
| Compléter À propos et Contact | Les textes et coordonnées n'ont pas été fournis |

---

## Performance

Mesures obtenues avec `node tools/metrics.mjs`, le 23 novembre 2026, après
PHOTO-02 (logo en WebP dans l'entête, page de reportage).

**Conditions :** Chrome 158 headless, viewport 390 × 844 en émulation mobile,
processeur bridé 4×, réseau bridé à 1,6 Mb/s en réception et 150 ms de RTT,
cache vidé à chaque page, serveur local `tools/serve.mjs` sur la boucle locale.

| Page | FCP | LCP | CLS | Requêtes | Poids |
| --- | --- | --- | --- | --- | --- |
| Accueil | 1 520 ms | 1 520 ms | 0 | 14 | 106 Ko |
| Portfolio | 1 012 ms | 1 692 ms | 0 | 12 | 102 Ko |
| Événements | 952 ms | 1 636 ms | 0 | 14 | 100 Ko |
| À propos | 868 ms | 1 548 ms | 0 | 11 | 95 Ko |
| Contact | 888 ms | 888 ms | 0 | 10 | 92 Ko |
| Reportage — Florent | 1 024 ms | 1 308 ms | 0 | 12 | 259 Ko |

LCP le plus élevé : **1 692 ms** pour une cible de 2 500 ms. CLS : **0** sur
les six pages, les dimensions des images étant toutes réservées. Le logo
ajoute environ 28 Ko à chaque page. Le reportage ne transfère au chargement
que sa couverture et les premières images : les 24 autres photographies sont
différées et chargées au fil de la lecture. D'une
exécution à l'autre, les temps varient d'environ 15 % : seules les différences
nettes sont significatives.

**Ce que ces chiffres ne sont pas.** Ce n'est pas un audit Lighthouse et ce ne
sont pas des données de terrain. Les deux environnements diffèrent en sens
contraires, et aucune transposition n'est possible dans un sens ou dans
l'autre : le serveur de test répond en HTTP/1.1 en clair, sans multiplexage ni
compression, mais depuis la machine elle-même ; GitHub Pages sert le site en
HTTP/2 sur TLS, avec compression, mais depuis un CDN distant, avec la
variabilité des appareils réels. **INP n'est pas mesuré** : cet indicateur
exige des interactions réelles d'utilisateurs.

Optimisations en place : aucune police distante, aucun script tiers, modules
préchargés par `modulepreload` pour éviter la cascade de découverte,
révélation immédiate de ce qui est déjà visible au chargement, images
différées sauf la candidate LCP.

---

## Reportages

Un reportage raconte une histoire en images et en mots, chapitre après
chapitre. Il se compose de trois éléments, chacun à sa place :

| Élément | Emplacement | Édité ou généré |
| --- | --- | --- |
| Récit, chapitres, ordre et textes des photographies | `content/reportages/<slug>.json` | édité à la main |
| Formats web des photographies, et leur manifeste | `assets/img/reportages/<slug>/` | généré par `optimize-photos.mjs` |
| Page publiée, et carte dans le portfolio | `reportages/<slug>.html`, `portfolio.html` | généré par `build-reportages.mjs` |

### Ce que contient un reportage

Chaque champ est décrit dans
[`content/reportages/reportage.schema.json`](content/reportages/reportage.schema.json) :
titre, sous-titre, catégorie (`mariages`, `anniversaires`, `portraits`,
`evenements`), occasion, lieu, description, introduction personnelle,
chapitres, photographies ordonnées avec texte alternatif et légende
facultative, couverture et clôture.

Un chapitre est une suite de **plans**, et chaque plan choisit une
composition :

| Composition | Usage |
| --- | --- |
| `pleine` | une image sur toute la largeur (bord à bord en mobile) |
| `gauche` / `droite` | une image d'un côté, une note brève de l'autre |
| `diptyque` | deux images côte à côte, la seconde décalée |
| `centre` | une image verticale, centrée |

Les règles sont vérifiées par `tools/reportages-lib.mjs`, et une erreur
désigne précisément le champ fautif :

- chaque photographie déclarée est affichée **exactement une fois**,
  couverture comprise : aucune image ne disparaît ni n'apparaît deux fois ;
- toute photographie a un **texte alternatif** ;
- un nom de fichier est un simple nom d'image, sans dossier, sans `..`, sans
  guillemet ni espace : impossible de pointer vers les dossiers `FAMILLE` ou
  `INDIVIDUEL`, que `optimize-photos.mjs` refuse également comme dossier
  source ;
- la structure est contrôlée **sans exception** : `photos: null`, une entrée
  `null`, un identifiant qui n'est pas un texte, un chapitre ou un plan mal
  typé sont refusés avec un message qui désigne le champ ;
- le `slug`, les identifiants de photographie et de chapitre sont limités à des
  minuscules, chiffres et tirets.

**Sécurité de la génération.** Toute valeur issue des données ou du manifeste
(texte, légende, texte alternatif, nom de fichier, dimension) est validée puis
échappée avant d'entrer dans le HTML, attributs compris ; le JSON-LD est
sérialisé en JSON avec « < » échappé. Huit charges d'injection (balise
`<img onerror>`, `</script>`, guillemets simples et doubles, `javascript:`,
commentaires…) sont injectées dans chacun des champs textuels : un test vérifie
qu'aucune balise ni aucun attribut n'en résulte, et qu'un manifeste hostile est
refusé avant toute écriture.

**Identifiants HTML.** Les ancres de chapitre sont préfixées (`chapitre-<id>`,
`t-chapitre-<id>`) : un chapitre nommé `introduction`, `contenu`, `menu` ou
`titre-reportage` ne peut pas entrer en collision avec un identifiant du
gabarit. Le changement n'est visible que dans les URL d'ancre.

**Aucune image n'est recadrée.** La largeur d'une photographie est bornée par
sa colonne et par une hauteur maximale exprimée en fraction de la fenêtre :
une image verticale tient entière à l'écran, et les filigranes restent
visibles.

### Créer un nouveau reportage

1. Réunir les photographies retenues dans un dossier (les originaux ne seront
   que lus).
2. Copier `content/reportages/florent.json` en `content/reportages/<slug>.json`,
   puis remplacer le récit, les chapitres et la liste des photographies. Le
   champ `file` reprend le nom exact du fichier original (`DSC_0148.jpg`), et
   `id` un identifiant en minuscules (`dsc-0148`).
3. Produire les formats web :

   ```bash
   node tools/optimize-photos.mjs <slug> --source="<dossier des originaux>"
   ```

4. Générer la page et la carte du portfolio :

   ```bash
   node tools/build-reportages.mjs
   ```

5. Vérifier : `node tools/check.mjs` (le test « pages générées à jour » échoue
   si l'étape 4 a été oubliée après une modification des données).

Le portfolio liste automatiquement tous les reportages, dans l'ordre du champ
`order`. Les liens « reportage précédent / suivant » apparaissent dès qu'il en
existe plusieurs.

### Formats web des photographies

`optimize-photos.mjs` lit les originaux et écrit, sans jamais les modifier :

- des déclinaisons **WebP** (qualité 78) : 640, 1024, 1600 et 2400 px de large
  pour une image horizontale ; 480, 800 et 1200 px pour une image verticale.
  Jamais d'agrandissement ;
- pour la couverture, un **JPEG de 1200 px**, visuel de partage (`og:image`),
  le format le mieux accepté par les réseaux sociaux ;
- un `manifest.json` (version 2) : pour chaque photographie, l'empreinte
  SHA-256 de l'original, ses dimensions, et pour chaque dérivé son fichier, ses
  dimensions et sa propre empreinte ; en tête, les **paramètres de conversion**
  (largeurs, qualité, réduction), définis une seule fois dans
  `reportages-lib.mjs`. Lu et vérifié par le générateur.

Le visuel de partage n'est jamais agrandi : il reste à la largeur de
l'original s'il est plus étroit que 1200 px.

Garanties : le slug est un identifiant (minuscules, chiffres, tirets) **identique
à celui du reportage**, refusé sinon — `../x`, `a/b`, un chemin absolu ou
`ESSAI` s'arrêtent avant tout accès au disque — et la destination reste dans
`assets/img/reportages/` ; seuls les fichiers déclarés dans le JSON sont lus ; l'empreinte
SHA-256 de chaque original est comparée avant et après traitement (le script
s'arrête à la moindre différence) ; le dossier de sortie ne peut pas se
trouver dans le dossier source ; les images sont seulement redimensionnées —
ni recadrage, ni retouche, ni filigrane retiré ou ajouté. Les **métadonnées
EXIF**, coordonnées GPS et modèle d'appareil compris, sont **retirées** des
fichiers publiés.

**Fraîcheur des images.** Un dérivé n'est conservé que si, à la fois,
l'original a la même empreinte qu'à la production, les paramètres de
conversion n'ont pas changé, et le fichier existe avec l'empreinte
enregistrée. Sinon il est régénéré, et la raison est affichée. Le manifeste
n'est écrit qu'une fois **tous** les dérivés produits (chaque fichier est écrit
sous un nom temporaire puis renommé), et les fichiers qu'il ne référence plus
sont supprimés : il ne peut pas conserver un dérivé obsolète. Un manifeste
sans empreinte de l'original force la régénération. Le générateur de pages
vérifie à son tour l'empreinte de chaque dérivé, et refuse une page qui
référencerait une image périmée, altérée, absente ou orpheline.

`--force` régénère tout, `--dry-run` affiche ce qui serait fait sans rien
écrire ni supprimer. Prérequis : `ffmpeg` et `ffprobe` avec l'encodeur
`libwebp` (dans le `PATH`, ou désignés par `FFMPEG_PATH` et `FFPROBE_PATH`).

### Le reportage de Florent

25 photographies retouchées par le photographe, sélection définitive, issues
du dossier `FINALE FLORENT 7 DECEMBRE\ANOTHER`. Elles ont été produites par :

```bash
node tools/optimize-photos.mjs florent --source="<chemin>/FINALE FLORENT 7 DECEMBRE/ANOTHER"
node tools/build-reportages.mjs
```

Les empreintes SHA-256 des 25 originaux de Florent sont enregistrées dans son
manifeste et ont été vérifiées ; les originaux eux-mêmes ne sont pas versionnés.

Le récit est écrit à la première personne, à partir du témoignage du
photographe ; les personnes, les tenues et les moments ont été confirmés par
lui. Aucun événement, dialogue, lieu précis ni lien familial n'a été ajouté,
et le mariage civil, qui n'a pas été photographié, n'est pas présenté.
L'épouse de Florent n'est pas nommée, selon le choix du photographe.

---

## Ajouter des photographies

### Publier un événement

Un seul fichier à éditer, [`assets/data/events.json`](assets/data/events.json).
L'accueil (3 albums les plus récents) et la page Événements (tous) s'alimentent
à cette même source : **aucune page HTML n'est à modifier.**

```json
{
  "albums": [
    {
      "id": "ceremonie-2026-12-05",
      "title": "Cérémonie à Cocody",
      "date": "2026-12-05",
      "category": "ceremonies",
      "description": "Une phrase facultative.",
      "cover": {
        "src": "assets/img/evenements/ceremonie-2026-12-05/couverture.webp",
        "width": 1800,
        "height": 1200,
        "alt": "Description de la photographie de couverture",
        "variants": [
          { "src": "assets/img/evenements/ceremonie-2026-12-05/couverture-900.webp", "width": 900 },
          { "src": "assets/img/evenements/ceremonie-2026-12-05/couverture-1800.webp", "width": 1800 }
        ]
      },
      "photos": []
    }
  ]
}
```

Chaque champ est décrit dans
[`assets/data/events.schema.json`](assets/data/events.schema.json). Les albums
sont triés du plus récent au plus ancien. `variants` est facultatif : s'il est
présent, `srcset` et `sizes` sont renseignés automatiquement.

### Remplacer les emplacements du portfolio

Les emplacements du portfolio et de l'accueil sont écrits en HTML. Remplacer
un `<img src="assets/img/placeholders/…">` par la photographie réelle, en
conservant `width`, `height`, `loading` et `decoding`, et en renseignant un
`alt` descriptif. Format recommandé : WebP, ou AVIF avec repli WebP via
`<picture>`.

Les emplacements eux-mêmes sont régénérables : `node tools/make-placeholders.mjs`.

### Logo

Le logo fourni par le photographe est conservé tel quel dans
[`assets/img/brand/logo-ange-kevin-photographie.png`](assets/img/brand/logo-ange-kevin-photographie.png)
(2172 × 724, fond transparent), sans retouche ni redessin. L'entête de chaque
page affiche deux déclinaisons WebP à transparence, de 320 et 640 px de
large, à 9rem (11rem sur grand écran). Pour les reproduire après un
changement de logo :

```bash
ffmpeg -i assets/img/brand/logo-ange-kevin-photographie.png -vf "scale=320:-1:flags=lanczos" \
  -c:v libwebp -pix_fmt yuva420p -quality 92 -compression_level 6 -map_metadata -1 assets/img/brand/logo-320.webp
ffmpeg -i assets/img/brand/logo-ange-kevin-photographie.png -vf "scale=640:-1:flags=lanczos" \
  -c:v libwebp -pix_fmt yuva420p -quality 92 -compression_level 6 -map_metadata -1 assets/img/brand/logo-640.webp
```

Si les proportions changent, mettre à jour les attributs `width` et `height`
de la balise `.brand__mark` dans les six pages et dans
`tools/build-reportages.mjs`. Le favicon (`favicon.svg`) reste le pictogramme
provisoire : le logo, horizontal et en script, n'est pas lisible à 16 px, et
le redessiner n'a pas été demandé.

### Compléter la page À propos

Dans [`a-propos.html`](a-propos.html), chaque chapitre porte un commentaire
`<!-- À COMPLÉTER -->` ; remplacer le paragraphe `.pending` par le texte, en
autant de `<p>` que nécessaire.

### Renseigner les coordonnées

Dans [`contact.html`](contact.html), remplacer chaque `<span class="pending">`
par un lien réel (`mailto:`, `https://…`) et supprimer les canaux non
utilisés.

---

## Lancer le site en local

**Un serveur HTTP est nécessaire.** Le serveur fourni reproduit en plus les
deux particularités de GitHub Pages — publication sous un sous-chemin, et
`404.html` servie avec le statut 404 pour toute URL inexistante — ce qu'aucun
serveur de fichiers générique ne fait :

```bash
node tools/serve.mjs --prefix=ange-kevin-photographie
```

Puis ouvrir <http://127.0.0.1:8123/ange-kevin-photographie/>. Sans `--prefix`,
le site est servi à la racine, comme sous un domaine propre.

N'importe quel autre serveur statique convient pour une simple relecture :

```bash
python -m http.server 8123 --bind 127.0.0.1
npx --yes serve . -l 8123
```

**Ouvrir `index.html` depuis le disque ne suffit pas.** Sous le protocole
`file:`, la politique d'origine du navigateur bloque le chargement des modules
ES : *aucun* des quatre fichiers de `assets/js/` ne s'exécute, et le
chargement de `events.json` échoue également. La page reste lisible — c'est
précisément ce que garantissent les garde-fous décrits plus haut : la
navigation reste une rangée de liens, le minuteur de 3 secondes affiche tout
le contenu — mais le menu mobile, la révélation au défilement, l'état de
l'entête et les albums sont absents. Le rendu n'est donc pas représentatif.

---

## Tests et vérifications

**Prérequis réels :** Node.js 22.4 ou plus récent — les scripts utilisent les
`fetch` et `WebSocket` natifs — et Google Chrome ou Chromium, localisé
automatiquement ou désigné par `CHROME_PATH`. Aucune dépendance à installer.
Chaque script lance lui-même son serveur de test, avec le sous-chemin de
publication : il n'y a rien à démarrer dans un autre terminal. L'option
`--base=<url>` permet d'utiliser un serveur déjà lancé.

```bash
node tools/check.mjs      # vérifications dans Chrome : CSS, reportages, menu, clavier, albums, 404, responsive, SEO
node tools/test-reportages.mjs   # sans navigateur : sécurité, slug, fraîcheur des images, SEO, intégrité visuelle
node tools/test-capture.mjs      # l'outil de captures face à un Chrome qui se bloque
node tools/metrics.mjs    # LCP, CLS, FCP, requêtes, poids, sous bridage mobile
node tools/capture.mjs    # captures dans .captures/ (ignoré par Git) ; voir ses options en tête du fichier
node tools/build-reportages.mjs --check   # pages de reportage à jour par rapport aux données
```

`check.mjs` exécute lui-même `test-reportages.mjs` ; `test-capture.mjs` se lance
à part (il pilote Chrome, une vingtaine de secondes).

**Captures.** Les pages de reportage sont capturées écran par écran
(`reportages-florent-mobile-01.png`, `-02.png`…) : leurs images sont bornées
en hauteur de fenêtre, et une capture « pleine page », qui agrandit la
fenêtre à la hauteur du document, ne se terminerait jamais. Contrat de
`capture.mjs` :

- chaque commande DevTools est **bornée** (10 s par défaut, `--timeout`) ; un
  dépassement n'est jamais ignoré ;
- après un dépassement ou une connexion perdue, le **navigateur est tué avec
  ses processus fils puis relancé** avec un profil neuf, et l'écran (ou la page)
  est repris ; deux reprises au plus, sans allonger les délais ;
- les captures **réellement écrites** (fichier non vide) sont comptées et
  comparées à celles attendues : « 55/67 capture(s) produite(s) » ;
- code de sortie **0** si tout est capturé sans anomalie, **1** si tout est
  capturé mais des anomalies sont relevées (console, débordement), **2** si
  une capture manque. Un succès partiel n'est jamais annoncé comme une
  réussite : le résumé finit par « RÉSULTAT INCOMPLET ».

Limite connue : la capture en tablette (768 × 1024 px) peut encore échouer
malgré les reprises. L'outil le signale alors (« RÉSULTAT INCOMPLET ») et
retourne un code de sortie non nul. C'est une limite de l'outil de capture
face au navigateur piloté, et non un défaut de fonctionnement du site.

`check.mjs` rend un code de sortie non nul si une vérification échoue, et
couvre notamment :

- ouverture et fermeture du menu mobile, piégeage puis restitution du focus ;
- lien d'évitement focusable et visible, cible existante ;
- aucun contenu masqué avec `prefers-reduced-motion`, sans JavaScript, ou
  lorsque les modules sont injoignables — y compris le rognage et le décalage
  de la variante « balayage », que la seule opacité ne couvrait pas ;
- navigation utilisable quand les modules sont bloqués, et bascule effective
  vers le bouton de menu quand ils se chargent ;
- absence de chevauchement entre la marque et les liens à 320 et 390 px, le
  premier lien étant réellement cliquable (`elementFromPoint`) ;
- rail collant du portfolio non masqué par l'entête à deux lignes du repli ;
- page 404 servie sous une URL imbriquée inexistante, avec et sans JavaScript :
  statut 404, trois feuilles de style appliquées, logo chargé, liens de
  navigation résolus, `noindex` conservé, lien d'évitement toujours interne ;
- contraste du texte courant calculé à partir des styles effectifs, et taille
  des cibles interactives ;
- syntaxe des feuilles de style : un commentaire mal fermé fait silencieusement
  sauter la règle suivante, sans que le navigateur ne signale rien ;
- rendu des albums à partir d'un jeu d'essai injecté par interception de la
  requête — tri, `srcset`, chargement différé, date, refus d'une URL
  `javascript:` — sans jamais modifier `events.json` ;
- date d'album sous le fuseau `America/Los_Angeles`, pour prévenir le recul
  d'un jour que provoque l'interprétation UTC d'une date ISO ;
- résistance aux données invalides : un album malformé ou une déclinaison
  d'image malformée est écarté seul, les albums valides restent affichés, et
  les trois états — liste vide, données invalides, erreur de chargement — sont
  distingués et annoncés ;
- attribut `sizes` comparé à la largeur de rendu mesurée des couvertures, sur
  deux pages et quinze largeurs, seuils de colonnes compris ;
- métadonnées de partage, JSON-LD, et absence de `canonical` ou d'`og:url`
  tant que l'URL publique n'est pas confirmée ;
- révélation de toutes les photographies après parcours de la page ;
- **reportages, sans navigateur** (`check.mjs` et `test-reportages.mjs`) :
  données valides, 25 photographies chacune affichée une fois, validateur
  testé sur dix défauts éditoriaux, refus d'un dossier source `FAMILLE`, pages
  générées à jour, fichiers web présents, au bon format, aux proportions de
  l'original, sans EXIF ni fichier orphelin ;
- **sécurité et non-régression** (`test-reportages.mjs`, 15 tests, répertoires
  temporaires, outils exécutés pour de bon) : structures invalides et valeurs
  nulles refusées sans exception ; manifeste testé sur 35 défauts (entrée ou
  déclinaison `null`, dimensions non positives, noms de fichier hostiles,
  empreinte absente, paramètres différents…) ; 8 charges d'injection HTML dans
  tous les champs ; manifeste hostile refusé avant écriture ; 18 slugs de
  traversée de répertoires refusés sans rien écrire ; slug différent de celui du
  reportage ; régénération d'un dérivé quand l'original, les paramètres ou le
  fichier changent (et conservation sinon) ; finalisation des URL, retouche
  éditoriale puis régénération avec canonical, `og:url` et `og:image`
  conservés ; chapitre nommé `introduction` sans identifiant en double ;
  feuille de style sans zoom, rognage ni filtre. Les tests qui produisent de
  vraies images exigent ffmpeg : s'il manque, ils sont marqués « IGNORÉ » et
  non comptés comme réussis ;
- **intégrité visuelle, dans Chrome** : photographies entières pendant
  l'animation d'entrée, la révélation et le survol (voir
  [Animations](#animations-et-interactions)) ;
- **reportage, dans Chrome** : couverture prioritaire et 24 images différées,
  `srcset`, `sizes` et texte alternatif partout ; à 390, 1024 et 1440 px,
  tout est révélé et chargé après lecture, aucune image rognée, déformée ni
  plus haute que la fenêtre ; sommaire qui suit la lecture, ramené dans le
  champ en mobile, utilisable au clavier sans que le titre visé passe sous
  l'entête ; mouvement réduit et absence de JavaScript ; `sizes` jamais
  inférieur à la largeur rendue sur 2 pages × 11 formats d'écran ; carte du
  portfolio cliquable en entier avec un seul lien ; contrastes ;
- **aucune exception JavaScript ni `console.error`** sur l'ensemble du
  parcours, scénarios dégradés compris ;
- **absence de débordement horizontal sur 7 pages × 8 largeurs** (320, 360,
  390, 430, 768, 1024, 1440, 1920) ;
- balisage SEO : `<h1>` unique, titres uniques, longueur des descriptions,
  dimensions et `alt` des images, hiérarchie des titres, liens et ancres
  internes résolus.

**Ce qui n'a pas été exécuté :** aucun audit Lighthouse (non installé, et son
installation n'a pas été demandée), aucun test sur appareil physique, aucun
test avec un lecteur d'écran réel. Les vérifications d'accessibilité portent
sur la structure, le focus et les contrastes, pas sur le confort d'usage
effectif en lecture d'écran.

---

## Déploiement GitHub Pages

Le site est publiable tel quel, sans build : servir la branche choisie depuis
la racine du dépôt (*Settings → Pages → Deploy from a branch*).

- `.nojekyll` est présent pour que les fichiers soient publiés sans traitement
  Jekyll.
- Les chemins des pages sont relatifs : le site fonctionne sous
  `https://<compte>.github.io/<dépôt>/` comme à la racine d'un domaine propre.
- `404.html` est servie automatiquement pour **toute** URL inexistante, en
  conservant l'adresse demandée. Elle porte pour cette raison une balise
  `<base>` fixée au sous-chemin du dépôt, ramenée à la racine par un script en
  ligne lorsque le site est servi ailleurs. **Si le dépôt est renommé**, cette
  valeur est le seul endroit à mettre à jour — `finalize-urls.mjs` s'en charge.
- `robots.txt` n'est pas lu sous un sous-chemin (voir
  [Référencement](#référencement)).
- Une fois l'adresse publique confirmée, exécuter `tools/finalize-urls.mjs`
  (voir [Référencement](#référencement)).

L'adresse `https://angekevin-agre.github.io/ange-kevin-photographie/` est la
cible probable, **mais la publication n'est pas encore configurée** : elle
n'est donc présentée nulle part comme l'URL canonique.

---

## Workflow Git

| Branche | Rôle |
| --- | --- |
| `main` | Production |
| `develop` | Intégration |
| `feature/*` | Développement d'une fonctionnalité |

PHOTO-01 a été développée sur `feature/portfolio-ui`, proposée dans la
[Pull Request #1](https://github.com/angekevin-agre/ange-kevin-photographie/pull/1)
et fusionnée dans `develop`.

PHOTO-02 est développée sur `feature/photo-02`, créée depuis `develop`. Elle
n'est ni poussée ni fusionnée : l'intégration vers `develop` puis `main`, ainsi
que la mise en ligne, restent une décision du propriétaire du dépôt. Les
corrections issues de l'audit indépendant (PHOTO-02C : sécurité des données,
slug, fraîcheur des images, SEO après régénération, outil de captures,
intégrité visuelle des photographies) sont sur la même branche, non commitées
à la date de cette rédaction.

---

## Prochaines évolutions

Ces fonctionnalités **ne sont pas développées**. Elles sont listées parce que
l'architecture actuelle a été conçue pour les accueillir.

### Albums d'événements et visionneuse

PHOTO-02 a porté sur les reportages narratifs. Restent possibles, sans être
développés :

- visionneuse photographique (navigation clavier, gestes tactiles) ;
- filtres par catégorie de reportage, une fois plusieurs reportages publiés ;
- pages de détail des albums d'`events.json`, ou leur rapprochement avec les
  reportages.

Points d'extension déjà en place : le schéma `events.schema.json` couvre
`photos`, `caption` et `variants` ; `albums.js` renseigne déjà `srcset` et
`sizes` dès qu'un album fournit ses déclinaisons ; le champ facultatif `url`
d'un album peut pointer vers une page `reportages/<slug>.html`.

### feature/pwa — Application installable

Le périmètre PWA est volontairement absent : **aucun manifeste, aucun service
worker, aucune stratégie de cache** n'est fourni. Sont en revanche déjà en
place : chemins relatifs compatibles avec un sous-répertoire, arborescence
d'assets stable et versionnable, zones sûres (`env(safe-area-inset-*)`) prises
en compte dans les marges, et règles `@media (display-mode: standalone)` pour
l'entête, le menu et le pied de page.

---

## Limites connues

- L'entête, le pied de page et le menu sont dupliqués dans les six pages écrites
  à la main (choix assumé d'un site sans build) et reproduits par le
  générateur de reportages : une modification doit être répercutée partout.
- Les albums chargés depuis `events.json` sont rendus côté client. Tant
  qu'aucun album n'existe, cela n'a aucun effet sur le référencement ; dès que
  des albums seront publiés, PHOTO-02 devra décider entre génération statique
  et rendu client.
- Les polices sont des piles système : le dessin exact varie selon la
  plateforme. Basculer vers une police auto-hébergée ne demande que de
  modifier `--ff-display` et d'ajouter une règle `@font-face`.
- Le visuel de partage Open Graph est typographique, faute de photographie
  disponible.
- Aucune mesure Lighthouse ni donnée de terrain (voir
  [Performance](#performance)).
- `robots.txt` est inopérant tant que le site est publié sous un sous-chemin
  GitHub Pages. Sans conséquence — rien n'est interdit — mais la directive
  `Sitemap` devra être relayée dans l'outil pour webmasters du moteur.
- `404.html` porte un sous-chemin en dur dans sa balise `<base>`. Servie sous
  une URL imbriquée depuis un hôte inattendu **et** sans JavaScript, elle
  perdrait ses styles ; avec JavaScript, le script en ligne corrige la base.
- Le menu mobile n'apparaît qu'une fois `nav.js` exécuté. Avant cela — et si
  les modules ne se chargent jamais — l'entête affiche la rangée de liens sur
  une seconde ligne en mobile. `--header-h` suit cette hauteur dans ce mode,
  de sorte que le rail collant et les ancres restent correctement décalés,
  mais l'entête y occupe davantage de place à l'écran.
- Une page de reportage est **générée** : la modifier à la main serait écrasée à
  la génération suivante. Toute correction passe par
  `content/reportages/<slug>.json`, puis `build-reportages.mjs`. L'entête et le
  pied de page y sont produits par le générateur : une modification de
  l'entête du site doit donc aussi être reportée dans
  `tools/build-reportages.mjs`.
- Les empreintes SHA-256 des 25 **originaux** de Florent sont renseignées dans
  son manifeste et ont été vérifiées. Les originaux haute résolution ne sont pas
  versionnés : pour régénérer les dérivés, `optimize-photos.mjs` doit disposer
  des originaux, dont l'empreinte est comparée à celle du manifeste.
- Les formats web des photographies sont versionnés dans le dépôt (13 Mo pour
  les 25 images de Florent). C'est le prix d'un site sans build ni service
  d'images ; chaque nouveau reportage alourdit d'autant l'historique Git.
- Les photographies conservent le filigrane « BONEHO PHOTOGRAPHY » de leur
  retouche d'origine, comme demandé : aucun filigrane n'a été retiré ni ajouté.
- Les reportages montrent des invités identifiables. Leur publication relève
  du droit à l'image ; l'accord des personnes photographiées est de la
  responsabilité du photographe.
- Les animations du récit sont désactivées sous `prefers-reduced-motion: reduce`,
  y compris lorsque Windows a coupé « Afficher les animations » : le reportage
  est alors volontairement statique, mais complet.
- La validation des données d'albums est faite à la main dans `albums.js`, et
  ne couvre pas l'intégralité de `events.schema.json` (elle vérifie ce dont le
  rendu dépend). Aucun validateur JSON Schema n'est embarqué : ce serait une
  dépendance pour un fichier édité à la main.

---

## Licence et crédits

Les photographies publiées sur ce site, une fois mises en ligne, sont
protégées par le droit d'auteur. Toute reproduction, diffusion ou
réutilisation, même partielle, est interdite sans autorisation écrite. Le site
ne propose aucun téléchargement et ne publie pas les fichiers originaux haute
résolution ; aucune mesure technique ne prétend empêcher une capture d'écran.

Ce site ne comporte aucun formulaire, ne dépose aucun traceur et ne collecte
aucune donnée personnelle.

**Conception et développement :** Ange Kevin, avec l'assistance d'un agent de
développement IA pour l'implémentation, les audits et l'outillage de test. Les
décisions de direction artistique, de périmètre et de contenu restent les
miennes.

© 2026 Ange Kevin Photographie.
