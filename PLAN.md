# Lobby Riftbound – Paris Games Week

Application de gestion de file d'attente et de placement aux tables pour le stand
Riftbound (set **Radiance**) de la Paris Games Week.

## Objectif

À leur arrivée, les visiteurs s'enregistrent à l'accueil (prénom, nom, numéro
de billet et, s'ils acceptent de le donner, email). Ils sont mis en file
d'attente puis placés automatiquement à une table dès qu'un emplacement se
libère. Chaque partie dure **1 heure** : c'est le temps à rester à table pour
gagner les goodies, une **carte promo** que le joueur vient chercher à la
**boutique** à la fin de sa démo. Un écran TV diffuse le plan des tables et la
file d'attente ; une page dédiée permet au personnel de la boutique de vérifier
qu'un visiteur a droit à sa carte et de cocher sa remise.

## Organisation du stand

- 9 tables de 4 places, disposées en grille 3×3 (voir `docs/plan-stand-*.png|webp`).
- Numérotation : de 1 à 9, de gauche à droite puis de haut en bas.
- Chaque table accueille **2 matchs 1v1** : l'emplacement **A** (moitié gauche,
  les deux joueurs face à face) et l'emplacement **B** (moitié droite).
- Soit **18 matchs simultanés** au maximum.

## Règles métier

### Inscription
- L'hôtesse saisit prénom, nom, numéro de billet et email pour **1 joueur
  seul** ou **2 joueurs inscrits ensemble** (ils seront placés ensemble).
- Prénom, nom et **numéro de billet** sont **obligatoires**. L'**email est
  facultatif** : un visiteur peut refuser de le donner (champ vide, aucun
  contrôle de doublon ; `check({ email: '' })` renvoie `email: null`). S'il est
  saisi, il doit être **valide** et **unique**, comme le billet.
- Un **email** ou un **numéro de billet** déjà utilisé (quel que soit le jour du
  salon) est **refusé**. Deux joueurs inscrits ensemble ne peuvent pas avoir le
  même billet, ni le même email (s'ils en donnent un).
  - Exception : un joueur **retiré pour absence** (« Retirer » dans la file, ou
    « Absent » à sa table), encore **en attente lors de la remise à zéro du
    matin**, ou dont la partie a été **interrompue par « Nouvelle journée »**
    n'a pas joué (ou pas jusqu'au bout sans le vouloir) ; il peut se réinscrire.
  - Un joueur parti avant la fin (« Libérer sans goodies ») ou dont la partie
    a été terminée par l'hôtesse (« Terminer la partie (goodies) ») a
    participé : il reste bloqué.
- Normalisation : email en minuscules sans espaces autour ; billet en
  majuscules, sans espaces, tirets, points ni underscores.

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
- **Timer écoulé** → partie terminée, les joueurs ont droit aux goodies (la
  carte promo, voir « Goodies : la carte promo » : page boutique, ou liste
  « Goodies à remettre » côté accueil, bouton « Remis »), l'emplacement est
  libéré et la paire suivante est placée.
- Avant la fin du timer, deux façons de libérer l'emplacement (action
  `releaseMatch`, résultat `{ released, withGoodies }`) :
  - **« Terminer la partie (goodies) »** (`releaseMatch { matchId, withGoodies:
    true }`) : l'hôtesse confirme la participation (les joueurs ont bien joué).
    Partie terminée comme à la fin du timer : joueurs « partie terminée »,
    goodies dus (liste « 03 Goodies à remettre »), emplacement réattribué.
  - **« Libérer sans goodies »** (`releaseMatch { matchId }`) → départ
    anticipé : joueurs « parti avant la fin », pas de goodies, emplacement
    réattribué. Si le timer est déjà écoulé (le serveur ne l'a pas encore
    traité), la partie est quand même terminée normalement, goodies dus
    (`withGoodies: true` dans le résultat).
  - Dans les deux cas, l'action concerne tous les joueurs encore à
    l'emplacement et ne s'annule pas.
