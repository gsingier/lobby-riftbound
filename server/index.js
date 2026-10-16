'use strict';

const crypto = require('crypto');
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const { openDb } = require('./db');
const { Lobby, LobbyError } = require('./lobby');
const { createAuth } = require('./auth');
const { buildCsv } = require('./csv');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
// Polices auto-hébergées : /fonts/<nom>/… (paquets @fontsource et @fontsource-variable).
const FONT_PACKAGES = [
  '@fontsource/cinzel',
  '@fontsource/barlow',
  '@fontsource/barlow-condensed',
  '@fontsource-variable/inter',
  '@fontsource-variable/outfit',
  '@fontsource-variable/sora',
  '@fontsource-variable/manrope',
  '@fontsource-variable/plus-jakarta-sans',
];
const TICK_MS = 1000;
// Proxys dont on croit X-Forwarded-For / X-Forwarded-Proto (IP du client, HTTPS) : par défaut les
// adresses locales et privées, d'où le Traefik de Coolify joint le conteneur. Un client Internet
// connecté directement n'est pas cru. TRUST_PROXY=false si le port est exposé sans proxy devant.
const DEFAULT_TRUST_PROXY = 'loopback, linklocal, uniquelocal';
const HSTS_MAX_AGE_S = 365 * 24 * 60 * 60;

// Actions reçues via Socket.IO : `action` { type, payload } → ack.
// `mutates: false` = lecture seule, pas de diffusion d'un nouvel état.
// `roles` = rôles autorisés (par défaut l'accueil seul) ; la boutique ne peut que chercher et remettre.
const ACTIONS = {
  boutiqueSearch: { run: (l, p) => l.boutiqueSearch(p.query), mutates: false, roles: ['admin', 'boutique'] },
  register: { run: (l, p) => l.register(p.players) },
  check: { run: (l, p) => l.check(p), mutates: false },
  search: { run: (l, p) => l.search(p.query), mutates: false },
  removeParticipant: { run: (l, p) => l.removeParticipant(p.participantId) },
  noShow: { run: (l, p) => l.noShow(p.participantId) },
  editParticipant: { run: (l, p) => l.editParticipant(p.participantId, p.fields) },
  placeAnyway: { run: (l, p) => l.placeAnyway(p.entryId) },
  cancelPlaceAnyway: { run: (l, p) => l.cancelPlaceAnyway(p.entryId) },
  releaseMatch: { run: (l, p) => l.releaseMatch(p.matchId, { withGoodies: p.withGoodies === true }) },
  adjustMatch: { run: (l, p) => l.adjustMatch(p.matchId, p.deltaMs) },
  giveGoodies: { run: (l, p) => l.giveGoodies(p.participantId, p.given !== false), roles: ['admin', 'boutique'] },
  setDuration: { run: (l, p) => l.setDuration(p.durationMs) },
  setTableEnabled: { run: (l, p) => l.setTableEnabled(p.tableNo, p.enabled) },
  setPlacementsPaused: { run: (l, p) => l.setPlacementsPaused(p.paused) },
  newDay: { run: (l) => l.newDay() },
};

// Valeur de TRUST_PROXY : « true » / « false », un nombre de proxys, ou une liste d'adresses
// ou de sous-réseaux séparés par des virgules (syntaxe Express).
function parseTrustProxy(value) {
  const v = String(value ?? '').trim();
  if (!v) return DEFAULT_TRUST_PROXY;
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host === String(host).split(',')[0].trim();
  } catch {
    return false;
  }
}

