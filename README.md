# Ange Kevin Photographie

Portfolio photographique éditorial : portraits, cérémonies, événements et
reportages. Site statique, sans dépendance ni étape de build, destiné à
GitHub Pages.

> **État du projet.** Cette version correspond au ticket **PHOTO-01** :
> direction artistique, cinq pages, langage d'animation, socle SEO,
> accessibilité et structure de données des événements. Les photographies
> réelles, le récit du photographe et les coordonnées professionnelles seront
> fournis par la suite — rien n'a été inventé pour combler ces vides. La
> gestion complète des albums et la visionneuse relèvent de **PHOTO-02**.

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
- **JavaScript en modules ES**, sans dépendance : 4 fichiers, 17 Ko au total
  avant compression.
- **Node.js 22.4 ou plus récent** pour les scripts de `tools/` (serveur local,
  tests, captures, mesures, génération des emplacements) : ils utilisent les
  `fetch` et `WebSocket` natifs. Aucun `package.json`, aucun `node_modules` :
  rien à installer. Les scripts de test pilotent **Chrome**, localisé
  automatiquement ou désigné par `CHROME_PATH`.

Poids total de la couche CSS + JS : **52 Ko** non compressés, pour 1 455
lignes commentées.

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
│       ├── logo.svg        Marque provisoire, à remplacer par le logo définitif
│       ├── favicon.svg
│       ├── og-cover.png    Visuel de partage, 1200 × 630
│       └── placeholders/   Emplacements photographiques (8 formats)
│
└── tools/                  Scripts Node sans dépendance
    ├── serve.mjs           Serveur local reproduisant GitHub Pages (sous-chemin, 404)
    ├── check.mjs           59 vérifications fonctionnelles, accessibilité, SEO, responsive
    ├── capture.mjs         Captures d'écran pleine page, 3 appareils, relevé de console
    ├── metrics.mjs         Mesure LCP, CLS, FCP, poids et requêtes
    ├── finalize-urls.mjs   Pose canonical, og:url, sitemap.xml et la base de 404.html
    └── make-placeholders.mjs  Génère les emplacements SVG