- L'hôtesse peut ajouter/retirer du temps à une partie en cours (retirer plus
  que le temps restant termine la partie, goodies dus).

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
- **Au-delà des 15 minutes**, « Absent » est refusé. « Libérer sans goodies »
  termine la partie pour **les deux joueurs** (départ anticipé, pas de goodies,
  joueurs bloqués), y compris un partenaire présent : on ne l'utilise que s'il
  n'y a plus personne à la table. « Terminer la partie (goodies) » donnerait,
  lui, les goodies aux deux, absent compris. Si le partenaire est là, on laisse
  la partie continuer (un animateur remplace l'absent, rien ne change dans
  l'application) ; l'absent figurera dans « Goodies à remettre » et ne doit pas
  les recevoir.

### Goodies : la carte promo (remise en boutique)
- Les goodies sont une **carte promo** : **une par joueur** (une paire = deux
  cartes, chaque joueur a son billet et sa ligne).
- **Droit à la carte** : participant « partie terminée » (`completed`) : timer
  écoulé, « Terminer la partie (goodies) », « −5 min » au-delà du temps restant,
  partie au timer écoulé terminée par « Nouvelle journée ». **Pas de carte**
  pour les autres statuts (en file, en jeu, parti avant la fin, retiré / absent,
  expiré, interrompu) : `giveGoodies` est refusé (code `conflict`).
- **Remise en boutique** : après sa démo, le visiteur va à la boutique et donne
  son **numéro de billet** ou son **nom** ; le personnel voit sur `/boutique`
  s'il doit recevoir une carte, la lui donne et **coche la remise**
  (`giveGoodies { participantId, given: true }`, résultat
  `{ participantId, given }`). L'accueil peut aussi la remettre (« Remis » dans
  « Goodies à remettre »).
- **Une seule fois** : une seconde remise est **refusée**, quel que soit le
  poste (boutique ou accueil, y compris deux postes au même instant : la
  première l'emporte) : code `already_given`, message « Carte promo déjà remise
  le JJ/MM à HH:MM. » (heure de Paris), `details.givenAt`.
- **Annulable** : `giveGoodies { participantId, given: false }` efface la
  remise (erreur de coche) ; la carte redevient due.
- **Sans limite de jour** : une carte non remise reste due les jours suivants.
  La liste de la boutique couvre tous les jours du salon ; celle de l'accueil
  (« Goodies à remettre »), le jour en cours seulement ; les recherches, tous
  les jours.
- Cas de l'absent repéré après les 15 minutes (voir plus haut) : il figure
  parmi les cartes dues, mais ne doit pas la recevoir.

### Rôle boutique
- Mot de passe **`BOUTIQUE_PASSWORD`**, **facultatif** et **différent** de
  `ACCUEIL_PASSWORD`. Absent (ou identique à celui de l'accueil, avec un
  avertissement au démarrage) : pas de rôle boutique, seul le mot de passe de
  l'accueil ouvre `/boutique`.
- Même page `/login` : le mot de passe saisi détermine le rôle (accueil →
  `/accueil`, boutique → `/boutique`). Session de 7 jours ; chaque rôle a sa
  propre clé de signature (changer un mot de passe ne déconnecte que son rôle).
- Droits : la page `/boutique` et deux actions, **`boutiqueSearch`** et
  **`giveGoodies`** (remise ou annulation). Toute autre action → code
  `forbidden` ; `/accueil` et `/api/export.csv` refusés (renvoi vers `/login`,
  qui ramène à `/boutique`).
- Données : prénom, nom, billet, statut, jour d'inscription, table et heure de
  fin, date de remise. **Jamais l'email** (accepté comme critère de recherche,
  jamais renvoyé), ni le plan des tables ni la file.
