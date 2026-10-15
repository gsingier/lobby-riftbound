# syntax=docker/dockerfile:1

# Lobby Riftbound – image de production.
# Construite par Coolify (build pack « Dockerfile »), utilisable aussi à la main :
#   docker build -t lobby-riftbound .
#   docker run -d -p 3000:3000 -e ACCUEIL_PASSWORD='mot-de-passe-fort' \
#     -v lobby-data:/data lobby-riftbound
# Nécessite BuildKit (moteur de construction par défaut depuis Docker 23, utilisé
# par Coolify). Voir docs/DEPLOIEMENT-COOLIFY.md.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# Étape 1 : dépendances de production (node_modules)
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app

# better-sqlite3 télécharge d'habitude un binaire précompilé. S'il n'en existe
# pas pour cette plateforme (ou si le téléchargement échoue), il est compilé :
# il faut alors python3, make et g++. Ces outils restent dans cette étape.
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force \
 && node -e "require('better-sqlite3')(':memory:').close(); console.log('better-sqlite3 OK')"

# ---------------------------------------------------------------------------
# Étape 2 : image finale, minimale
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    TZ=Europe/Paris \
    DATA_DIR=/data \
    PORT=3000

# tzdata : fuseau horaire Europe/Paris (déjà présent dans l'image de base,
# installé ici au cas où). wget : seulement pour le health check propre à
# Coolify s'il est activé dans son interface (Coolify appelle curl ou wget).
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tzdata wget \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Le code appartient à root : l'application (utilisateur « node ») ne peut que le lire.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY public ./public
COPY scripts ./scripts

# Dossier des données (base SQLite). Un volume nommé vide reprend ces droits ;
# pour les autres cas (volume ou dossier de l'hôte appartenant à root), le
# point d'entrée ci-dessous corrige les droits à chaque démarrage.
RUN mkdir -p /data && chown node:node /data && chmod 750 /data

# Point d'entrée : démarre en root uniquement pour réparer les droits de /data,
# puis lance l'application sous l'utilisateur non root « node » (setpriv).
# « exec » : node devient le processus principal et reçoit directement SIGTERM
# (arrêt propre géré par server/index.js).
COPY --chmod=755 <<"EOF" /usr/local/bin/lobby-entrypoint
#!/bin/sh
set -eu

data_dir="${DATA_DIR:-/data}"
app_user=node

as_app() {
  setpriv --reuid="$app_user" --regid="$app_user" --init-groups --inh-caps=-all -- "$@"
}

fail_not_writable() {
  echo "ERREUR : le dossier des données $data_dir n'est pas accessible en écriture" >&2
  echo "par l'utilisateur de l'application ($1). La base ne peut pas être enregistrée." >&2
  echo "Vérifiez le stockage persistant monté sur $data_dir (voir docs/DEPLOIEMENT-COOLIFY.md, Dépannage)." >&2
  exit 1
}

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$data_dir"
  if [ "$data_dir" != "/" ]; then
    # Rend au compte « node » tout ce qui ne lui appartient pas (volume créé
    # par root, sauvegarde restaurée en root…). Ne touche que les fichiers concernés.
    find "$data_dir" -xdev \( ! -user "$app_user" -o ! -group "$app_user" \) \
      -exec chown "$app_user:$app_user" {} + \
      || echo "ATTENTION : impossible de corriger les droits de $data_dir." >&2
  fi
  if ! mountpoint -q "$data_dir"; then
    echo "ATTENTION : $data_dir ne semble pas être un stockage persistant (volume)." >&2
    echo "Les inscriptions seront PERDUES au prochain redéploiement : ajoutez un volume monté sur $data_dir." >&2
  fi
  as_app test -w "$data_dir" || fail_not_writable "$app_user"
  if [ -e "$data_dir/lobby.db" ]; then
    as_app test -w "$data_dir/lobby.db" || fail_not_writable "$app_user"
  fi
  export HOME=/home/node
  exec setpriv --reuid="$app_user" --regid="$app_user" --init-groups --inh-caps=-all -- "$@"
fi

# Conteneur lancé directement sans root (ex. docker run --user 1000) :
# pas de correction possible, on vérifie seulement.
mkdir -p "$data_dir" 2>/dev/null || true
[ -w "$data_dir" ] || fail_not_writable "uid $(id -u)"
exec "$@"
EOF

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/healthz', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/lobby-entrypoint"]
CMD ["node", "server/index.js"]
