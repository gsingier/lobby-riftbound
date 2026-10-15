# Guide de l'accueil – Stand Riftbound (Paris Games Week)

Ce guide est destiné aux hôtesses et animateurs du stand. Il se lit en 10
minutes ; le [mémo](#mémo--quelle-action-pour-quelle-situation-) en fin de page
résume tout.

## L'essentiel

- Vous **inscrivez** les visiteurs (seuls ou à deux) : l'application les
  **place automatiquement** à une table dès qu'une place se libère, et l'écran
  TV indique où aller.
- Une partie dure **1 heure**. Rester jusqu'au bout = **goodies**. Partir avant
  = pas de goodies.
- Un **email** et un **numéro de billet** ne servent **qu'une fois sur tout le
  salon**.
- Le stand compte **9 tables numérotées de 1 à 9** (de gauche à droite, puis de
  haut en bas). Chaque table accueille **2 matchs** : l'emplacement **A** (moitié
  gauche) et l'emplacement **B** (moitié droite), soit 18 matchs en même temps.
  Dans chaque match, le **joueur 1** s'assoit sur la **chaise du haut** (côté
  numéro de table) et le **joueur 2** sur la **chaise du bas**.
- L'écran TV n'affiche que le **prénom et l'initiale du nom** (« Lucas M. »),
  jamais l'email ni le billet.
