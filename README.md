# Lobby Riftbound – Paris Games Week

Application de **file d'attente et de placement aux tables** pour le stand
**Riftbound** (set **Radiance**) de la Paris Games Week.

Les visiteurs s'inscrivent à l'accueil ; l'application les place
automatiquement à une table dès qu'un emplacement se libère, lance un compte à
rebours d'**1 heure** par partie et affiche le tout en temps réel sur une TV.
Rester jusqu'au bout donne droit aux **goodies**.

## Fonctionnalités

**Accueil (`/accueil`, protégé par mot de passe)**

- Inscription de **1 joueur** ou de **2 joueurs ensemble** (prénom, nom, email,
  numéro de billet), avec vérification immédiate des doublons : un email ou un
  billet ne sert qu'**une fois sur tout le salon**.
- Placement **automatique** : tables entièrement libres d'abord, puis
  demi-tables ; deux joueurs seuls sont associés automatiquement ; un joueur
  seul peut être **« placé quand même »** contre un animateur.
- Plan des 9 tables avec les comptes à rebours, **+5 / −5 min**, **« Libérer »**
  (départ anticipé, sans goodies).
- **« Absent »** sur chaque joueur placé, pendant les **15 premières minutes** de
  la partie : il est retiré sans goodies et pourra se réinscrire ; son
  partenaire continue contre un animateur (ou, s'il ne reste personne, la
  partie est annulée et l'emplacement réattribué). Au-delà : « Libérer » (qui
  sort les deux joueurs) s'il n'y a plus personne, sinon la partie continue.
- File d'attente : **« Retirer »** un joueur absent (il pourra se réinscrire).
- Liste **« Goodies à remettre »** avec bouton « Remis ».
- Recherche et correction d'un participant.
- Réglages : durée des parties (1 h par défaut), tables hors service.
- **« Fermer le stand »** le soir : plus aucun placement automatique (les
  parties en cours vont jusqu'au bout, goodies compris ; la file reste affichée
  à l'accueil mais personne n'est placé). **« Rouvrir le stand »** pour
  reprendre. Ce n'est pas une pause en journée : l'écran TV annonce alors la
  fin de la journée (pour une pause, mettre les tables hors service).
- **« Nouvelle journée »** chaque matin (vide la file, rouvre le stand, garde
  tout l'historique).
- **Export CSV** de tous les participants (compatible Excel).

**Écran TV (`/ecran`, public)**

- Plan du stand (9 tables × 2 matchs), noms des joueurs, temps restant, file
  d'attente, en temps réel.
- N'affiche que **« Prénom N. »** : jamais d'email ni de numéro de billet.
- Stand fermé (le soir) : l'écran l'annonce à la place de la file d'attente.
- Mise en page paysage ou portrait (Full HD), rotation possible
  (`/ecran?rotation=90`, `/ecran?orientation=portrait`).

**Fiabilité**

- Les timers sont calculés **côté serveur** à partir de l'heure de fin
  enregistrée : ils résistent aux rafraîchissements, aux coupures réseau du
  stand et aux redémarrages du serveur.
- Temps réel par Socket.IO : si le Wi-Fi du salon ou un proxy bloque les
  WebSockets, les pages se replient sur du **long-polling** HTTP et restent à
  jour.
- Toutes les données sont dans une petite base **SQLite** (`lobby.db`).

Les règles métier détaillées, validées avec le client, sont dans
[PLAN.md](PLAN.md).

## Captures d'écran

Les captures de l'écran TV et de l'accueil ne sont pas encore dans le dépôt.
Pour en produire : lancez l'application avec les données de démonstration (voir
plus bas), ouvrez `/ecran` en 1920 × 1080 (F11) et `/accueil`, puis faites des
captures. Emplacement conseillé : `docs/captures/` (par ex.
`docs/captures/ecran.png`, `docs/captures/accueil.png`).

Plans du stand ayant servi de référence :

| Zone des 9 tables | Stand complet | Rendu 3D |
|---|---|---|
| ![Zone des tables](docs/plan-stand-zone-tables.png) | ![Vue de dessus](docs/plan-stand-vue-dessus.webp) | ![Rendu 3D](docs/stand-3d.webp) |