- Recherche `boutiqueSearch { query }` : 2 caractères au moins ; nom et prénom
  (accents et majuscules ignorés) ou billet (normalisé comme à l'inscription) ;
  billet exact en tête, puis cartes dues, puis inscriptions les plus récentes
  (25 résultats au plus).
- L'accueil a aussi accès à `/boutique` et à ces deux actions.

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
- En-tête de l'écran TV : logo officiel Riftbound, « Paris Games Week · Stand
  Riftbound », horloge et état de la connexion. **Ni mot « Radiance » ni
  pastille « Nouveau set »**, et **pas de bandeau en bas** (« Inscrivez-vous à
  l'accueil pour jouer ! », « 1 heure de jeu = goodies offerts » et ses
  variantes stand fermé) : retirés à la demande du client.
- Stand fermé : l'écran TV n'affiche plus la file (message de fin de journée à
  la place) et les emplacements libres y sont marqués « Fermé ».

## Architecture technique

| Élément | Choix |
|---|---|
| Serveur | Node.js 22, Express, Socket.IO (temps réel) |
| Données | SQLite (`better-sqlite3`), fichier sur volume persistant |
| Front | HTML/CSS/JS sans étape de build (servis par Express) |
| Timers | Calculés côté serveur depuis `ends_at` enregistré : résistants aux rafraîchissements et redémarrages |
| Auth | Deux rôles : accueil (`ACCUEIL_PASSWORD`, accès complet) et boutique (`BOUTIQUE_PASSWORD`, facultatif : cartes promo seulement) ; cookie signé HMAC, une clé par rôle |
| Proxy / HTTPS | En-têtes `X-Forwarded-*` crus seulement depuis les proxys de confiance (`TRUST_PROXY`, par défaut adresses locales et privées) ; en HTTPS : cookie `Secure` et en-tête HSTS |
| Déploiement | `Dockerfile` construit par Coolify depuis GitHub, sur VPS Hostinger KVM2 |
| Tests | `node:test`, horloge injectable |

### Pages
- `/ecran` : écran TV public (lecture seule), plan + file. Paysage (file à
  droite) ou portrait (file en dessous), Full HD.
- `/accueil` : interface hôtesse (protégée, accueil seulement).
- `/boutique` : remise des cartes promo (protégée : boutique ou accueil).
- `/login` : connexion (accueil ou boutique selon le mot de passe).
- `/api/export.csv` : export de tous les participants (accueil seulement).
- `/healthz` : sonde de santé.

### Données (SQLite)
- `days` : une ligne par journée du salon.
- `participants` : identité, email/billet normalisés (index uniques partiels),
  statut (`waiting`, `playing`, `completed`, `left_early`, `removed`, `expired`,
  `interrupted`), remise de la carte promo (`goodies_given_at`, une seule
  fois, annulable).
- `entries` : unités de file (1 ou 2 joueurs), position, statut, drapeau animateur.
- `matches` : table, emplacement, début, fin prévue, fin réelle, raison.
- `settings` : durée des parties, tables hors service, stand fermé
  (`placements_paused`), secret de session.

### Temps réel (Socket.IO)
- Les clients publics reçoivent `state` (projection publique, noms abrégés).
- Les clients authentifiés (salle `admin`) reçoivent l'état complet.
- Les clients de la boutique (salle `boutique`) reçoivent l'état boutique :
  `{ serverNow, day, pending, recentGiven, stats }` (cartes dues de tous les
  jours, plus récentes d'abord ; 20 dernières remises ; compteurs `pending`,
  `givenToday`, `givenTotal`, `playing`), sans email.
- À la connexion, chaque client reçoit `session` `{ admin, role }`
  (`role` : `'admin'`, `'boutique'` ou `null`).
- Les actions de l'accueil passent par l'événement `action`
  `{ type, payload }` avec accusé de réception `{ ok, result | code, message }`.
  La boutique n'a droit qu'à `boutiqueSearch` et `giveGoodies`.
- Chaque état contient `serverNow` pour synchroniser les comptes à rebours, et
  `settings` (durée, tables hors service, `placementsPaused`, `noShowWindowMs`).
- Transports Socket.IO par défaut : long-polling HTTP d'abord, puis passage au
  WebSocket. Si le WebSocket est bloqué (Wi-Fi du salon, proxy), la connexion
  reste en long-polling et fonctionne quand même.

## Direction artistique

Direction « Aurore holographique » (lauréate du concours de design pour le
look), appliquée à l'ergonomie de la version éditoriale (lauréate pour
l'ergonomie) : fond nacré perle à halos irisés cyan → lavande → rose et cercles
concentriques du key art (dégradés statiques pré-calculés, aucun flou en
direct), cartes en verre clair, médaillons et anneaux de progression irisés,
polices Outfit et Inter, crépuscule mauve quand le stand est fermé. **Orange Riftbound** pour l'action (places libres,
« À appeler », bouton principal ; texte encre sur l'orange), **rose** pour les
5 dernières minutes. Logo officiel Riftbound posé sur une carte nacrée claire,
seule marque affichée en tête de l'écran TV (le mot « Radiance » et la pastille
« Nouveau set » ont été retirés à la demande du client) ; un key art HD est
attendu d'UVS (propriété de Riot Games / UVS Games, voir
`public/assets/README.md`). Détails dans le README (section « Interface »).

## Étapes

1. Fondations : base de données, moteur de placement, serveur temps réel, tests.
2. Interface d'accueil.
3. Écran TV et thème Radiance.
4. Dockerfile, guide de déploiement Coolify, export CSV.
5. Revue critique et corrections.
6. Fermeture du stand le soir, « Absent » après placement.
7. Refonte visuelle et ergonomique (DA Radiance, logo officiel, « À appeler »,
   panneau d'actions d'emplacement, attente estimée sur la TV).
8. Retours du client : email facultatif, « Terminer la partie (goodies) » à
   côté de « Libérer sans goodies », raccourci de recherche Ctrl+K (⌘K sur
   Mac) et « / » (Alt+R, intercepté par certains navigateurs, reste en
   secours), écran TV sans bandeau du bas ni « Radiance / Nouveau set ».
9. Page boutique : les goodies sont une carte promo remise à la boutique ;
   rôle boutique (mot de passe dédié, recherche et remise seulement, sans
   email), remise unique et annulable, synchronisée avec l'accueil.
