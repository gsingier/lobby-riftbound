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
const TICK_MS = 1000;

// Actions de l'accueil reçues via Socket.IO : `action` { type, payload } → ack.
// `mutates: false` = lecture seule, pas de diffusion d'un nouvel état.
const ACTIONS = {
  register: { run: (l, p) => l.register(p.players) },
  check: { run: (l, p) => l.check(p), mutates: false },
  search: { run: (l, p) => l.search(p.query), mutates: false },
  removeParticipant: { run: (l, p) => l.removeParticipant(p.participantId) },
  editParticipant: { run: (l, p) => l.editParticipant(p.participantId, p.fields) },
  placeAnyway: { run: (l, p) => l.placeAnyway(p.entryId) },
  cancelPlaceAnyway: { run: (l, p) => l.cancelPlaceAnyway(p.entryId) },
  releaseMatch: { run: (l, p) => l.releaseMatch(p.matchId) },
  adjustMatch: { run: (l, p) => l.adjustMatch(p.matchId, p.deltaMs) },
  giveGoodies: { run: (l, p) => l.giveGoodies(p.participantId, p.given !== false) },
  setDuration: { run: (l, p) => l.setDuration(p.durationMs) },
  setTableEnabled: { run: (l, p) => l.setTableEnabled(p.tableNo, p.enabled) },
  newDay: { run: (l) => l.newDay() },
};

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

function createApp({ dbFile = ':memory:', password, sessionSecret, now = () => Date.now(), tickMs = TICK_MS } = {}) {
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
  const auth = createAuth({ password, secret, now });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    next();
  });

  const requireAuth = (req, res, next) => {
    if (auth.isAuthenticated(req.headers.cookie)) return next();
    if (req.accepts('html')) return res.redirect('/login');
    return res.status(401).json({ ok: false, message: 'Non authentifié.' });
  };
  const sendPage = (file) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, file));
  };

  app.get('/', (req, res) => res.redirect('/ecran'));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.get('/ecran', sendPage('ecran/index.html'));
  app.get('/accueil', requireAuth, sendPage('accueil/index.html'));

  app.get('/login', (req, res, next) => {
    if (auth.isAuthenticated(req.headers.cookie)) return res.redirect('/accueil');
    return sendPage('login.html')(req, res, next);
  });
  app.post('/login', express.urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    const ip = req.ip || 'unknown';
    if (!sameOrigin(req)) return res.status(403).send('Origine refusée.');
    if (!auth.allowAttempt(ip)) return res.redirect('/login?error=trop');
    if (!auth.checkPassword(req.body?.password)) return res.redirect('/login?error=1');
    auth.resetAttempts(ip);
    res.set('Set-Cookie', auth.cookieHeader(auth.issueToken(), { secure: req.secure }));
    return res.redirect('/accueil');
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

  app.use(express.static(PUBLIC_DIR, { index: false, extensions: false }));

  const server = http.createServer(app);
  const io = new Server(server, {
    serveClient: true,
    allowRequest: (req, callback) => callback(null, sameOrigin(req)),
  });

  function broadcast() {
    io.to('admin').emit('state', lobby.getAdminState());
    io.to('public').emit('state', lobby.getPublicState());
  }

  io.on('connection', (socket) => {
    const isAdmin = auth.isAuthenticated(socket.handshake.headers.cookie);
    socket.join(isAdmin ? 'admin' : 'public');
    socket.emit('session', { admin: isAdmin });
    socket.emit('state', isAdmin ? lobby.getAdminState() : lobby.getPublicState());

    socket.on('action', (message, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!isAdmin) return reply({ ok: false, code: 'unauthorized', message: 'Connexion requise.' });
      const { type, payload } = message || {};
      const action = Object.prototype.hasOwnProperty.call(ACTIONS, type) ? ACTIONS[type] : null;
      if (!action) return reply({ ok: false, code: 'unknown_action', message: 'Action inconnue.' });
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
  const instance = createApp({
    dbFile: path.join(dataDir, 'lobby.db'),
    password,
    sessionSecret: process.env.SESSION_SECRET,
  });
  instance.server.listen(port, () => {
    console.log(`Lobby Riftbound prêt sur http://localhost:${port}  (écran : /ecran, accueil : /accueil)`);
  });
  const shutdown = () => {
    console.log('Arrêt…');
    instance.close().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

module.exports = { createApp, ACTIONS };
