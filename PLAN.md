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
  - Exception : un joueur **retiré pour absence** (« Retirer » dans la file, ou
    « Absent » à sa table), encore **en attente lors de la remise à zéro du
    matin**, ou dont la partie a été **interrompue par « Nouvelle journée »**
    n'a pas joué (ou pas jusqu'au bout sans le vouloir) ; il peut se réinscrire.
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
  réactivation de table, partie annulée (« Absent ») et réouverture du stand ;
  le serveur vérifie aussi chaque seconde.
- **Aucun placement tant que le stand est fermé** (voir « Fermeture du stand »).
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

### Joueur absent à sa table (« Absent »)
- Un joueur **placé** qui ne se présente pas à sa table peut être déclaré
  **« Absent »** pendant les **15 minutes** qui suivent le **début de la partie**
  (`noShowWindowMs`, compté depuis le placement ; « +5 min » ne prolonge pas ce
  délai).
- L'absent passe « retiré » : **pas de goodies**, et il **peut se réinscrire**
  (il n'a pas joué ; il repart en fin de file).
- Si son **partenaire est là**, la partie **continue contre un animateur**,
  avec le même timer ; le partenaire a droit aux goodies s'il va au bout.
- S'il ne reste **plus personne** (les deux joueurs absents, ou joueur seul
  contre un animateur), la partie est **annulée** : personne n'est marqué
  « parti avant la fin » et l'emplacement est réattribué aux suivants de la
  file (sauf si le stand est fermé).
- **Au-delà des 15 minutes**, « Absent » est refusé. « Libérer
  l'emplacement » termine la partie pour **les deux joueurs** (départ anticipé,
  pas de goodies, joueurs bloqués), y compris un partenaire présent : on ne
  l'utilise que s'il n'y a plus personne à la table. Si le partenaire est là,
  on laisse la partie continuer (un animateur remplace l'absent, rien ne change
  dans l'application) ; l'absent figurera dans « Goodies à remettre » et ne
  doit pas les recevoir.

### Fermeture du stand (le soir)
- Bouton **« Fermer le stand »** / **« Rouvrir le stand »** (réglage
  `placementsPaused`, visible dans l'état public et admin).
- Stand fermé : **plus aucun placement automatique**. Les parties en cours
  continuent normalement jusqu'à la fin de leur timer (goodies compris) ; les
  emplacements libérés restent vides.
- À l'accueil, la file reste visible et les inscriptions restent possibles,
  mais **personne n'est placé**. L'écran TV, lui, remplace la file par un
  message de fin de journée (« Le stand ferme ses portes », inscriptions
  closes) : les noms en attente n'y apparaissent plus.
- Usage prévu : le soir, à la fermeture, pour éviter que la file soit placée
  pendant la nuit (chaque place libérée serait sinon aussitôt redonnée).
  **Ce n'est pas une pause en journée** (la TV annonce la fin de la journée et
  la file s'en va) : pour suspendre les placements un moment, on met les
  tables hors service.
- **« Nouvelle journée »** rouvre le stand ; les joueurs encore en file passent
  en « expiré » et peuvent se réinscrire.

### File d'attente
- **« Retirer »** : sort de la file un joueur absent à l'appel. Si c'était un
  membre d'une paire, son partenaire redevient joueur seul (à la même place).
  (Joueur déjà placé : « Absent », voir plus haut.)
- **« Nouvelle journée »** (bouton, le matin, avec confirmation) : vide la file
  (les joueurs en attente passent en « expiré »), termine normalement les
  parties dont le timer est écoulé, interrompt (sans goodies) celles encore en
  cours et **rouvre le stand** s'il était fermé. **Tous les participants restent
  en base.**
- Une table peut être mise **hors service** (plus de nouveaux placements).

### Affichage public
- Sur l'écran TV, uniquement **Prénom + initiale du nom** (« Lucas M. »).
  Jamais l'email ni le billet.
- Stand fermé : l'écran TV n'affiche plus la file (message de fin de journée à
  la place) et les emplacements libres y sont marqués « Fermé ».

## Architecture technique

| Élément | Choix |
|---|---|
| Serveur | Node.js 22, Express, Socket.IO (temps réel) |
| Données | SQLite (`better-sqlite3`), fichier sur volume persistant |
| Front | HTML/CSS/JS sans étape de build (servis par Express) |
| Timers | Calculés côté serveur depuis `ends_at` enregistré : résistants aux rafraîchissements et redémarrages |
| Auth accueil | Mot de passe unique (`ACCUEIL_PASSWORD`), cookie signé HMAC |
| Proxy / HTTPS | En-têtes `X-Forwarded-*` crus seulement depuis les proxys de confiance (`TRUST_PROXY`, par défaut adresses locales et privées) ; en HTTPS : cookie `Secure` et en-tête HSTS |
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
- `settings` : durée des parties, tables hors service, stand fermé
  (`placements_paused`), secret de session.

### Temps réel (Socket.IO)
- Les clients publics reçoivent `state` (projection publique, noms abrégés).
- Les clients authentifiés (salle `admin`) reçoivent l'état complet.
- Les actions de l'accueil passent par l'événement `action`
  `{ type, payload }` avec accusé de réception `{ ok, result | code, message }`.
- Chaque état contient `serverNow` pour synchroniser les comptes à rebours, et
  `settings` (durée, tables hors service, `placementsPaused`, `noShowWindowMs`).
- Transports Socket.IO par défaut : long-polling HTTP d'abord, puis passage au
  WebSocket. Si le WebSocket est bloqué (Wi-Fi du salon, proxy), la connexion
  reste en long-polling et fonctionne quand même.

## Direction artistique

Thème clair fidèle à la DA Riftbound – Radiance (set 5) : fond nacré éclairé
par un halo irisé statique (cyan, lavande, rose, cercles concentriques),
panneaux blancs, police Inter, **orange Riftbound** pour l'action et l'urgence,
**cyan** pour les places libres. Logo officiel Riftbound posé sur fond clair ;
le logotype Radiance et un visuel HD sont attendus d'UVS (propriété de Riot
Games / UVS Games, voir `public/assets/README.md`). Détails dans le README
(section « Interface »).

## Étapes

1. Fondations : base de données, moteur de placement, serveur temps réel, tests.
2. Interface d'accueil.
3. Écran TV et thème Radiance.
4. Dockerfile, guide de déploiement Coolify, export CSV.
5. Revue critique et corrections.
6. Fermeture du stand le soir, « Absent » après placement.
7. Refonte visuelle et ergonomique (DA Radiance, logo officiel, « À appeler »,
   panneau d'actions d'emplacement, attente estimée sur la TV).