function createApp({
  dbFile = ':memory:',
  password,
  boutiquePassword = null,
  sessionSecret,
  now = () => Date.now(),
  tickMs = TICK_MS,
  trustProxy = DEFAULT_TRUST_PROXY,
} = {}) {
  const db = openDb(dbFile);
  const lobby = new Lobby(db, { now });

  let secret = sessionSecret;
  if (!secret) {
    secret = lobby.getSetting('session_secret', null);
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex');
      lobby.setSetting('session_secret', secret);
    }
  }
  const auth = createAuth({ password, boutiquePassword, secret, now });

  const app = express();
  app.disable('x-powered-by');
  try {
    app.set('trust proxy', trustProxy);
  } catch (err) {
    throw new Error(`TRUST_PROXY invalide (${trustProxy}) : ${err.message}`);
  }
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    // HTTPS (derrière le proxy) : le navigateur ne repassera plus en HTTP clair sur ce domaine.
    if (req.secure) res.set('Strict-Transport-Security', `max-age=${HSTS_MAX_AGE_S}`);
    next();
  });

  const HOME_OF_ROLE = { admin: '/accueil', boutique: '/boutique' };
  const requireRole = (...roles) => (req, res, next) => {
    if (roles.includes(auth.roleOf(req.headers.cookie))) return next();
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ ok: false, message: 'Non authentifié.' });
  };
  const requireAuth = requireRole('admin');
  const sendPage = (file) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, file));
  };

  app.get('/', (req, res) => res.redirect('/ecran'));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/ecran', sendPage('ecran/index.html'));
  app.get('/accueil', requireAuth, sendPage('accueil/index.html'));
  app.get('/boutique', requireRole('admin', 'boutique'), sendPage('boutique/index.html'));

  app.get('/login', (req, res, next) => {
    const role = auth.roleOf(req.headers.cookie);
    if (role) return res.redirect(HOME_OF_ROLE[role]);
    return sendPage('login.html')(req, res, next);
  });
  app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    const ip = req.ip || 'unknown';
    if (!sameOrigin(req)) return res.status(403).send('Origine refusée.');
    // Deux compteurs : l'IP du client (req.ip, d'après le proxy) et l'adresse de la connexion TCP,
    // qu'un X-Forwarded-For inventé ne peut pas faire varier.
    if (!auth.allowAttempt(ip, req.socket.remoteAddress || 'unknown')) return res.redirect('/login?error=trop');
    const role = auth.roleForPassword(req.body?.password);
    if (!role) return res.redirect('/login?error=1');
    auth.resetAttempts(ip);
    res.set('Set-Cookie', auth.cookieHeader(auth.issueToken(role), { secure: req.secure }));
    return res.redirect(HOME_OF_ROLE[role]);
  });
  app.post('/logout', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send('Origine refusée.');
    res.set('Set-Cookie', auth.clearCookieHeader({ secure: req.secure }));
    return res.redirect('/login');
  });

  app.get('/api/export.csv', requireAuth, (req, res) => {
    const stamp = new Date(now()).toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="participants-riftbound-${stamp}.csv"`);
    res.set('Cache-Control', 'no-store');
    res.send(buildCsv(lobby.exportRows()));
  });

  // Polices auto-hébergées (pas de dépendance à Google Fonts sur le stand).
  for (const pkg of FONT_PACKAGES) {
    const dir = path.dirname(require.resolve(`${pkg}/package.json`));
    app.use(`/fonts/${pkg.split('/')[1]}`, express.static(dir, { maxAge: '30d', immutable: true }));
  }
  app.use(express.static(PUBLIC_DIR, { index: false, extensions: false }));

  const server = http.createServer(app);
  const io = new Server(server, {
    serveClient: true,
    allowRequest: (req, callback) => callback(null, sameOrigin(req)),
  });

  // Chaque salle reçoit sa projection : complète (accueil), boutique (sans email), publique (TV).
  const STATE_OF_ROOM = {
    admin: () => lobby.getAdminState(),
    boutique: () => lobby.getBoutiqueState(),
    public: () => lobby.getPublicState(),
  };

  function broadcast() {
    for (const [room, build] of Object.entries(STATE_OF_ROOM)) {
      if (io.sockets.adapter.rooms.get(room)?.size) io.to(room).emit('state', build());
    }
  }

  io.on('connection', (socket) => {
    const role = auth.roleOf(socket.handshake.headers.cookie);
    const room = role || 'public';
    socket.join(room);
    socket.emit('session', { admin: role === 'admin', role });
    socket.emit('state', STATE_OF_ROOM[room]());

    socket.on('action', (message, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!role) return reply({ ok: false, code: 'unauthorized', message: 'Connexion requise.' });
      const { type, payload } = message || {};
      const action = Object.prototype.hasOwnProperty.call(ACTIONS, type) ? ACTIONS[type] : null;
      if (!action) return reply({ ok: false, code: 'unknown_action', message: 'Action inconnue.' });
      if (!(action.roles || ['admin']).includes(role)) {
        return reply({ ok: false, code: 'forbidden', message: 'Action réservée à l’accueil.' });
      }
      try {
        const result = action.run(lobby, payload && typeof payload === 'object' ? payload : {});
        reply({ ok: true, result });
        if (action.mutates !== false) broadcast();
      } catch (err) {
        if (err instanceof LobbyError) {
          reply({ ok: false, code: err.code, message: err.message, details: err.details });
        } else {
          console.error(`[action ${type}]`, err);
          reply({ ok: false, code: 'server_error', message: 'Erreur interne du serveur.' });
        }
      }
      return undefined;
    });
  });

  // Fin des timers et placements automatiques.
  const runTick = () => {
    try {
      if (lobby.tick()) broadcast();
    } catch (err) {
      console.error('[tick]', err);
    }
  };
  runTick();
  const timer = tickMs > 0 ? setInterval(runTick, tickMs) : null;

  function close() {
    if (timer) clearInterval(timer);
    return new Promise((resolve) => {
      io.close(() => {
        db.close();
        resolve();
      });
    });
  }

  return { app, server, io, lobby, db, auth, broadcast, runTick, close };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  let password = process.env.ACCUEIL_PASSWORD;
  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      console.error('ACCUEIL_PASSWORD doit être défini en production.');
      process.exit(1);
    }
    password = 'riftbound';
    console.warn('⚠ ACCUEIL_PASSWORD non défini : mot de passe de développement « riftbound ».');
  }
  if (process.env.BOUTIQUE_PASSWORD && process.env.BOUTIQUE_PASSWORD === password) {
    console.warn('⚠ BOUTIQUE_PASSWORD est identique à ACCUEIL_PASSWORD : la boutique aurait accès à l’accueil. Choisissez un mot de passe différent.');
  }
  const instance = createApp({
    dbFile: path.join(dataDir, 'lobby.db'),
    password,
    boutiquePassword: process.env.BOUTIQUE_PASSWORD || null,
    sessionSecret: process.env.SESSION_SECRET,
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  });
  instance.server.listen(port, () => {
    console.log(`Lobby Riftbound prêt sur http://localhost:${port}  (écran : /ecran, accueil : /accueil, boutique : /boutique)`);
  });
  const shutdown = () => {
    console.log('Arrêt…');
    instance.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApp, ACTIONS, parseTrustProxy, DEFAULT_TRUST_PROXY };