## Démarrer sur un ordinateur

Prérequis : **Node.js 22** ou plus récent (`node -v` pour vérifier).

```sh
npm install
npm start
```

Puis ouvrez :

- écran TV : <http://localhost:3000/ecran>
- accueil : <http://localhost:3000/accueil> — mot de passe de développement :
  **`riftbound`** (utilisé seulement si `ACCUEIL_PASSWORD` n'est pas défini et
  hors production ; un avertissement s'affiche alors dans le terminal).

Les données sont enregistrées dans `data/lobby.db` (dossier ignoré par Git).
Pour repartir de zéro, arrêtez l'application et supprimez le dossier `data/`.

`npm run dev` relance automatiquement le serveur à chaque modification du code.

### Données de démonstration

Pour voir l'écran rempli (tables occupées avec des comptes à rebours variés,
un joueur seul, une file d'attente), utilisez une base séparée :

```sh
DATA_DIR=./data-demo node scripts/demo-seed.js
DATA_DIR=./data-demo npm start
```

Sous Windows (PowerShell) :

```powershell
$env:DATA_DIR = "./data-demo"; node scripts/demo-seed.js; npm start
```

Variables facultatives du script : `SEED_PAIRS` (paires déjà en jeu, 17 par
défaut) et `SEED_QUEUE` (paires en file, 6 par défaut). **Ne lancez jamais ce
script sur la base de production** : il y ajouterait de faux participants.

### Tests

```sh
npm test
```

Tests automatisés (`node:test`, avec une horloge simulée pour les timers),
dans le dossier `test/`.

### Avec Docker (facultatif)

```sh
ACCUEIL_PASSWORD='un-mot-de-passe' docker compose up -d --build
```

L'application est alors sur <http://localhost:3000>, avec ses données dans le
volume Docker `lobby-data`. Voir [docker-compose.yml](docker-compose.yml) et le
[Dockerfile](Dockerfile). Ce fichier règle `TRUST_PROXY=false` (port 3000 joint
directement) : si vous placez un proxy HTTPS devant, changez-la (voir
[Variables d'environnement](#variables-denvironnement)).

## Variables d'environnement

| Variable | Rôle | Par défaut |
|---|---|---|
| `ACCUEIL_PASSWORD` | Mot de passe de l'accueil. **Obligatoire en production** : sans elle, l'application refuse de démarrer quand `NODE_ENV=production`. | `riftbound` en développement uniquement |
| `SESSION_SECRET` | Clé de signature des sessions de l'accueil. Facultative. | générée au premier démarrage et conservée dans la base |
| `DATA_DIR` | Dossier de la base `lobby.db`. | `./data` (local) · `/data` (image Docker) |
| `PORT` | Port HTTP. | `3000` |
| `NODE_ENV` | `production` active les contrôles de production. | non défini (local) · `production` (image Docker) |
| `TZ` | Fuseau horaire du serveur (les heures affichées et exportées sont de toute façon à l'heure de Paris). | `Europe/Paris` dans l'image Docker |
| `TRUST_PROXY` | Proxys dont l'application croit les en-têtes `X-Forwarded-For` / `X-Forwarded-Proto` (adresse IP du visiteur, HTTPS). Voir ci-dessous. | `loopback, linklocal, uniquelocal` · `false` dans `docker-compose.yml` |

Changer `ACCUEIL_PASSWORD` ou `SESSION_SECRET` déconnecte toutes les sessions
de l'accueil. Une session dure 7 jours. Après 10 mauvais mots de passe en
5 minutes depuis une même adresse IP, la connexion est bloquée 5 minutes.

**`TRUST_PROXY`.** Par défaut, l'application ne croit les en-têtes
`X-Forwarded-*` que s'ils viennent d'une adresse locale ou privée (loopback,
lien local, réseaux privés `10.x`, `172.16–31.x`, `192.168.x`, `fc00::/7`) :
c'est le cas du proxy de Coolify (Traefik), donc **rien à régler sur
Coolify**. Changez-la :

- **`false`** si le port de l'application est joint **directement, sans proxy**
  devant (`docker run -p 3000:3000`, `docker compose`) : personne ne doit alors
  être cru, sinon un appareil du réseau local (adresse privée) pourrait fausser
  son adresse IP ou se faire passer pour une connexion HTTPS ;
- l'**adresse ou le sous-réseau du proxy** si votre proxy n'a pas une adresse
  locale ou privée (sinon, derrière lui, la connexion HTTPS n'est pas reconnue
  et tous les visiteurs partagent l'adresse du proxy).

Valeurs acceptées : `true` ou `false` (majuscules indifférentes), un **nombre**
de proxys successifs devant l'application, ou une **liste** d'adresses, de
sous-réseaux ou de mots-clés (`loopback`, `linklocal`, `uniquelocal`) séparés
par des virgules, par exemple `10.0.0.0/8, 127.0.0.1`. Vide ou absente : valeur
par défaut. `true` (tout croire) est déconseillé. Une valeur invalide empêche
le démarrage (`TRUST_PROXY invalide (…)` dans les journaux).

**HTTPS.** Quand la page est servie en HTTPS (d'après le proxy de confiance), le
cookie de session est marqué `Secure` et l'application envoie l'en-tête HSTS
(`Strict-Transport-Security: max-age=31536000`) : pendant **un an**, les
navigateurs qui ont visité le domaine refusent d'y revenir en HTTP simple.
Gardez donc ce domaine en HTTPS. En HTTP (essais, adresse `sslip.io`), ni
`Secure` ni HSTS.

## Adresses

| Adresse | Rôle |
|---|---|
| `/` | redirige vers `/ecran` |
| `/ecran` | écran TV public (options `?orientation=portrait`, `?rotation=90`) |
| `/accueil` | interface de l'hôtesse (renvoie vers `/login` si non connecté) |
| `/login` | connexion (mot de passe unique) |
| `/api/export.csv` | export CSV de tous les participants (connecté) |
| `/healthz` | sonde de santé : `{"ok":true}` |

## Structure du projet

```
├── server/
│   ├── index.js        serveur Express + Socket.IO, routes, actions de l'accueil
│   ├── lobby.js        moteur métier : inscriptions, file, placement, timers
│   ├── db.js           base SQLite (schéma)
│   ├── auth.js         mot de passe de l'accueil, cookie de session signé
│   └── csv.js          export CSV (Excel, heure de Paris)
├── public/
│   ├── ecran/          écran TV
│   ├── accueil/        interface de l'hôtesse
│   ├── login.html      page de connexion
│   ├── shared/         client temps réel commun (client.js) et thème (theme.css)
│   └── assets/         logos et fond, remplaçables (voir public/assets/README.md)
├── scripts/
│   └── demo-seed.js    données de démonstration
├── test/               tests automatisés (npm test)
├── docs/               guides et plans du stand
├── Dockerfile          image de production (utilisée par Coolify)
├── docker-compose.yml  lancement avec Docker hors Coolify
└── PLAN.md             règles métier et choix techniques
```

Aucune étape de construction côté navigateur : HTML, CSS et JavaScript sont
servis tels quels. Les polices (Cinzel, Barlow) sont auto-hébergées : l'écran
fonctionne sans dépendre de Google Fonts ni d'un CDN.

## Documentation

- [Déploiement sur Coolify (VPS Hostinger)](docs/DEPLOIEMENT-COOLIFY.md) :
  mise en ligne, nom de domaine et HTTPS, sauvegardes, mises à jour, dépannage.
- [Guide de l'accueil](docs/GUIDE-ACCUEIL.md) : pour les hôtesses et
  animateurs du stand.
- [Plan et règles métier](PLAN.md).
- [Remplacer les logos et le fond de l'écran](public/assets/README.md).

## Mentions

Riftbound, Radiance et les visuels associés sont la propriété de Riot Games et
UVS Games. Les visuels fournis dans `public/assets/` sont des visuels de
remplacement à substituer par les fichiers officiels fournis pour l'événement.
