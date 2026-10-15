# Lobby Riftbound – Paris Games Week

Application de gestion de file d'attente et de placement aux tables pour le stand
Riftbound (set **Radiance**) de la Paris Games Week.

## Objectif

À leur arrivée, les visiteurs s'enregistrent à l'accueil (prénom, nom, email,
numéro de billet). Ils sont mis en file d'attente puis placés automatiquement à
une table dès qu'un emplacement se libère. Chaque partie dure **1 heure** :
c'est le temps à rester à table pour gagner les goodies. Un écran TV diffuse le
plan des tables et la file d'attente.

## Organisation du stand

- 9 tables de 4 places, disposées en grille 3×3 (voir `docs/plan-stand-*.png|webp`).
- Numérotation : de 1 à 9, de gauche à droite puis de haut en bas.
- Chaque table accueille **2 matchs 1v1** : l'emplacement **A** (moitié gauche,
  les deux joueurs face à face) et l'emplacement **B** (moitié droite).
- Soit **18 matchs simultanés** au maximum.

## Règles métier

### Inscription
- L'hôtesse saisit prénom, nom, email et numéro de billet pour **1 joueur seul**
  ou **2 joueurs inscrits ensemble** (ils seront placés ensemble).
- Un **email** ou un **numéro de billet** déjà utilisé (quel que soit le jour du
  salon) est **refusé**.
  - Exception : un joueur **retiré pour absence** ou encore **en attente lors de
    la remise à zéro du matin** n'a pas joué ; il peut se réinscrire.
  - Un joueur parti avant la fin (« Libérer l'emplacement ») a participé : il
    reste bloqué.
- Normalisation : email en minuscules sans espaces ; billet en majuscules, sans
  espaces, tirets, points ni underscores.

### Formation des paires (unité de placement = un match)
- Deux joueurs inscrits ensemble forment une paire.
- Un joueur seul est associé au **premier autre joueur seul de la file**, même
  s'il est loin derrière : le second joueur remonte alors à la place du premier.
- S'il n'y a pas d'autre joueur seul, le joueur seul attend et **les paires
  derrière lui passent devant** (on ne bloque pas la file).
- Bouton **« Placer quand même »** : le joueur seul est rendu prêt immédiatement
  et joue contre un **animateur**. Si un autre joueur seul arrive avant qu'un
  emplacement se libère, les deux sont associés (l'animateur n'est plus requis).

### Placement automatique
- Déclenché à chaque inscription, libération d'emplacement, fin de timer,
  réactivation de table.
- On prend la première entrée **prête** de la file (paire, ou joueur seul
  « placé quand même »).
- Choix de l'emplacement : en priorité une **table entièrement libre** (plus
  petit numéro d'abord, emplacement A), sinon une **demi-table** libre.
- Le **timer** démarre au placement (durée réglable, 1 h par défaut ; un
  changement de durée s'applique aux parties suivantes).

### Fin de partie
- **Timer écoulé** → partie terminée, les joueurs ont droit aux goodies
  (liste « Goodies à remettre » côté accueil, bouton « Remis »), l'emplacement
  est libéré et la paire suivante est placée.
- **« Libérer l'emplacement »** → départ anticipé : pas de goodies.
- L'hôtesse peut ajouter/retirer du temps à une partie en cours.

### File d'attente
- **« Retirer »** : sort de la file un joueur absent à l'appel. Si c'était un
  membre d'une paire, son partenaire redevient joueur seul (à la même place).
- **« Nouvelle journée »** (bouton, le matin, avec confirmation) : vide la file
  (les joueurs en attente passent en « expiré »), clôt les éventuelles parties
  encore en cours. **Tous les participants restent en base.**
- Une table peut être mise **hors service** (plus de nouveaux placements).

### Affichage public
- Sur l'écran TV, uniquement **Prénom + initiale du nom** (« Lucas M. »).
  Jamais l'email ni le billet.

## Architecture technique

| Élément | Choix |
|---|---|
| Serveur | Node.js 22, Express, Socket.IO (temps réel) |
| Données | SQLite (`better-sqlite3`), fichier sur volume persistant |
| Front | HTML/CSS/JS sans étape de build (servis par Express) |
| Timers | Calculés côté serveur depuis `ends_at` enregistré : résistants aux rafraîchissements et redémarrages |
| Auth accueil | Mot de passe unique (`ACCUEIL_PASSWORD`), cookie signé HMAC |
| Déploiement | `Dockerfile` construit par Coolify depuis GitHub, sur VPS Hostinger KVM2 |
| Tests | `node:test`, horloge injectable |

### Pages
- `/ecran` : écran TV public (lecture seule), plan + file. Paysage (file à
  droite) ou portrait (file en dessous), Full HD.
- `/accueil` : interface hôtesse (protégée).
- `/login` : connexion.
- `/api/export.csv` : export de tous les participants (protégé).
- `/healthz` : sonde de santé.

### Données (SQLite)
- `days` : une ligne par journée du salon.
- `participants` : identité, email/billet normalisés (index uniques partiels),
  statut (`waiting`, `playing`, `completed`, `left_early`, `removed`, `expired`,
  `interrupted`), remise des goodies.
- `entries` : unités de file (1 ou 2 joueurs), position, statut, drapeau animateur.
- `matches` : table, emplacement, début, fin prévue, fin réelle, raison.
- `settings` : durée des parties, tables hors service, secret de session.

### Temps réel (Socket.IO)
- Les clients publics reçoivent `state` (projection publique, noms abrégés).
- Les clients authentifiés (salle `admin`) reçoivent l'état complet.
- Les actions de l'accueil passent par l'événement `action`
  `{ type, payload }` avec accusé de réception `{ ok, result | code, message }`.
- Chaque état contient `serverNow` pour synchroniser les comptes à rebours.

## Direction artistique

Thème **inspiré** de Riftbound – Radiance (set 5) : fond bleu nuit profond,
accents or et lumière radiante, halos lumineux. Les logos et visuels officiels
(propriété de Riot Games / UVS Games) sont des **emplacements remplaçables**
dans `public/assets/` (voir `public/assets/README.md`).

## Étapes

1. Fondations : base de données, moteur de placement, serveur temps réel, tests.
2. Interface d'accueil.
3. Écran TV et thème Radiance.
4. Dockerfile, guide de déploiement Coolify, export CSV.
5. Revue critique et corrections.
