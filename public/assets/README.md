# Visuels de l'écran TV (`public/assets/`)

Les fichiers de ce dossier sont des **visuels de remplacement** créés pour le
projet : ils ne sont **pas** les logos officiels. Les logos et illustrations
Riftbound / Radiance appartiennent à Riot Games et UVS Games et ne doivent être
utilisés qu'avec leur accord (fichiers fournis par UVS pour l'événement).

Pour passer aux visuels officiels, il suffit de **remplacer les fichiers en
gardant le même nom** : aucune modification de code n'est nécessaire.

## Fichiers à remplacer

| Fichier | Où il apparaît | Format conseillé | Taille conseillée |
|---|---|---|---|
| `logo-riftbound.svg` | En-tête de l'écran TV, en haut à gauche | SVG (idéal) ou PNG à fond transparent | PNG : au moins **1200 px de large** ; version claire/dorée lisible sur fond bleu nuit |
| `logo-radiance.svg` | En-tête, à droite du logo Riftbound | SVG ou PNG à fond transparent | PNG : au moins **800 px de large** |
| `background.svg` | Fond décoratif de toute la page (affiché à 50 % d'opacité) | SVG, ou image JPG/WebP | Image : **3840 × 2160 px** (16:9), sombre, < 1 Mo |

Détails d'affichage :

- **Logos** : la hauteur est fixée (environ 5 % de la hauteur de l'écran pour
  Riftbound, 3,5 % pour Radiance, soit ~56 px et ~37 px en Full HD) et la largeur
  suit les proportions du fichier. N'importe quel format de logo convient
  (horizontal de préférence) ; recadrez au plus près du dessin, sans marge
  transparente inutile, sinon le logo paraîtra plus petit.
- **Fond** : affiché en mode « couvrir » (`cover`), centré en haut. En portrait
  (1080 × 1920), les côtés de l'image sont rognés : gardez l'essentiel au centre.
  Préférez une image sombre et peu contrastée (les tables et les noms passent
  par-dessus). Une illustration du set (Ekko, Evelynn, Seraphine…) assombrie
  fonctionne très bien.

### Utiliser un autre format (PNG, WebP…)

Un PNG simplement renommé en `.svg` ne s'affichera pas. Si le fichier officiel
n'est pas un SVG, déposez-le avec sa vraie extension (ex. `logo-riftbound.png`)
puis modifiez le chemin correspondant :

- logos : attribut `src` des balises `<img>` dans `public/ecran/index.html` ;
- fond : `url('/assets/background.svg')` dans `public/ecran/ecran.css`
  (règle `.backdrop`).

Les couleurs et polices du thème (bleu nuit, bleu Riftbound, or « Radiance »,
Cinzel / Barlow) se règlent dans `public/shared/theme.css` (variables `--rb-*`).

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
4. Contrôler que les logos sont nets, lisibles de loin et ne sont pas coupés,
   et que le fond ne gêne pas la lecture des noms et des comptes à rebours.

Astuce : sur une TV montée à la verticale dont la source (Chromecast, mini-PC)
ne sait pas pivoter l'image, utiliser `/ecran?rotation=90` (ou `-90`) : la page
pivote d'elle-même et passe en mise en page portrait.
