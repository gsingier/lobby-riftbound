# Visuels (`public/assets/`)

Les logos et illustrations Riftbound / Radiance appartiennent à Riot Games et
UVS Games ; ils ne sont utilisés qu'avec leur accord, à partir des fichiers
fournis pour l'événement.

## Fichiers en place

| Fichier | Statut | Où il apparaît |
|---|---|---|
| `riftbound-logo.webp` | **Logo officiel** (542 × 238, fond transparent) | En-tête de l'écran TV (dans une carte nacrée), barre du haut de l'accueil, page de connexion |
| `radiance-keyart.jpg` | Visuel Radiance fourni, **basse résolution** (597 × 335, logo incrusté) | Non affiché : il a servi de référence pour la direction artistique (fond nacré, halo irisé, cercles concentriques) |

Le logo officiel est conçu pour un **fond clair** (le gris « League of
Legends » disparaît sur un fond sombre) : il est toujours posé sur blanc ou sur
la carte nacrée `.rb-logo-card` (`public/shared/theme.css`), jamais recoloré ni
déformé (hauteur fixée, largeur proportionnelle).

Le mot **RADIANCE** de l'en-tête de l'écran TV est un texte stylé (dégradé
bleu-argent, classe `.rb-radiance`), en attendant le logotype officiel du set.
Le halo irisé et les cercles concentriques sont dessinés en CSS (dégradés
statiques) : aucun fichier d'image n'est nécessaire.

## Visuels encore attendus d'UVS

| Visuel | Usage prévu | Format conseillé |
|---|---|---|
| Logotype **RADIANCE** haute définition | Remplacer le mot stylé « Radiance » de l'en-tête TV | SVG, ou PNG à fond transparent d'au moins 1200 px de large ; version pour fond clair |
| **Key art Radiance HD** sans logo incrusté | Éventuel fond ou bandeau (l'actuel, trop petit, n'est pas affiché) | JPG/WebP, 3840 × 2160 px (16:9), < 1 Mo |
| Logo Riftbound en **SVG** (facultatif) | Netteté parfaite en 4K | SVG |
| Charte (couleurs, polices officielles), si elle existe | Ajuster les variables `--rb-*` de `public/shared/theme.css` | — |

## Remplacer ou ajouter un visuel

- **Logo Riftbound** : remplacer `riftbound-logo.webp` par un fichier du même
  nom. Pour un autre format (SVG, PNG), déposer le fichier avec sa vraie
  extension et modifier l'attribut `src` des balises `<img>` dans
  `public/ecran/index.html`, `public/accueil/index.html` et `public/login.html`.
  Recadrer au plus près du dessin (pas de marge transparente inutile) : la
  hauteur est fixée, une marge rendrait le logo plus petit.
- **Logotype RADIANCE** : dans `public/ecran/index.html`, remplacer
  `<p class="rb-radiance wordmark">Radiance</p>` par
  `<img class="wordmark-img" src="/assets/radiance-logo.svg" alt="Radiance">`
  (la classe `.wordmark-img` est déjà prévue dans `public/ecran/ecran.css`,
  avec la bonne hauteur en paysage et en portrait).

Les couleurs, le halo et la police (Inter, auto-hébergée) se règlent dans
`public/shared/theme.css` (variables `--rb-*`, classes `.rb-halo`,
`.rb-logo-card`, `.rb-radiance`).

## Tester après remplacement

1. Lancer l'application : `npm start` (ou avec des données de démonstration :
   `DATA_DIR=./data-demo node scripts/demo-seed.js` puis
   `DATA_DIR=./data-demo npm start`).
2. Ouvrir `http://localhost:3000/ecran` et recharger la page (Ctrl + Maj + R
   pour ignorer le cache du navigateur).
3. Vérifier les deux mises en page :
   - paysage : fenêtre en 1920 × 1080 (plein écran avec F11) ;
   - portrait : `http://localhost:3000/ecran?orientation=portrait`, ou outils de
     développement du navigateur (Ctrl + Maj + M) en 1080 × 1920.
4. Contrôler que les logos sont nets, lisibles de loin et ne sont pas coupés.

Astuce : sur une TV montée à la verticale dont la source (Chromecast, mini-PC)
ne sait pas pivoter l'image, utiliser `/ecran?rotation=90` (ou `-90`) : la page
pivote d'elle-même et passe en mise en page portrait.
