# Déployer le lobby sur Coolify (VPS Hostinger KVM 2)

Ce guide explique, pas à pas, comment mettre l'application en ligne sur un VPS
Hostinger **KVM 2** géré par **Coolify v4**, puis comment la sauvegarder, la
mettre à jour et la dépanner. Il ne demande pas d'être développeur : il suffit
de savoir se connecter à Coolify et, pour les sauvegardes, à un terminal SSH.

À la fin, vous aurez par exemple :

- `https://lobby.votre-domaine.fr/ecran` : l'écran TV (public, sans mot de passe) ;
- `https://lobby.votre-domaine.fr/accueil` : l'interface de l'hôtesse (protégée).

> **Libellés de Coolify.** L'interface de Coolify est en anglais et ses libellés
> changent un peu d'une version à l'autre. Ils sont cités ici entre « » ; si
> l'un d'eux diffère chez vous, cherchez l'option équivalente au même endroit.

## Sommaire

1. [Avant de commencer](#1-avant-de-commencer)
2. [Relier Coolify au dépôt GitHub](#2-relier-coolify-au-dépôt-github)
3. [Créer l'application](#3-créer-lapplication)
4. [Régler l'application](#4-régler-lapplication)
5. [Premier déploiement et vérifications](#5-premier-déploiement-et-vérifications)
6. [Nom de domaine et HTTPS](#6-nom-de-domaine-et-https)
7. [Avant l'ouverture du salon](#7-avant-louverture-du-salon)
8. [Sauvegardes](#8-sauvegardes)
9. [Restaurer une sauvegarde](#9-restaurer-une-sauvegarde)
10. [Mettre à jour l'application](#10-mettre-à-jour-lapplication)
11. [Dépannage](#11-dépannage)
12. [Fiche récapitulative](#12-fiche-récapitulative)

---

## 1. Avant de commencer

Il vous faut :

- **Le VPS Hostinger KVM 2 avec Coolify v4 installé.** Hostinger propose un
  modèle de VPS avec Coolify préinstallé ; sinon, sur un VPS Ubuntu, Coolify
  s'installe avec la commande officielle (en SSH, en root) :

  ```sh
  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
  ```

  Le tableau de bord de Coolify est ensuite accessible sur `http://IP-DU-VPS:8000`
  (vous y créez le compte administrateur à la première visite).
- **Les ports 80 et 443 ouverts** vers le VPS (pare-feu de Hostinger s'il est
  activé dans hPanel) : ils servent au site et au certificat HTTPS.
- **L'accès au dépôt GitHub** `gsingier/lobby-riftbound`.
- **Un mot de passe fort pour l'accueil** : au moins 16 caractères, par exemple
  4 ou 5 mots au hasard (`lanterne-cobalt-mardi-pivoine`). Il sera partagé avec
  les hôtesses : n'utilisez pas celui de Coolify.
- *(Recommandé)* **un nom de domaine** dont vous gérez la zone DNS, pour avoir
  une adresse en HTTPS (voir [étape 6](#6-nom-de-domaine-et-https)).

Ressources : l'application est légère (quelques dizaines de Mo de mémoire, une
petite base SQLite). Un KVM 2 (2 vCPU, 8 Go de RAM) est très largement suffisant.

### Comment l'application est construite

Le dépôt contient un `Dockerfile` : Coolify construit l'image lui-même à chaque
déploiement. Ce qu'il faut savoir :

| Élément | Valeur |
|---|---|
| Port de l'application | `3000` |
| Dossier des données (base `lobby.db`) | `/data` (doit être un **stockage persistant**) |
| Sonde de santé | `GET /healthz` → `{"ok":true}` |
| Variable obligatoire | `ACCUEIL_PASSWORD` |
| Fuseau horaire | `Europe/Paris` (déjà réglé dans l'image) |
| Utilisateur | l'application tourne sous un compte non root (`node`) |
| Proxy de confiance (`TRUST_PROXY`) | par défaut, adresses locales et privées : celles du proxy de Coolify, rien à régler (voir [§ 6](#https-hsts-et-proxy-de-confiance-trust_proxy)) |

---

## 2. Relier Coolify au dépôt GitHub

Choisissez **une** des deux méthodes.

### Méthode A – dépôt privé : application GitHub (recommandée)

1. Dans Coolify, menu **« Sources »** → **« + Add »** → **GitHub App**.
2. Donnez un nom (par ex. `github-gsingier`) et suivez l'assistant : Coolify
   vous redirige vers GitHub pour **créer** l'application GitHub puis
   l'**installer** sur votre compte.
3. Lors de l'installation sur GitHub, choisissez *Only select repositories* et
   cochez `lobby-riftbound` (ou tous les dépôts si vous préférez).
4. De retour dans Coolify, la source apparaît comme connectée.

Avantages : accès au dépôt privé et **déploiement automatique à chaque push**
sans autre réglage.

### Méthode B – dépôt public

Si le dépôt `gsingier/lobby-riftbound` est public, rien à préparer : vous
collerez simplement son adresse `https://github.com/gsingier/lobby-riftbound` à
l'étape suivante. Le déploiement automatique demandera un webhook (étape 4.5).

---

## 3. Créer l'application

1. Menu **« Projects »** → créez un projet (par ex. `Paris Games Week`) ou
   ouvrez-en un, puis l'environnement **`production`**.
2. Cliquez sur **« + New »** (ajouter une ressource), puis selon la méthode :
   - méthode A : **« Private Repository (with GitHub App) »**, choisissez la
     source GitHub créée à l'étape 2, puis le dépôt `lobby-riftbound` ;
   - méthode B : **« Public Repository »**, collez
     `https://github.com/gsingier/lobby-riftbound`.
3. Choisissez le serveur (en général **`localhost`**, c'est-à-dire le VPS où
   tourne Coolify).
4. **Branche** : celle qui contient la version à mettre en ligne (en général
   `main`).
5. **Build Pack** : remplacez *Nixpacks* (proposé par défaut) par
   **`Dockerfile`**.
6. **Ports Exposes** : `3000`.
7. Validez (**« Continue »**). Vous arrivez sur la page de configuration de
   l'application. **Ne déployez pas encore** : réglez d'abord l'étape 4.

---

## 4. Régler l'application

### 4.1 Onglet « General »

| Champ | Valeur |
|---|---|
| Name | `lobby-riftbound` (libre) |
| Build Pack | `Dockerfile` |
| Base Directory | `/` |
| Dockerfile Location | `/Dockerfile` |
| Ports Exposes | `3000` |
| Ports Mappings | **laisser vide** (le proxy de Coolify s'occupe de l'accès web ; un port publié permettrait de joindre l'application sans passer par le proxy ni par HTTPS) |
| Domains | voir [étape 6](#6-nom-de-domaine-et-https) ; une adresse provisoire suffit pour commencer |

Cliquez sur **« Save »**.

### 4.2 Variables d'environnement (« Environment Variables »)

Ajoutez :

| Nom | Valeur | Obligatoire |
|---|---|---|
| `ACCUEIL_PASSWORD` | le mot de passe fort de l'accueil | **oui** : sans elle, l'application refuse de démarrer |
| `SESSION_SECRET` | une longue chaîne aléatoire (ex. résultat de `openssl rand -hex 32`) | non : sinon un secret est généré et gardé dans la base |

- Ces variables ne servent qu'**au démarrage** de l'application. Si Coolify
  propose une case du type « Build Variable » / « Available at Buildtime »,
  laissez-la **décochée** (inutile que le mot de passe passe dans la
  construction de l'image).
- Ne définissez **pas** `PORT`, `DATA_DIR`, `NODE_ENV` ni `TZ` : l'image les
  règle déjà (`3000`, `/data`, `production`, `Europe/Paris`).
- Ne définissez pas non plus `TRUST_PROXY` : sa valeur par défaut convient au
  proxy de Coolify (voir [§ 6](#https-hsts-et-proxy-de-confiance-trust_proxy)).
- Changer le mot de passe plus tard : modifiez la variable puis
  **« Restart »** (ou **« Redeploy »**). Toutes les sessions de l'accueil sont
  alors déconnectées ; on se reconnecte avec le nouveau mot de passe.

### 4.3 Stockage persistant (« Persistent Storage ») – INDISPENSABLE

Sans cette étape, **toutes les inscriptions sont perdues à chaque
redéploiement**.

1. Onglet **« Persistent Storage »** → **« + Add »** → **« Volume Mount »**.
2. **Name** : `lobby-data` (Coolify peut y ajouter l'identifiant de l'application).
3. **Destination Path** : **`/data`**.
4. Enregistrez.

À propos des droits : un volume créé par Coolify appartient souvent à `root`,
alors que l'application tourne sous un compte non root. **C'est géré
automatiquement** : au démarrage, le conteneur rend le dossier `/data` à
l'utilisateur de l'application, puis lance celle-ci sans les droits root. Rien
à faire de votre côté, y compris si vous choisissez un « Directory Mount »
(dossier du VPS) à la place d'un volume.

Si vous oubliez le volume, les journaux (« Logs ») affichent au démarrage :
`ATTENTION : /data ne semble pas être un stockage persistant (volume).`

### 4.4 Sonde de santé (« Healthcheck »)

Le `Dockerfile` contient déjà une sonde de santé : toutes les 15 secondes, il
interroge `http://127.0.0.1:3000/healthz`. Coolify la détecte et s'en sert pour
savoir si la nouvelle version fonctionne avant de lui envoyer le trafic.

- **Le plus simple : ne rien changer** dans l'onglet « Healthcheck ».
- Si vous préférez activer celle de Coolify, renseignez : méthode `GET`,
  schéma `http`, hôte `localhost`, port `3000`, chemin **`/healthz`**, code de
  retour `200`. (L'image contient `wget`, que Coolify utilise pour ce test.)

### 4.5 Déploiement automatique à chaque push

- **Méthode A (GitHub App)** : activé par défaut (option **« Auto Deploy »**
  dans l'onglet « Advanced »). Chaque `git push` sur la branche choisie lance un
  nouveau déploiement.
- **Méthode B (dépôt public)** : ouvrez l'onglet **« Webhooks »** de
  l'application ; Coolify y indique une adresse de webhook pour GitHub et un
  champ « secret ». Saisissez un secret dans Coolify, puis sur GitHub :
  dépôt → *Settings* → *Webhooks* → *Add webhook*, collez l'adresse, *Content
  type* `application/json`, le même secret, événement *Just the push event*.

> **Pendant le salon**, chaque push redémarre l'application (coupure de
> quelques secondes, voir [étape 10](#10-mettre-à-jour-lapplication)). Évitez de
> pousser sur la branche déployée aux heures d'affluence, ou désactivez
> temporairement « Auto Deploy ».

---

## 5. Premier déploiement et vérifications

1. Cliquez sur **« Deploy »**. Suivez la construction dans **« Deployments »**
   (ou « Show Debug Logs »). La première construction prend quelques minutes
   (installation des outils et des dépendances) ; les suivantes sont plus
   rapides grâce au cache.
   - Dans le journal de construction, la ligne `better-sqlite3 OK` confirme que
     la base de données est prête.
2. Onglet **« Logs »** de l'application : vous devez voir
   `Lobby Riftbound prêt sur http://localhost:3000 …`
   (et **pas** le message `ATTENTION : /data …`).
3. Dans un navigateur, avec l'adresse de l'application (champ « Domains ») :
   - `…/healthz` affiche `{"ok":true}` ;
   - `…/ecran` affiche le plan des 9 tables, avec « En direct » en haut à droite ;
   - `…/accueil` renvoie vers la page de connexion ; le mot de passe
     `ACCUEIL_PASSWORD` ouvre l'interface, avec « Connecté » en haut.
4. Faites une inscription d'essai, vérifiez qu'elle apparaît sur `/ecran`, puis
   **redéployez** (« Redeploy ») : l'inscription doit toujours être là. C'est la
   preuve que le stockage persistant fonctionne.
   - Pour tous les essais, utilisez des **emails et billets fictifs** (par
     exemple `essai1@exemple.fr` et `ESSAI-1`), jamais un vrai email de
     l'équipe ni un vrai billet du salon (voir [§ 7](#7-avant-louverture-du-salon)).

---

## 6. Nom de domaine et HTTPS

### En attendant un domaine : l'adresse provisoire de Coolify

Coolify remplit souvent tout seul le champ **« Domains »** avec une adresse du
type `http://xxxxxxxx.IP-DU-VPS.sslip.io`. Sinon, vous pouvez y saisir
vous-même `http://lobby.IP-DU-VPS.sslip.io` (exemple : `http://lobby.203.0.113.10.sslip.io`) :
le service gratuit *sslip.io* fait pointer ce nom vers l'adresse IP indiquée.

Cette adresse est en **HTTP non chiffré** : parfaite pour les essais, mais le
mot de passe de l'accueil y circule en clair. **Pour le salon, utilisez un vrai
domaine en HTTPS.**

### Avec votre domaine (HTTPS automatique)

1. **DNS** : chez le gestionnaire du domaine (pour un domaine Hostinger : hPanel
   → Domaines → zone DNS), créez un enregistrement **A** :
   - nom : `lobby` (pour `lobby.votre-domaine.fr`) ;
   - valeur : l'**adresse IP du VPS** ;
   - TTL : la valeur par défaut.
2. Attendez que le nom réponde (souvent quelques minutes ; vérifiable avec
   `ping lobby.votre-domaine.fr`, qui doit afficher l'IP du VPS).
3. Dans Coolify, champ **« Domains »** : `https://lobby.votre-domaine.fr`
   (avec `https://`, **sans** numéro de port). « Save », puis **« Redeploy »**
   pour appliquer.
4. Le proxy de Coolify (Traefik, ou Caddy selon votre réglage) obtient
   **automatiquement** un certificat Let's Encrypt et redirige HTTP vers HTTPS.
   Le premier accès peut prendre une minute le temps d'obtenir le certificat.

### Temps réel (WebSocket / Socket.IO)

**Rien à configurer.** L'écran et l'accueil reçoivent les mises à jour en temps
réel via Socket.IO, que le proxy de Coolify transmet sans réglage particulier.
La connexion commence en **long-polling** (requêtes HTTP ordinaires) puis passe
au **WebSocket** dès qu'il est disponible. Si le WebSocket est bloqué (Wi-Fi du
salon, pare-feu, proxy ou service placé devant le domaine), elle **reste en
long-polling** : l'affichage continue d'être mis à jour, avec un peu plus de
trafic. Deux règles :

- ouvrez toujours l'application **par l'adresse du champ « Domains »** (pas par
  `IP:3000`) : par sécurité, le serveur refuse les connexions temps réel venant
  d'une autre adresse que celle de la page ;
- gardez **une seule instance** de l'application (pas de « réplicas ») : l'état
  est dans une base SQLite locale (et le long-polling suppose que toutes les
  requêtes arrivent au même serveur).

### HTTPS, HSTS et proxy de confiance (`TRUST_PROXY`)

L'application apprend du proxy de Coolify, par les en-têtes `X-Forwarded-For`
et `X-Forwarded-Proto`, l'**adresse IP du visiteur** (pour le blocage après
trop de mauvais mots de passe) et si la page est en **HTTPS**. Elle ne croit
ces en-têtes que s'ils viennent d'un **proxy de confiance** : par défaut, une
adresse locale ou privée (`loopback, linklocal, uniquelocal` : `127.x`,
`169.254.x`, `10.x`, `172.16–31.x`, `192.168.x` et leurs équivalents IPv6),
d'où le proxy de Coolify joint le conteneur. Un visiteur connecté directement
depuis Internet n'est pas cru. **Sur Coolify, laissez `TRUST_PROXY` non
défini.**

En HTTPS, l'application :

- marque le cookie de session de l'accueil **« Secure »** ;
- envoie l'en-tête **HSTS** (`Strict-Transport-Security: max-age=31536000`) :
  pendant **un an**, un navigateur qui a ouvert le domaine en HTTPS refuse d'y
  revenir en HTTP simple, même si l'on tape `http://`. Gardez donc ce domaine
  en HTTPS pendant tout le salon (seul ce nom exact est concerné, pas les autres
  sous-domaines). L'adresse provisoire en HTTP (`sslip.io`) ne reçoit pas cet
  en-tête.

Quand changer `TRUST_PROXY` (variable d'environnement, puis « Restart ») :

| Situation | Valeur |
|---|---|
| Coolify, accès par « Domains » (cas normal) | **ne pas définir** |
| Hors Coolify, port de l'application joint **directement, sans proxy** (`docker run -p 3000:3000`, `docker compose`) | `false` : personne n'est cru |
| Proxy dont l'adresse n'est **ni locale ni privée** | son adresse ou son sous-réseau, par ex. `203.0.113.7` ou `203.0.113.0/24` |

Valeurs acceptées : `true` ou `false` (majuscules indifférentes), un **nombre**
de proxys successifs devant l'application, ou une **liste** d'adresses, de
sous-réseaux ou de mots-clés (`loopback`, `linklocal`, `uniquelocal`) séparés
par des virgules (ex. `10.0.0.0/8, 127.0.0.1`). Vide ou absente : valeur par
défaut. `true` (tout croire) est déconseillé : n'importe qui pourrait alors
choisir l'adresse IP comptée pour le blocage. Une valeur invalide empêche le
démarrage (voir [§ 11](#11-dépannage)).

---

## 7. Avant l'ouverture du salon

### Repartir d'une base vide

Les essais (inscriptions de test) restent dans la base et dans l'export CSV.
Surtout, la règle « un email ou un billet déjà utilisé est refusé, quel que
soit le jour » s'applique **aussi aux essais** : tout email ou billet d'un
joueur d'essai qui a terminé sa partie ou l'a quittée (« Libérer ») reste
**refusé pendant tout le salon**. Seuls les joueurs d'essai retirés de la file
ou déclarés « Absent », encore en file lors d'une « Nouvelle journée », ou dont
la partie a été interrompue par celle-ci, ne bloquent rien.

Pour démarrer le salon proprement **avec le jour 1** :

1. Coolify → l'application → **« Stop »**.
2. En SSH sur le VPS, trouvez le dossier du volume (voir [§ 9](#9-restaurer-une-sauvegarde),
   étapes 2 et 3) et videz-le :

   ```sh
   cd "$(docker volume inspect NOM-DU-VOLUME --format '{{ .Mountpoint }}')"
   mkdir -p /root/essais-lobby && mv lobby.db* /root/essais-lobby/   # garde une copie, au cas où
   ```

3. Coolify → **« Start »** (ou « Deploy »). Une base neuve est créée
   (jour 1, durée 1 h, toutes les tables en service).

Sinon, sans SSH : les hôtesses font « Nouvelle journée » le premier matin.
Mais alors :

- le salon commence au « jour 2 » ;
- les essais restent dans la recherche et dans l'export CSV ;
- **les emails et billets utilisés pendant les essais resteront refusés
  pendant tout le salon**. N'utilisez cette option que si tous les essais ont
  été faits avec des emails et billets fictifs ; sinon, préférez la remise à
  zéro ci-dessus. En cas d'oubli, l'accueil peut retrouver l'inscription
  d'essai (recherche) et remplacer son email et son billet par des valeurs
  fictives avec « Modifier » : les vrais sont alors libérés.

### Liste de contrôle de la veille

- [ ] `https://…/healthz` répond `{"ok":true}`.
- [ ] Le stockage persistant est bien monté sur `/data` (test du redéploiement
      de l'étape 5).
- [ ] La TV affiche `/ecran` en plein écran, « En direct », veille désactivée.
- [ ] Les hôtesses ont l'adresse `/accueil`, le mot de passe et le
      [guide de l'accueil](GUIDE-ACCUEIL.md), notamment la procédure du soir
      (« Fermer le stand », partie 10) et « Nouvelle journée » le matin.
- [ ] Une première sauvegarde a été testée (§ 8).
- [ ] « Auto Deploy » désactivé ou consigne de ne pas pousser pendant les
      heures d'ouverture.

---

## 8. Sauvegardes

Toutes les données sont dans **un seul fichier** : `/data/lobby.db` (base
SQLite). Deux niveaux de sauvegarde, complémentaires.

### 8.1 Simple : l'export CSV de chaque soir

Dans l'accueil, bouton **« Exporter CSV »** (ou l'adresse `/api/export.csv`,
une fois connecté), après avoir fermé le stand (« Fermer le stand ») et laissé
finir ou libéré les parties. Le fichier contient **tous les participants de tous les
jours** (identité, statut, table, horaires, goodies) et s'ouvre dans Excel.
Conservez-le sur un support sûr : il contient des **données personnelles**
(emails), à ne pas laisser traîner sur un ordinateur partagé.

L'export CSV sert d'archive et de liste de contacts ; il ne permet **pas** de
recharger l'application. Pour cela, il faut la sauvegarde de la base (8.2).

### 8.2 Complète : copie de la base (SSH)

Ne copiez pas `lobby.db` « à la main » pendant que l'application tourne : la
copie pourrait être incohérente. Utilisez la fonction de sauvegarde de SQLite,
sans arrêter l'application :

1. Connectez-vous au VPS : `ssh root@IP-DU-VPS` (ou le terminal du VPS dans
   hPanel).
2. Trouvez le conteneur de l'application :

   ```sh
   docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
   ```

   Son nom commence en général par l'identifiant de l'application dans Coolify
   (la suite de lettres et chiffres visible dans l'adresse de la page de
   l'application). Notez-le :

   ```sh
   C=nom-du-conteneur
   ```

3. Créez la sauvegarde dans le volume, puis copiez-la sur le VPS :

   ```sh
   docker exec -u node "$C" node -e "require('better-sqlite3')('/data/lobby.db', { fileMustExist: true }).backup('/data/sauvegarde.db').then(() => console.log('Sauvegarde terminée'))"
   docker cp "$C:/data/sauvegarde.db" "/root/lobby-$(date +%Y-%m-%d-%H%M).db"
   ```

4. Rapatriez-la sur votre ordinateur (commande à lancer **sur votre
   ordinateur**) :

   ```sh
   scp root@IP-DU-VPS:/root/lobby-*.db .
   ```

> Variante : si l'outil `sqlite3` est installé sur le VPS
> (`apt install sqlite3`), `sqlite3 CHEMIN-DU-VOLUME/lobby.db ".backup '/root/lobby.db'"`
> fait la même chose.

### 8.3 Automatique : une sauvegarde chaque nuit (facultatif)

Sur le VPS (en root), créez le script `/root/sauvegarde-lobby.sh` :

```sh
cat > /root/sauvegarde-lobby.sh <<'EOF'
#!/bin/sh
# Sauvegarde de la base du lobby Riftbound (garde 30 jours).
set -eu
APP_ID="IDENTIFIANT-COOLIFY"   # ← à remplacer (voir § 8.2, étape 2)
DEST=/root/sauvegardes-lobby

C=$(docker ps --filter "name=$APP_ID" --format '{{.Names}}' | head -n 1)
if [ -z "$C" ]; then echo "Conteneur introuvable pour $APP_ID" >&2; exit 1; fi
mkdir -p "$DEST"
docker exec -u node "$C" node -e "require('better-sqlite3')('/data/lobby.db', { fileMustExist: true }).backup('/data/sauvegarde.db').then(() => console.log('Sauvegarde terminée'))"
docker cp "$C:/data/sauvegarde.db" "$DEST/lobby-$(date +%Y-%m-%d-%H%M).db"
find "$DEST" -name 'lobby-*.db' -mtime +30 -delete
EOF
chmod +x /root/sauvegarde-lobby.sh
/root/sauvegarde-lobby.sh        # premier essai : doit afficher « Sauvegarde terminée »
```

Puis planifiez-le chaque soir à 23 h 30 : `crontab -e` et ajoutez la ligne

```
30 23 * * * /root/sauvegarde-lobby.sh >> /root/sauvegarde-lobby.log 2>&1
```

Les sauvegardes restent sur le VPS : rapatriez-les régulièrement (`scp`) pour
en avoir une copie ailleurs. Si votre offre Hostinger inclut des sauvegardes
ou instantanés (*snapshots*) du VPS, ils constituent un filet de sécurité
supplémentaire. (Les sauvegardes planifiées intégrées à Coolify concernent ses
bases de données gérées, pas le volume d'une application comme celle-ci.)

---

## 9. Restaurer une sauvegarde

Attention : tout ce qui a été enregistré **après** la sauvegarde sera perdu.
Faites d'abord un export CSV si l'application fonctionne encore.

1. Coolify → l'application → **« Stop »**.
2. En SSH sur le VPS, trouvez le volume :

   ```sh
   docker volume ls
   ```

   Repérez celui qui contient `lobby-data` (ou l'identifiant de l'application).
3. Allez dans son dossier :

   ```sh
   cd "$(docker volume inspect NOM-DU-VOLUME --format '{{ .Mountpoint }}')"
   ls -l          # lobby.db (et peut-être lobby.db-wal, lobby.db-shm)
   ```

4. Mettez l'ancienne base de côté et installez la sauvegarde :

   ```sh
   mkdir -p /root/avant-restauration && mv lobby.db* /root/avant-restauration/
   cp /root/lobby-2026-10-30-2330.db lobby.db     # ← votre fichier de sauvegarde
   ```

   (Les fichiers `lobby.db-wal` et `lobby.db-shm` ne doivent **pas** rester à
   côté d'une base restaurée : c'est pour cela qu'ils sont déplacés aussi.)
5. Coolify → **« Start »**. Les droits du fichier sont corrigés
   automatiquement au démarrage. Vérifiez l'accueil et l'écran.

---

## 10. Mettre à jour l'application

- **Automatique** : un `git push` sur la branche déployée lance la mise à jour
  (si « Auto Deploy » est actif).
- **Manuel** : bouton **« Redeploy »** (ou « Deploy ») dans Coolify.

Ce qui se passe : Coolify construit la nouvelle image, démarre le nouveau
conteneur, attend que la sonde `/healthz` réponde, puis arrête l'ancien
proprement. Pendant quelques secondes, l'écran et l'accueil affichent
« Reconnexion… » puis se reconnectent **tout seuls**.

Ce qui est conservé : toutes les données (volume `/data`) et **les comptes à
rebours** — l'heure de fin de chaque partie est enregistrée dans la base, les
timers reprennent exactement où ils en étaient.

Conseils :

- faites une sauvegarde (§ 8.2) avant une mise à jour importante ;
- évitez les mises à jour aux heures d'affluence ;
- en cas de problème, l'onglet **« Rollback »** de Coolify permet de revenir à
  une image précédente (tant qu'elle est encore présente sur le serveur), ou
  annulez la modification dans Git et redéployez.

---

## 11. Dépannage

Premier réflexe : onglet **« Logs »** de l'application dans Coolify (les
messages de l'application sont en français), puis **« Deployments »** pour les
erreurs de construction.

### « 502 Bad Gateway », « no available server » ou page introuvable

| Cause probable | Ce que disent les logs | Solution |
|---|---|---|
| Mot de passe non défini | `ACCUEIL_PASSWORD doit être défini en production.` | Ajouter la variable (§ 4.2), puis « Redeploy ». |
| Mauvais port | rien d'anormal, l'application dit être prête | « Ports Exposes » doit valoir `3000` ; « Ports Mappings » vide. |
| Application encore en démarrage | — | Attendre ~30 s après un déploiement (le temps de la sonde de santé). |
| Construction échouée | voir « Deployments » | Voir « La construction échoue » ci-dessous. |
| Domaine pas encore pris en compte | — | Après un changement de « Domains » : « Save » puis « Redeploy ». Vérifier le DNS (`ping`). |
| Base inaccessible | `ERREUR : le dossier des données /data …` | Voir « Base non inscriptible » ci-dessous. |
| `TRUST_PROXY` mal écrite | `TRUST_PROXY invalide (…)` | Corriger la valeur ([§ 6](#https-hsts-et-proxy-de-confiance-trust_proxy)) ou supprimer la variable, puis « Restart ». |

### La construction (build) échoue

- `Unable to locate package …` ou `Could not resolve 'deb.debian.org'` : le
  VPS n'a pas pu joindre les dépôts Debian (réseau ou DNS momentanément
  indisponible). Relancez le déploiement quelques minutes plus tard.
- Erreur autour de `better-sqlite3` / `node-gyp` : le binaire précompilé n'a
  pas pu être téléchargé et la compilation a échoué. Relancez ; si cela
  persiste, transmettez le journal de construction au développeur.
- `no space left on device` : disque plein (anciennes images). Coolify propose
  un nettoyage des images inutilisées dans les réglages du serveur ; en SSH,
  `docker image prune -a` libère aussi de la place.

### Base non inscriptible

Symptômes : l'application ne démarre pas et les logs affichent
`ERREUR : le dossier des données /data n'est pas accessible en écriture …`, ou
des erreurs `SqliteError` (`readonly database`, `unable to open database file`).

Normalement, le conteneur corrige seul les droits de `/data` à chaque
démarrage. Si l'erreur apparaît quand même :

- vérifiez qu'aucune option n'impose un utilisateur au conteneur (par ex. un
  `--user` dans les options Docker personnalisées de Coolify) : le conteneur
  doit démarrer normalement pour pouvoir corriger les droits ;
- vérifiez que le stockage est bien monté sur **`/data`** (§ 4.3) ;
- en dernier recours, en SSH : `chown -R 1000:1000 DOSSIER-DU-VOLUME` (le
  compte de l'application a l'identifiant 1000), puis « Restart ».

### Message « ATTENTION : /data ne semble pas être un stockage persistant »

Le stockage persistant n'est pas configuré : les données disparaîtront au
prochain déploiement. **Avant toute chose, faites un export CSV**, puis ajoutez
le volume (§ 4.3) et redéployez. (Les inscriptions faites avant l'ajout du
volume ne seront pas reprises.)

### L'écran ou l'accueil restent sur « Reconnexion… » (WebSocket)

- Ouvrez la page **par l'adresse du champ « Domains »**, pas par l'IP ou un
  autre nom : les connexions temps réel venant d'une autre adresse sont
  refusées.
- Vérifiez que l'application tourne (`/healthz`).
- Sur le stand, un Wi-Fi d'événement peut être capricieux : essayez un partage
  de connexion 4G/5G pour vérifier. Les pages se reconnectent seules quand le
  réseau revient.
- Un WebSocket bloqué (Wi-Fi du salon, Cloudflare ou autre service placé devant
  le domaine) n'explique en principe pas « Reconnexion… » : la connexion se
  replie alors sur le long-polling ([§ 6](#temps-réel-websocket--socketio)).
  Cherchez plutôt du côté de l'adresse utilisée, de l'application ou du réseau.
  Autoriser les WebSockets reste préférable (moins de trafic).

### Le navigateur passe toujours en `https://`

Normal une fois le domaine ouvert en HTTPS : l'en-tête HSTS demande au
navigateur de remplacer `http://` par `https://` sur ce domaine pendant un an
([§ 6](#https-hsts-et-proxy-de-confiance-trust_proxy)). Si le domaine n'est
plus servi en HTTPS (certificat retiré ou pas encore obtenu), ces navigateurs
affichent une erreur de sécurité qu'on ne peut pas contourner : remettez le
domaine en `https://` dans le champ « Domains » de Coolify, puis « Redeploy ».

### Problème d'heure

- Les **comptes à rebours** sont calculés à partir de l'heure du **serveur** :
  ils sont identiques sur tous les écrans, même si l'horloge de la TV ou de la
  tablette est fausse.
- Les **heures affichées** (horloge de l'écran, « fin prévue à … », export CSV)
  sont toujours en **heure de Paris**, quel que soit le réglage de l'appareil.
- Si toutes les heures sont décalées : vérifiez l'horloge du VPS avec
  `timedatectl` (ligne « System clock synchronized: yes » attendue) et que vous
  n'avez pas redéfini la variable `TZ` dans Coolify.
- Les horodatages des journaux de Coolify peuvent être en UTC : c'est normal.

### « Trop de tentatives, réessayez dans quelques minutes »

Après 10 mauvais mots de passe en 5 minutes depuis une même adresse IP, la
connexion est bloquée 5 minutes. Tous les appareils du stand connectés au même
Wi-Fi partagent souvent la même adresse IP publique, donc le même compteur.
Patientez 5 minutes.

Un second plafond, de 50 essais en 5 minutes (bons mots de passe compris),
s'applique à l'adresse qui se connecte directement au serveur : derrière le
proxy de Coolify, c'est celle du proxy, donc tous les visiteurs ensemble.

Si le proxy n'est pas reconnu comme proxy de confiance (proxy sur une adresse
publique), tous les visiteurs ont la même adresse aux yeux de l'application et
10 mauvais essais suffisent à bloquer tout le monde : voyez `TRUST_PROXY`
([§ 6](#https-hsts-et-proxy-de-confiance-trust_proxy)).

### L'accueil demande à nouveau le mot de passe

Normal après 7 jours, après un changement de `ACCUEIL_PASSWORD` ou de
`SESSION_SECRET`, ou si les cookies du navigateur ont été effacés.

---

## 12. Fiche récapitulative

| Réglage Coolify | Valeur |
|---|---|
| Type de ressource | Private Repository (GitHub App) ou Public Repository |
| Dépôt | `gsingier/lobby-riftbound` |
| Build Pack | `Dockerfile` |
| Ports Exposes | `3000` |
| Variable obligatoire | `ACCUEIL_PASSWORD` = mot de passe fort |
| Variable facultative | `SESSION_SECRET` |
| À ne pas définir | `PORT`, `DATA_DIR`, `NODE_ENV`, `TZ`, `TRUST_PROXY` (valeurs par défaut adaptées) |
| Persistent Storage | Volume Mount → Destination Path `/data` |
| Healthcheck | intégré au Dockerfile (`/healthz`) ; sinon `GET http://localhost:3000/healthz` |
| Domains | `https://lobby.votre-domaine.fr` |
| Instances | **une seule** |

Adresses utiles : `/ecran` (TV), `/accueil` (hôtesses), `/login`,
`/api/export.csv` (export, connecté), `/healthz` (sonde).

Voir aussi : [README](../README.md) · [Guide de l'accueil](GUIDE-ACCUEIL.md) ·
[Plan et règles métier](../PLAN.md).