```

**Choix structurants**

- *Pages HTML indépendantes.* Sans générateur de site, l'entête, le pied de
  page et le menu sont dupliqués dans les cinq pages. C'est le compromis
  assumé d'un site sans build : le référencement et le fonctionnement sans
  JavaScript sont préservés, au prix d'une modification à répercuter cinq
  fois. Un générateur statique reste possible si le nombre de pages croît.
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

---

## Ce qui est développé

| Page | Contenu |
| --- | --- |
| **Accueil** | Hero photographique avec séquence d'entrée, trois compositions de sélection au rythme différent, bande d'événements à défilement horizontal, courte présentation, invitation au contact. |
| **Portfolio** | Cinq catégories (portraits, événements, cérémonies, reportages, autres projets), rail d'index collant dont l'entrée active suit la lecture, une composition distincte par catégorie. |
| **Événements** | État d'attente explicite tant qu'aucun album n'existe ; rendu automatique dès qu'un album est ajouté à `events.json`. |
| **À propos** | Quatre chapitres — la découverte, le parcours, les expériences, la vision — chacun marqué « texte à venir » et accompagné d'un commentaire HTML indiquant où coller le texte. |
| **Contact** | Canaux de contact marqués « à renseigner », et ce qu'il est utile de préciser dans un message. Aucun formulaire : le site ne collecte rien. |

Les emplacements photographiques sont des SVG locaux de 1,5 Ko, explicitement
identifiés comme emplacements. **Aucune image générée n'est présentée comme une
photographie du studio, et aucun événement fictif n'est affiché.**

---

## Animations et interactions

Le mouvement suit une grammaire unique, définie par les jetons `--dur-*` et
`--ease-*` de `tokens.css`. Tout passe par `opacity`, `transform` et
`clip-path`, afin de rester sur le compositeur.

| Animation | Mise en œuvre |
| --- | --- |
| **Séquence d'entrée** | Titre, accroche et navigation montent en cascade (90 ms d'écart) ; le filet du hero se trace. Déclenchée par un script en ligne de 6 lignes, indépendant des modules. |
| **Développement du tirage** | L'image du hero gagne en densité pendant qu'un voile se retire (`clip-path` + `filter`). Le voile ne couvre qu'un tiers de l'image, pour ne pas retarder le plus grand rendu de contenu. |
| **Révélation au défilement** | Un `IntersectionObserver` unique ; chaque élément cesse d'être observé après sa révélation. Trois variantes : montée, balayage, tracé de filet. Aucun écouteur de `scroll`. |
| **Menu mobile** | Élément `<dialog>` en mode modal : piégeage du focus, fermeture par <kbd>Échap</kbd>, arrière-plan inerte et annonce de rôle sont pris en charge par le navigateur. Transition par `@starting-style` et `allow-discrete`. |
| **Transitions entre pages** | `@view-transition` natif, zéro JavaScript ; l'entête est exclu du fondu via `view-transition-name`. La navigation reste strictement native. |
| **Barre de progression** | `animation-timeline: scroll()`, sans aucun écouteur ; ignorée là où elle n'est pas prise en charge. |
| **Micro-interactions** | Soulignement qui se rétracte, repère de catégorie, légère montée en densité des images au survol, repère de vue qui s'allume. |

**Trois garde-fous**, chacun couvert par un test automatisé :

1. `prefers-reduced-motion: reduce` neutralise animations et transitions, et
   force l'affichage de tout contenu qui serait resté masqué.
2. Sans JavaScript, aucun état masqué n'est appliqué : `opacity`, `clip-path`
   et `transform` de la révélation sont tous conditionnés à `html.js`. Rétablir
   la seule opacité ne suffisait pas — la variante « balayage » rogne l'image
   et la décale.
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
- Open Graph et `twitter:card` sur les cinq pages, visuel de partage
  1200 × 630 fourni.
- Données structurées JSON-LD limitées à des informations vérifiables
  (`Person` : nom, métier, domaines). Aucune coordonnée, aucune note, aucun
  chiffre inventé.
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

**Métadonnées vérifiées.** Un test automatisé contrôle sur les six pages la
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

Le script écrit le canonique et `og:url` dans chaque page, absolutise
`og:image`, met la balise `<base>` de `404.html` au sous-chemin réel, génère
`sitemap.xml` et ajoute la directive `Sitemap` à `robots.txt`. Il peut être
relancé sans dommage.

Liste de contrôle avant mise en ligne :

| À faire | Pourquoi c'est en attente |
| --- | --- |
| Confirmer l'URL publique, puis lancer `finalize-urls.mjs` | Canonical, `og:url` et sitemap exigent une adresse certaine |
| Déclarer le sitemap dans l'outil pour webmasters | `robots.txt` n'est pas lu sous un sous-chemin |
| Vérifier la balise `<base>` de `404.html` si le dépôt est renommé | Elle porte le sous-chemin en dur ; le script la met à jour |
| Remplacer le visuel Open Graph typographique | Aucune photographie disponible à ce jour |
| Compléter À propos et Contact | Les textes et coordonnées n'ont pas été fournis |

---

## Performance

Mesures obtenues avec `node tools/metrics.mjs`, le 22 novembre 2026.

**Conditions :** Chrome 158 headless, viewport 390 × 844 en émulation mobile,
processeur bridé 4×, réseau bridé à 1,6 Mb/s en réception et 150 ms de RTT,
cache vidé à chaque page, serveur local `tools/serve.mjs` sur la boucle locale.

| Page | FCP | LCP | CLS | Requêtes | Poids |
| --- | --- | --- | --- | --- | --- |
| Accueil | 1 220 ms | 1 220 ms | 0 | 14 | 78 Ko |
| Portfolio | 788 ms | 1 488 ms | 0 | 12 | 72 Ko |
| Événements | 784 ms | 1 484 ms | 0 | 14 | 71 Ko |
| À propos | 724 ms | 1 408 ms | 0 | 11 | 66 Ko |
| Contact | 740 ms | 740 ms | 0 | 10 | 63 Ko |

LCP le plus élevé : **1 488 ms** pour une cible de 2 500 ms. CLS : **0** sur
les cinq pages, les dimensions des images étant toutes réservées. D'une
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

### Remplacer le logo

Remplacer [`assets/img/logo.svg`](assets/img/logo.svg) — un carré lisible à
24 px. Les cinq pages le référencent, aucune autre modification n'est requise.

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
node tools/check.mjs      # 59 vérifications : CSS, menu, clavier, albums, 404, responsive, SEO
node tools/metrics.mjs    # LCP, CLS, FCP, requêtes, poids, sous bridage mobile
node tools/capture.mjs    # 18 captures pleine page dans .captures/ (ignoré par Git)
```

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
- **absence de débordement horizontal sur 6 pages × 8 largeurs** (320, 360,
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

PHOTO-01 a été développée sur `feature/portfolio-ui` et proposée dans la
[Pull Request #1](https://github.com/angekevin-agre/ange-kevin-photographie/pull/1).
Elle est ouverte mais n'a pas été fusionnée ; aucune publication n'a eu lieu.
L'intégration vers `develop` puis `main`, ainsi que la mise en ligne, restent
une décision du propriétaire du dépôt.

---

## Prochaines évolutions

Ces fonctionnalités **ne sont pas développées**. Elles sont listées parce que
l'architecture actuelle a été conçue pour les accueillir.

### PHOTO-02 — Albums et visionneuse

- Pages de détail par album, à partir du champ `id` déjà prévu et stable.
- Visionneuse photographique (navigation clavier, gestes tactiles).
- Filtres par catégorie et pagination des albums.
- Métadonnées par image : légende, date, lieu.

Points d'extension déjà en place : le schéma `events.schema.json` couvre
`photos`, `caption` et `variants` ; `albums.js` renseigne déjà `srcset` et
`sizes` dès qu'un album fournit ses déclinaisons ; le champ facultatif `url`
rend la couverture cliquable sans modifier le balisage.

### feature/pwa — Application installable

Le périmètre PWA est volontairement absent : **aucun manifeste, aucun service
worker, aucune stratégie de cache** n'est fourni. Sont en revanche déjà en
place : chemins relatifs compatibles avec un sous-répertoire, arborescence
d'assets stable et versionnable, zones sûres (`env(safe-area-inset-*)`) prises
en compte dans les marges, et règles `@media (display-mode: standalone)` pour
l'entête, le menu et le pied de page.

---

## Limites connues

- L'entête, le pied de page et le menu sont dupliqués dans les cinq pages
  (choix assumé d'un site sans build) : une modification doit être répercutée
  partout.
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