- Le soir : **« Fermer le stand »** (plus personne n'est placé). Le matin :
  **« Nouvelle journée »** (la file repart de zéro et le stand rouvre).

> Les noms des boutons cités ici sont ceux de l'application au moment de la
> rédaction ; ils peuvent varier légèrement.

## L'écran de l'accueil en un coup d'œil

L'écran suit votre boucle de travail, numérotée **01 → 02 → 03** :

| Zone | Où | Rôle |
|---|---|---|
| **Barre du haut** | tout en haut | Logo, « Accueil », **jour du salon**, compteurs (En attente, En jeu, Terminés, **Goodies**, Total), **Rechercher**, état de la connexion, **Réglages** (roue dentée), **Fermer le stand**, **Nouvelle journée**, menu **« ⋯ »** (Exporter CSV, Déconnexion) |
| **01 Inscrire** | colonne de gauche | Formulaire d'inscription, attente estimée, cadre de résultat à annoncer |
| **02 À appeler** | en haut au centre | Joueurs placés **automatiquement** à appeler, avec leur table ([partie 4](#4-appeler-les-joueurs-placés---à-appeler-)) |
| **Plan des tables** | au centre | Les 9 tables et leurs comptes à rebours ; un clic sur un emplacement ouvre ses actions ([partie 8](#8-pendant-les-parties)) |
| **03 Goodies à remettre** | colonne de droite, en haut | Joueurs allés au bout de leur partie ([partie 9](#9-remettre-les-goodies)) |
| **File d'attente** | colonne de droite | Ordre de passage et heure estimée de chaque entrée |

- **Les compteurs sont cliquables** : « En attente » mène à la file,
  « En jeu » au plan, « Goodies » à la liste des goodies (le compteur passe
  en or quand des goodies sont à remettre).
- **Sur une tablette ou un petit écran**, le plan, la file et les goodies sont
  regroupés sous des **onglets** (« Plan des tables », « File d'attente »,
  « Goodies », avec leur nombre) ; « Nouvelle journée » passe dans le menu
  « ⋯ », la recherche devient une loupe et l'état de la connexion un simple
  point vert.
- **Les notifications** (confirmation d'une action, erreur, fin de partie)
  s'affichent quelques secondes **en haut de l'écran, sur la barre** : elles ne
  cachent jamais un panneau. La souris les rend transparentes ; la croix « × »
  les ferme.
- **Les bandeaux d'état** s'affichent sous la barre, sur toute la largeur :
  **noir** « Stand fermé » (orange le matin, voir la
  [partie 2](#2-chaque-matin---nouvelle-journée-)), **rouge** « Connexion au
  serveur perdue ».

---

## 1. Installer les écrans (le matin)

Le responsable du stand vous donne **l'adresse** de l'application (par ex.
`https://lobby.exemple.fr`) et le **mot de passe** de l'accueil.

### Le poste d'accueil (ordinateur ou tablette)

1. Ouvrez un navigateur récent (Chrome, Edge, Firefox ou Safari) à l'adresse
   **`…/accueil`**.
2. Saisissez le mot de passe (bouton « Afficher » pour le vérifier), puis
   **« Se connecter »**. L'appareil reste connecté 7 jours.
3. Dans la barre du haut, l'indicateur doit afficher **« Connecté »** (point
   vert).

Plusieurs postes d'accueil peuvent être ouverts en même temps : tout est
synchronisé instantanément. Seule la liste « À appeler » est propre à chaque
poste ([partie 4](#4-appeler-les-joueurs-placés---à-appeler-)).

### La TV (écran public)

1. Sur l'ordinateur relié à la TV, ouvrez **`…/ecran`** (pas de mot de passe).
2. Passez en **plein écran** : touche **F11** (Windows, dans Chrome, Edge ou
   Firefox) ; sur Mac : **Ctrl + Cmd + F**. Le pointeur de la souris est masqué
   sur l'écran TV.
3. **Désactivez la mise en veille**, sinon l'écran s'éteindra en pleine journée :
   - sur la **TV** : désactivez la veille automatique / l'arrêt automatique et
     les modes « éco » (dans les réglages de la TV, selon le modèle) ;
   - sur l'**ordinateur** : Windows → *Paramètres* → *Système* → *Alimentation*
     → écran et mise en veille sur **« Jamais »** ; Mac → *Réglages Système* →
     *Écran verrouillé* (ou *Économiseur d'écran*) → **« Jamais »**. Désactivez
     aussi l'économiseur d'écran.
4. En haut à droite de l'écran, sous l'horloge, le voyant doit indiquer
   **« En direct »**.

TV posée à la verticale : la page s'adapte toute seule. Si l'image n'est pas
tournée (l'appareil relié à la TV ne sait pas pivoter l'affichage), ajoutez
`?rotation=90` à l'adresse (ou `?rotation=-90` dans l'autre sens) :
`…/ecran?rotation=90`.

L'horloge de l'écran est à l'heure de Paris et les comptes à rebours sont
calculés par le serveur : ils sont justes même si l'horloge de la TV est fausse.

Ce que montre la TV : le plan des 9 tables (places **libres** en cyan, parties
en cours avec leur compte à rebours, **5 dernières minutes** encadrées en
orange, étiquette **« Nouveau »** pendant 2 minutes sur les joueurs qui viennent
d'être placés), l'**attente estimée pour une nouvelle inscription** (ou « places
libres maintenant »), la liste **« À vos tables ! »** des joueurs placés depuis
moins de 3 minutes, et la **file d'attente** avec l'heure de passage estimée.

---

## 2. Chaque matin : « Nouvelle journée »

Avant l'ouverture, **une seule fois par jour** :

1. Cliquez sur **« Nouvelle journée »** dans la barre du haut (sur une tablette :
   menu **« ⋯ »** → « Nouvelle journée… »). Si le stand a été fermé la veille,
   le bandeau orange **« Stand fermé depuis la veille : démarrez la nouvelle
   journée »** propose aussi le bouton **« Nouvelle journée… »** ; le bouton de
   la barre passe en orange (sur une tablette, un point orange apparaît sur
   « ⋯ »).
2. La fenêtre de confirmation indique ce qui va se passer : nombre de joueurs
   encore en file, parties encore en cours, goodies non remis, réouverture du
   stand.
3. Confirmez avec **« Démarrer le jour N »** (le bouton « Annuler » est
   sélectionné par défaut).

Effets :

- la **file d'attente est vidée** : les joueurs qui attendaient la veille
  pourront se **réinscrire** (leur email et leur billet ne sont pas bloqués) ;
- les parties encore en cours sont **interrompues** (sans goodies) ; ces
  joueurs pourront eux aussi se **réinscrire** ;
- le stand est **rouvert** s'il avait été fermé la veille (« Fermer le stand »,
  [partie 11](#11-fin-de-journée--fermer-le-stand-et-exporter)) : les placements
  automatiques reprennent ;
- le numéro du jour augmente (badge « Jour N » à côté de « Accueil ») ;
- **personne n'est effacé** : tous les participants restent dans la recherche
  et dans l'export CSV.

Le matin, utilisez bien **« Nouvelle journée »** et **pas « Rouvrir le
stand »** : « Rouvrir le stand » ne vide pas la file, et les joueurs restés en
attente la veille seraient placés alors qu'ils ne sont plus là (le bandeau du
matin ne propose d'ailleurs que « Rouvrir quand même… », avec un avertissement).

**Le premier jour du salon**, ne cliquez pas : le jour 1 démarre tout seul
(sauf consigne contraire du responsable).

---

## 3. Inscrire des joueurs

Le formulaire **« 01 Inscrire »** est dans la colonne de gauche ; le curseur y
revient tout seul après chaque inscription.

1. Choisissez **« 2 joueurs ensemble »** (par défaut) ou **« 1 joueur »**.
   Raccourcis clavier : **Alt + 2** / **Alt + 1**.
2. Pour chaque joueur, remplissez **Prénom**, **Nom**, **Email** et
   **N° de billet**. Le **joueur 1** s'assoit sur la **chaise du haut**, le
   **joueur 2** sur la **chaise du bas** (indiqué à côté de « Joueur 1 » /
   « Joueur 2 »).
3. Appuyez sur **Entrée** (ou cliquez sur le bouton orange
   **« Inscrire les 2 joueurs »** / **« Inscrire le joueur »**, toujours visible
   en bas du formulaire). « Effacer » vide le formulaire.

En haut du formulaire, la pastille **d'attente estimée** (par ex.
« ~20 min · vers 15:40 », ou « 3 places libres maintenant ») est celle qu'affiche
l'écran TV : vous pouvez l'annoncer au visiteur avant de l'inscrire.

Le **cadre de résultat**, au-dessus du formulaire, vous dit quoi annoncer au
visiteur :

- **cadre noir « → Table 4 · B »** : la partie commence, envoyez-les à la
  table (le compte à rebours a démarré) ;
- **« En file d'attente · rang 3 »**, avec l'heure de passage estimée : ils
  attendent ; leur nom apparaît dans la file sur l'écran TV, puis à leur table
  quand une place se libère (stand fermé, le soir : la TV n'affiche plus la file
  et personne n'est placé, voir la
  [partie 11](#11-fin-de-journée--fermer-le-stand-et-exporter)) ;
- **« Joueur seul : en attente d'un partenaire »** : voir la
  [partie 6](#6-joueur-seul).

Le cadre **suit la situation** : si le joueur est placé un peu plus tard, il
affiche sa table. Au bout de 90 secondes, il se réduit à une ligne
(« Dernière inscription »).

Bon à savoir :

- deux joueurs inscrits **ensemble** joueront **ensemble** (l'un contre
  l'autre) ;
- les **tables entièrement libres** sont remplies en premier, puis les
  demi-tables ;
- pour le billet, les espaces, tirets et points sont ignorés ; pour l'email,
  les majuscules sont ignorées ;
- un champ oublié ou mal rempli est signalé **en rouge sous le champ**, et le
  curseur y est placé ;
- faute de frappe après coup : retrouvez le joueur avec la recherche
  ([partie 10](#10-rechercher-ou-corriger-un-joueur)) et cliquez sur
  **« Modifier »**.

---

## 4. Appeler les joueurs placés : « À appeler »

Quand une place se libère, l'application place **automatiquement** les suivants
de la file. Ces joueurs ne sont pas devant vous : il faut **les appeler**. Le
panneau **« 02 À appeler »** (en haut au centre) en tient la liste :

- chaque carte indique la **table et l'emplacement** (plaque noire « Table 4 »
  + lettre **A** ou **B**), les **noms complets**, la moitié de table (gauche
  pour A, droite pour B) et depuis quand ils sont placés ;
- **« Prévenir un animateur »** apparaît quand le joueur joue contre un
  animateur ;
- le panneau s'entoure d'orange tant qu'il reste des joueurs à appeler, et le
  titre de l'onglet du navigateur commence par « (N) À appeler » ;
- sur le plan, ces emplacements sont encadrés d'orange avec l'étiquette
  **« À appeler »**.

Pour chaque carte :

1. Appelez les joueurs (et montrez-leur la table sur l'écran TV, où ils
   figurent aussi dans « À vos tables ! »).
2. Quand ils sont installés, cliquez sur **« Installés »** : la carte
   disparaît. **« Tout marquer installés »** (en haut du panneau, dès 2 cartes)
   vide la liste d'un coup.
3. Personne ne vient ? Le bouton **« ⋯ »** de la carte propose
   **« Absent : Prénom Nom »** pendant les 15 premières minutes de la partie
   ([partie 7](#7-joueur-absent-à-lappel)) et **« Ouvrir Table 4 · B »** (le
   panneau de l'emplacement : ±5 min, Libérer). Un clic sur la plaque
   « Table 4 · B » ouvre aussi ce panneau.

Bon à savoir :

- les joueurs que vous venez d'inscrire et qui sont placés **tout de suite** ne
  sont **pas** ajoutés : vous leur annoncez la table depuis le cadre de
  résultat. Ils le sont en revanche quand un **joueur seul déjà en file**
  (absent du comptoir) a été associé à votre inscription, ou quand vous avez
  cliqué sur **« Placer quand même »** ;
- la liste est **mémorisée sur ce poste** : elle survit à un rechargement de la
  page. Sur un autre appareil (ou après avoir effacé les données du
  navigateur), elle reprend les placements des **3 dernières minutes** ;
- une carte disparaît d'elle-même quand la partie se termine, et la liste
  repart de zéro à la « Nouvelle journée ».

---

## 5. « Email ou billet déjà utilisé »

Règle du salon : **une seule participation par personne**. Dès la saisie, un
avertissement orange apparaît sous le champ, par exemple :
*« Déjà utilisé par Lucas Martin – jour 1 – partie terminée »*. L'inscription
est alors **refusée** (message rouge sous le champ).

Que faire :

- **C'est bien la même personne** (elle a déjà joué, est en train de jouer, est
  déjà dans la file, ou est partie avant la fin) : expliquez-lui gentiment
  qu'une seule participation est possible.
- **C'est une erreur de saisie** (de votre part ou d'une collègue) : vérifiez
  l'email ou le billet avec le visiteur ; si l'inscription précédente
  contenait une faute, retrouvez-la avec la recherche et corrigez-la avec
  **« Modifier »**.
- **Deux joueurs ensemble** ne peuvent pas avoir le même email ni le même
  billet : chacun doit donner les siens.
- En cas de doute, voyez avec le responsable du stand.

Ne sont **pas** bloqués (ils n'ont pas joué) et peuvent se réinscrire
normalement : les joueurs **retirés** de la file car absents, ceux déclarés
**« Absent »** à leur table, et ceux qui étaient **encore en attente** lors de
la « Nouvelle journée ».

---

## 6. Joueur seul

Inscrivez-le avec **« 1 joueur »**.

- **Un autre joueur seul attend déjà ?** Les deux sont **associés
  automatiquement** et forment une paire (à la place du premier arrivé dans la
  file).
- **Personne d'autre seul ?** Le joueur attend un partenaire. Pour ne pas
  bloquer la file, **les paires derrière lui passent devant**. Il sera associé
  au prochain joueur seul qui s'inscrira. Sur l'écran TV, sa ligne invite les
  visiteurs seuls à s'inscrire.
- **Il attend depuis trop longtemps ?** Cliquez sur
  **« Placer quand même (vs animateur) »** : ce bouton orange clair est sur sa
  ligne dans la file d'attente, et dans le cadre de résultat de l'inscription.
  Il sera placé à la **prochaine place libre** et jouera **contre un
  animateur** : **prévenez un animateur** (la carte « À appeler » le rappelle).
  Sur le plan, l'adversaire est indiqué « Animateur ».
  - Si un autre joueur seul arrive avant qu'une place se libère, les deux sont
    associés : l'animateur n'est plus nécessaire.
  - **« Annuler animateur »** (même endroit) : le joueur se remet à attendre un
    partenaire.
- Un joueur qui joue contre un animateur a droit aux goodies comme les autres
  s'il reste jusqu'au bout.

---

## 7. Joueur absent à l'appel

Pensez à vérifier régulièrement que les **premiers de la file** sont bien
présents près du stand.

### Dans la file d'attente : « Retirer »

- Un joueur de la file **ne répond pas** : cliquez sur le bouton **« ⋯ »** au
  bout de sa ligne, puis sur **« Retirer de la file »** sous son nom, et
  confirmez. (Le même menu propose **« Modifier »** pour corriger une faute.)
  - S'il faisait partie d'une **paire**, son partenaire redevient **joueur
    seul**, **à la même place** dans la file (il sera associé au prochain
    joueur seul, ou vous pouvez le « Placer quand même »).
  - Le joueur retiré **pourra se réinscrire** plus tard avec le même email et
    le même billet (il repartira en fin de file).
- « Retirer » ne concerne que les joueurs **en file d'attente**. Pour des
  joueurs **déjà placés**, voir ci-dessous.

### Déjà placé mais pas à sa table : « Absent » (15 premières minutes)

Cliquez sur l'emplacement du joueur sur le plan : dans le panneau qui s'ouvre,
chaque joueur d'une partie qui vient de commencer a un bouton **« Absent »** à
côté de son nom, avec le temps restant (« Absent · 12 min »). Il reste
disponible pendant les **15 premières minutes** de la partie, puis disparaît
tout seul (ajouter du temps avec « +5 min » ne prolonge pas ce délai). Pour un
joueur encore dans « À appeler », le menu **« ⋯ »** de la carte propose
directement **« Absent : Prénom Nom »**.

Le joueur ne s'est pas présenté : cliquez sur **« Absent »**, puis confirmez.

- Il est retiré de la partie, **sans goodies**. Il n'a pas joué : il **pourra
  se réinscrire** avec le même email et le même billet (il repartira en fin de
  file).
- **Son partenaire est là ?** La partie **continue contre un animateur**, avec
  le même compte à rebours : **prévenez un animateur**. Sur le plan,
  l'adversaire est indiqué « Animateur ». Le partenaire a droit aux goodies
  s'il va au bout.
- **Plus personne à la table** (les deux joueurs absents, ou joueur seul qui
  jouait contre un animateur) : la partie est **annulée** et l'emplacement est
  donné aux suivants de la file (sauf si le stand est fermé). Personne n'est
  compté comme « parti avant la fin ».

### Après 15 minutes

Passé ce délai, « Absent » n'est plus proposé (le panneau de l'emplacement le
rappelle). Attention : **« Libérer » fait sortir les deux joueurs de la
partie**, y compris celui qui est bien à sa table. Tous deux sont alors
considérés comme ayant participé : pas de goodies, pas de réinscription, et
cela ne s'annule pas.

- **Son partenaire est là ?** Ne cliquez pas sur « Libérer » : laissez la
  partie continuer, **un animateur joue à la place de l'absent** (prévenez-en
  un). Sur le plan, le nom de l'absent reste affiché. En fin de partie, les
  deux joueurs apparaissent dans « Goodies à remettre » : ne remettez les
  goodies qu'au joueur présent (ne cliquez pas sur « Remis » pour l'absent).
- **Plus personne à la table ?** Utilisez **« Libérer »**
  ([partie 8](#8-pendant-les-parties)) : l'emplacement est donné aux suivants
  de la file.
- En cas de doute, voyez avec le responsable.

---

## 8. Pendant les parties

Le **plan des tables** (au centre) montre chaque table avec ses deux
emplacements **A** (gauche) et **B** (droite). Chaque emplacement n'affiche que
l'essentiel :

- **libre** (fond cyan, « Libre »), **libre, stand fermé** (gris) ou **hors
  service** (hachures) ;
- en jeu : la lettre, le **compte à rebours**, les noms (« Prénom N. ») et une
  jauge ; sur un grand écran, l'heure de fin prévue ;
- **5 dernières minutes** : fond et cadre orange ; « Terminé » quand le temps
  est écoulé ;
- étiquette **« Nouveau »** pendant 3 minutes après le placement, ou
  **« À appeler »** tant que les joueurs sont dans la liste « À appeler ».

Si la fenêtre est petite, le plan **défile** à l'intérieur de son panneau
(les tables ne sont jamais écrasées).

### Le panneau d'un emplacement

**Cliquez sur un emplacement** (ou appuyez sur Entrée quand il est sélectionné
au clavier) : un panneau s'ouvre à côté, avec :

- le **compte à rebours** en grand, l'heure de début et de fin prévue ;
- les joueurs, avec leur place (**« Joueur 1 · chaise du haut »**,
  **« Joueur 2 · chaise du bas »**), leur email et leur billet, et le bouton
  **« Absent »** pendant les 15 premières minutes
  ([partie 7](#7-joueur-absent-à-lappel)) ;
- **« Joueurs installés »** si la partie est encore dans « À appeler » ;
- **« −5 min »** et **« +5 min »** ;
- en bas, séparé du reste : **« Libérer l'emplacement… »**.

Pour un emplacement **libre**, le panneau propose **« Mettre la table N hors
service »** (ou « Remettre la table N en service »). La croix, la touche
**Échap** ou un clic ailleurs referment le panneau. Si la partie se termine
pendant qu'il est ouvert, le panneau l'indique et ne propose plus d'action
(bouton « Afficher l'emplacement actuel »).

### Fin normale (rien à faire)

Quand le temps est écoulé, la partie se termine **toute seule** : les joueurs
apparaissent dans **« Goodies à remettre »** (avec une notification « Fin de
partie »), l'emplacement est libéré et les suivants de la file sont placés
automatiquement (ils arrivent dans « À appeler »).

### « +5 min » / « −5 min »

Pour ajuster le temps d'une partie (installation un peu longue, petit
incident…). Retirer 5 minutes alors qu'il en reste moins de 5 **termine la
partie tout de suite** (une confirmation le signale) : les joueurs ont alors
droit à leurs goodies.

### « Libérer » : départ anticipé

Les joueurs quittent la table avant la fin : dans le panneau de l'emplacement,
cliquez sur **« Libérer l'emplacement… »**, puis **« Libérer (pas de
goodies) »**. Dans cette confirmation, c'est **« Annuler »** qui est sélectionné
par défaut : appuyer sur Entrée n'a donc aucun effet.

- les joueurs **n'ont pas droit aux goodies** ;
- ils sont considérés comme ayant participé : ils **ne peuvent pas se
  réinscrire** ;
- l'emplacement est donné tout de suite aux suivants de la file.

Des joueurs placés ne viennent pas à leur table : pendant les 15 premières
minutes, préférez **« Absent »** ([partie 7](#7-joueur-absent-à-lappel)),
qui leur permet de se réinscrire. Au-delà, « Libérer » seulement si
**aucun des deux** n'est à la table, avec la même conséquence que ci-dessus
(ils ne pourront pas se réinscrire) ; si l'un des deux est là, laissez la
partie continuer contre un animateur ([partie 7](#7-joueur-absent-à-lappel)).
En cas de souci, voyez avec le responsable.

### Réglages (bouton « Réglages », roue dentée dans la barre du haut)

- **Durée des parties** (en minutes, 60 par défaut) : s'applique aux
  **prochaines** parties ; celles en cours gardent leur heure de fin.
- **Tables en service** : un interrupteur par table. Mettez une table **hors
  service** (table abîmée, démonstration…) : plus personne n'y est placé ; les
  parties en cours dessus continuent jusqu'à leur fin. (Raccourci : le panneau
  d'un emplacement libre propose aussi « Mettre la table N hors service ».)

---

## 9. Remettre les goodies

Le panneau **« 03 Goodies à remettre »** (colonne de droite ; sur une tablette,
onglet « Goodies ») liste les joueurs du jour qui sont **allés au bout** de leur
partie, avec la table et l'heure de fin. Le compteur **« Goodies »** de la barre
du haut passe en or quand il y en a à remettre ; un clic dessus mène à la
liste.

1. Le joueur se présente : remettez-lui ses goodies.
2. Cliquez sur **« Remis »** à côté de son nom. Il passe dans « Déjà remis »
   (repliée en bas de la liste).
3. Erreur de clic : ouvrez **« Déjà remis »** et cliquez sur **« Annuler »**.

Les joueurs partis avant la fin (« Libérer ») ou déclarés « Absent »
n'apparaissent pas dans cette liste. Exception : un absent repéré après les
15 minutes, dont le partenaire a joué contre un animateur
([partie 7](#7-joueur-absent-à-lappel)), y figure : ne lui remettez pas de
goodies.

---

## 10. Rechercher ou corriger un joueur

Champ **« Rechercher »** dans la barre du haut (une loupe sur une tablette ;
raccourci **Alt + R**) : tapez au moins 2 caractères d'un nom, prénom, email ou
numéro de billet. Pour chaque résultat, vous voyez son statut (en file, en jeu,
partie terminée, goodies remis ou non…), où il se trouve (table et temps
restant, ou rang dans la file), le jour de son inscription, et les boutons
**« Modifier »** (corriger une faute), **« Retirer »** (s'il est en file
d'attente) ou **« Goodies remis »** / **« Annuler la remise »** (s'il a
terminé sa partie). **Échap** vide la recherche, puis la ferme.

---

## 11. Fin de journée : fermer le stand et exporter

À la fermeture, **dans cet ordre** :

1. **Fermez le stand** : cliquez sur **« Fermer le stand »** (lune, dans la
   barre du haut), puis confirmez. À partir de là, **plus personne n'est
   placé** automatiquement :
   - les parties en cours **continuent jusqu'au bout**, goodies compris ;
   - les places qui se libèrent **restent vides** (« Libre, stand fermé » sur
     le plan) ;
   - la file d'attente reste affichée **à l'accueil**, mais personne n'y est
     placé ;
   - un bandeau noir **« Stand fermé »** s'affiche sous la barre, avec le
     bouton **« Rouvrir le stand »** (le bouton « Fermer le stand » disparaît
     alors de la barre) ;
   - l'écran TV annonce la **fin de la journée** (« Le stand ferme ses
     portes », inscriptions closes) : il n'affiche plus la file ni les noms
     des joueurs en attente.
2. **N'inscrivez plus personne** : l'inscription reste possible (un rappel
   s'affiche au-dessus du formulaire), mais les nouveaux inscrits attendraient
   en file sans jouer. Les joueurs encore en file n'ont pas joué : ils pourront
   **se réinscrire** un autre jour avec le même email et le même billet.
   Dites-le-leur s'ils sont encore là.
3. **Parties en cours** : laissez-les finir (goodies). Si elles ne peuvent pas
   aller au bout avant la fermeture du salon, selon la consigne du responsable,
   terminez-les (« −5 min » jusqu'à la fin → goodies) ou libérez-les
   (« Libérer » → pas de goodies). Remettez les goodies restants.
4. Avant de partir, vérifiez sur le plan que **toutes les tables sont libres**.
   Une partie laissée en cours se termine seule à la fin de son compte à
   rebours, et ses joueurs sont alors comptés comme étant allés au bout
   (goodies dus), même s'ils sont partis.
5. Exportez le CSV (ci-dessous). Vous pouvez ensuite vous déconnecter (menu
   **« ⋯ »** → **« Déconnexion »**) si le poste n'est pas surveillé.

**Le lendemain matin**, « Nouvelle journée » ([partie 2](#2-chaque-matin---nouvelle-journée-))
vide la file et **rouvre le stand** : inutile de cliquer sur « Rouvrir le
stand ».

> **Pourquoi fermer le stand ?** Sinon, chaque place libérée (« Libérer »,
> « −5 min » ou fin du temps) est **aussitôt donnée aux suivants de la file**,
> même après l'heure de fermeture, et même la nuit si des parties sont restées
> en cours. Des joueurs placés à la fermeture puis libérés seraient **bloqués
> pour tout le salon** (« parti avant la fin ») sans avoir vraiment joué.

**« Fermer le stand » n'est pas une pause** : l'écran TV annonce la fin de la
journée et n'affiche plus la file, et les visiteurs en attente s'en vont. Pour
arrêter les placements un moment en journée (incident, animation sur le
stand…), mettez plutôt les tables **hors service** (« Réglages » → Tables en
service) : la file reste affichée sur la TV, les parties en cours continuent,
et les placements reprennent dès que vous remettez les tables en service.

**Stand fermé par erreur** : cliquez sur **« Rouvrir le stand »** dans le
bandeau noir, puis confirmez. Les placements reprennent aussitôt : les joueurs
prêts de la file sont placés aux emplacements libres et arrivent dans
« À appeler ». La TV leur a annoncé la fin de la journée entre-temps : certains
ont pu partir. Un joueur placé qui ne vient pas à sa table : « Absent »
([partie 7](#7-joueur-absent-à-lappel)).

**Vider la file à la main** (« Retirer » chaque joueur, l'ancienne méthode)
n'est plus nécessaire : à la « Nouvelle journée », les joueurs encore en file
peuvent se réinscrire, exactement comme s'ils avaient été retirés. « Retirer »
reste utile pour un joueur qui renonce et s'en va.

### Exporter le CSV

1. Ouvrez le menu **« ⋯ »** (en haut à droite) et cliquez sur
   **« Exporter CSV »**. Un fichier `participants-riftbound-AAAA-MM-JJ.csv` est
   téléchargé.
2. Il contient **tous les participants de tous les jours** (statut, table,
   horaires, goodies) et s'ouvre directement dans Excel.
3. Rangez-le à l'endroit convenu avec le responsable. Il contient des **données
   personnelles** (emails) : ne le laissez pas sur un ordinateur partagé.

---

## 12. En cas de problème

### Coupure d'internet

L'application tourne sur un **serveur en ligne**, pas sur les appareils du
stand :

- **les comptes à rebours continuent côté serveur** : aucune partie n'est
  perdue, les fins de partie et les placements se font normalement ;
- l'écran TV affiche une pastille rouge **« Reconnexion… »** sous l'horloge,
  et l'accueil un bandeau rouge **« Connexion au serveur perdue »** (le reste de
  la page est grisé) ; les informations affichées peuvent être en retard ;
- pendant la coupure, les inscriptions et les boutons ne fonctionnent pas
  (message « Le serveur ne répond pas ») : **notez les visiteurs sur papier**
  et inscrivez-les dès le retour du réseau ;
- **au retour du réseau, tout se resynchronise tout seul**. Jetez un œil au
  plan et à « À appeler » : des parties ont pu se terminer et d'autres
  commencer entre-temps.

Astuce : un partage de connexion depuis un téléphone (4G/5G) permet de
continuer pendant une coupure du Wi-Fi.

### Autres situations

| Problème | Solution |
|---|---|
| La page est figée ou bizarre | Rechargez-la (**F5**, ou **Ctrl + F5**). La liste « À appeler » est conservée. |
| La page de connexion réapparaît | Ressaisissez le mot de passe (session expirée ou mot de passe changé). |
| « Mot de passe incorrect » | Vérifiez majuscules et clavier (bouton « Afficher ») ; demandez le mot de passe au responsable. |
| « Trop de tentatives » | Attendez 5 minutes (le blocage concerne tout le Wi-Fi du stand). |
| L'écran TV s'est éteint | Vérifiez la mise en veille de la TV et de l'ordinateur ([partie 1](#la-tv-écran-public)). |
| Personne n'est placé alors que des places sont libres | Bandeau « Stand fermé » ? Le stand a été fermé : **« Rouvrir le stand »** (ou, le matin, **« Nouvelle journée »**). Sinon, vérifiez que les tables ne sont pas hors service (« Réglages ») et que la file ne contient pas que des joueurs seuls en attente d'un partenaire ([partie 6](#6-joueur-seul)). |
| « Absent » n'apparaît plus | La partie a commencé il y a plus de 15 minutes. Partenaire présent : laissez la partie continuer contre un animateur ; personne à la table : « Libérer » ([partie 7](#7-joueur-absent-à-lappel)). |
| Un appel a été marqué « Installés » par erreur | Les joueurs sont toujours sur le plan : cliquez sur leur emplacement pour retrouver la table. |
| Mauvais « Retirer » | Le joueur peut se réinscrire tout de suite (il repart en fin de file). |
| Mauvais « Absent » | Ne s'annule pas : le joueur peut se réinscrire (il repart en fin de file) ; prévenez le responsable. |
| Mauvais « Libérer » | Ne s'annule pas : prévenez le responsable du stand. |
| Stand fermé par erreur | **« Rouvrir le stand »** dans le bandeau : les placements reprennent aussitôt ; vérifiez que les joueurs placés sont bien là (sinon « Absent »). |
| Besoin d'une pause en journée | Tables **hors service** (« Réglages »), pas « Fermer le stand » (la TV annoncerait la fin de la journée). |

---

## Mémo : quelle action pour quelle situation ?

| Situation | Action |
|---|---|
| Le matin, avant l'ouverture | **« Nouvelle journée »** (barre du haut ou bandeau orange ; une fois par jour, pas le jour 1) : vide la file et rouvre le stand |
| Deux amis veulent jouer ensemble | « 2 joueurs ensemble » → Entrée |
| Un visiteur vient seul | « 1 joueur » → Entrée (associé au prochain joueur seul) |
| Joueurs placés automatiquement | Les appeler (« 02 À appeler »), puis **« Installés »** |
| Le joueur seul attend trop | **« Placer quand même (vs animateur) »** (sa ligne dans la file) + prévenir un animateur |
| Email ou billet « déjà utilisé » | Refuser poliment, ou corriger une faute de saisie (« Modifier ») |
| Un joueur de la file est absent | « ⋯ » sur sa ligne → **« Retirer de la file »** |
| Un joueur placé ne vient pas à sa table (moins de 15 min) | Clic sur l'emplacement → **« Absent »** à côté de son nom (ou « ⋯ » de la carte « À appeler ») ; son partenaire joue contre un animateur |
| … plus de 15 min après le début, son partenaire est là | Laisser jouer contre un animateur (**pas** « Libérer », qui sortirait aussi le partenaire) ; pas de goodies pour l'absent |
| … plus de 15 min après le début, personne à la table | Clic sur l'emplacement → **« Libérer l'emplacement… »** (pas de goodies) |
| Des joueurs partent avant la fin | Clic sur l'emplacement → **« Libérer l'emplacement… »** (pas de goodies) |
| Retard au démarrage, incident | Clic sur l'emplacement → **« +5 min »** / **« −5 min »** |
| Fin du temps | Automatique → **« Remis »** dans « 03 Goodies à remettre » quand les goodies sont donnés |
| Table inutilisable | « Réglages » → Tables en service (ou clic sur un emplacement libre → « Mettre la table hors service ») |
| Le soir | **« Fermer le stand »**, laisser finir (ou terminer / libérer) les parties, puis « ⋯ » → **« Exporter CSV »** |
| Coupure d'internet | Noter sur papier ; tout se resynchronise au retour |

Raccourcis clavier : **Entrée** inscrire · **Alt + 1** / **Alt + 2** : 1 ou 2
joueurs · **Alt + R** : rechercher · **Alt + N** : revenir au champ « Prénom » ·
**Échap** : fermer le panneau, le menu ou la recherche.
