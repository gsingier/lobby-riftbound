'use strict';

// Tests d'intégration : Express + Socket.IO + SQLite (server/index.js), horloge injectée.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { io: ioClient } = require('socket.io-client');
const { createApp, ACTIONS, parseTrustProxy, DEFAULT_TRUST_PROXY } = require('../server/index');
const { COOKIE_NAME, LOGIN_MAX_ATTEMPTS_PER_PEER } = require('../server/auth');
const { formatDate } = require('../server/csv');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 9, 28, 8, 0, 0);

// ---------------------------------------------------------------- outils

async function start({ clock = { t: T0 }, ...options } = {}) {
  const instance = createApp({ password: 'test', tickMs: 0, now: () => clock.t, ...options });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const sockets = [];
  return {
    instance,
    lobby: instance.lobby,
    base,
    clock,
    track(socket) {
      sockets.push(socket);
      return socket;
    },
    async close() {
      for (const s of sockets) s.disconnect();
      await instance.close();
    },
  };
}

function login(base, password = 'test', headers = {}) {
  return fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: password === null ? '' : new URLSearchParams({ password }).toString(),
  });
}

function setCookies(res) {
  return res.headers.getSetCookie();
}

async function adminCookie(base) {
  const res = await login(base);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/accueil');
  return setCookies(res)[0].split(';')[0];
}

function get(base, url, headers = {}) {
  return fetch(`${base}${url}`, { redirect: 'manual', headers });
}

function waitFor(socket, event, filter = () => true, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Délai dépassé en attendant « ${event} »`));
    }, timeout);
    function handler(data) {
      if (!filter(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    }
    socket.on(event, handler);
  });
}

// Ouvre un socket et attend `session` + premier `state`.
async function openSocket(ctx, { cookie, origin, transport = 'websocket' } = {}) {
  const extraHeaders = {};
  if (cookie) extraHeaders.cookie = cookie;
  if (origin) extraHeaders.origin = origin;
  const socket = ctx.track(
    ioClient(ctx.base, { transports: [transport], extraHeaders, reconnection: false, forceNew: true, timeout: 3000 }),
  );
  const states = [];
  socket.on('state', (s) => states.push(s));
  const session = waitFor(socket, 'session');
  const first = waitFor(socket, 'state');
  await waitFor(socket, 'connect');
  return { socket, states, session: await session, state: await first };
}

function action(socket, type, payload) {
  return socket.timeout(2000).emitWithAck('action', payload === undefined ? { type } : { type, payload });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let seq = 0;
function player(firstName = 'Joueur', lastName = 'Test') {
  seq += 1;
  return { firstName, lastName, email: `p${seq}@exemple.fr`, ticket: `PGW-${5000 + seq}` };
}

// ---------------------------------------------------------------- pages et authentification

test('pages publiques, sonde de santé et en-têtes de sécurité', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const health = await get(ctx.base, '/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(health.headers.get('x-powered-by'), null);
  const root = await get(ctx.base, '/');
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/ecran');
  const ecran = await get(ctx.base, '/ecran');
  assert.equal(ecran.status, 200);
  assert.match(ecran.headers.get('content-type'), /text\/html/);
  // corps lus jusqu'au bout : sinon la fermeture du serveur attend ces connexions
  await ecran.arrayBuffer();
  for (const url of ['/shared/client.js', '/shared/theme.css', '/socket.io/socket.io.js', '/login']) {
    const res = await get(ctx.base, url);
    assert.equal(res.status, 200, url);
    await res.arrayBuffer();
  }
});

test('/accueil et /api/export.csv sans cookie : redirection vers /login (ou 401 en JSON)', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  for (const url of ['/accueil', '/api/export.csv']) {
    const res = await get(ctx.base, url);
    assert.equal(res.status, 302, url);
    assert.equal(res.headers.get('location'), '/login');
    const api = await get(ctx.base, url, { accept: 'application/json' });
    assert.equal(api.status, 401);
    assert.deepEqual(await api.json(), { ok: false, message: 'Non authentifié.' });
  }
});

test('POST /login : mauvais mot de passe → /login?error=1 ; bon → cookie signé et /accueil', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const bad = await login(ctx.base, 'mauvais');
  assert.equal(bad.status, 302);
  assert.equal(bad.headers.get('location'), '/login?error=1');
  assert.deepEqual(setCookies(bad), []);
  const empty = await login(ctx.base, null); // champ absent
  assert.equal(empty.headers.get('location'), '/login?error=1');

  const ok = await login(ctx.base, 'test');
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/accueil');
  const [raw] = setCookies(ok);
  assert.match(raw, new RegExp(`^${COOKIE_NAME}=admin\\.\\d+\\.[\\w-]+;`));
  assert.match(raw, /; Path=\//);
  assert.match(raw, /; HttpOnly/);
  assert.match(raw, /; SameSite=Strict/);
  assert.match(raw, /; Max-Age=604800/);
  assert.doesNotMatch(raw, /Secure/, 'pas de Secure en HTTP');
  const cookie = raw.split(';')[0];

  const page = await get(ctx.base, '/accueil', { cookie });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const again = await get(ctx.base, '/login', { cookie });
  assert.equal(again.status, 302);
  assert.equal(again.headers.get('location'), '/accueil');

  // derrière le proxy HTTPS (Coolify), le cookie est marqué Secure
  const secure = await login(ctx.base, 'test', { 'x-forwarded-proto': 'https' });
  assert.match(setCookies(secure)[0], /; Secure/);
});

test('limitation des essais de connexion', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  // une connexion réussie remet le compteur à zéro
  for (let i = 0; i < 9; i++) await login(ctx.base, 'faux');
  assert.equal((await login(ctx.base, 'test')).headers.get('location'), '/accueil');
  for (let i = 0; i < 10; i++) {
    assert.equal((await login(ctx.base, `faux${i}`)).headers.get('location'), '/login?error=1', `essai ${i + 1}`);
  }
  // 11e essai : bloqué, même avec le bon mot de passe
  const blocked = await login(ctx.base, 'test');
  assert.equal(blocked.headers.get('location'), '/login?error=trop');
  assert.deepEqual(setCookies(blocked), []);
  // après la fenêtre de 5 minutes, la connexion redevient possible
  ctx.clock.t += 5 * MIN;
  assert.equal((await login(ctx.base, 'test')).headers.get('location'), '/accueil');
});

test('X-Forwarded-For inventé : la limite par connexion TCP s’applique quand même', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  // 127.0.0.1 est une adresse de proxy de confiance par défaut : son X-Forwarded-For est lu,
  // mais tous ces essais passent par la même connexion TCP
  for (let i = 0; i < LOGIN_MAX_ATTEMPTS_PER_PEER; i++) {
    const res = await login(ctx.base, `faux${i}`, { 'x-forwarded-for': `10.9.${i >> 8}.${i & 255}` });
    assert.equal(res.headers.get('location'), '/login?error=1', `essai ${i + 1}`);
  }
  const blocked = await login(ctx.base, 'test', { 'x-forwarded-for': '10.200.0.1' });
  assert.equal(blocked.headers.get('location'), '/login?error=trop');
  assert.deepEqual(setCookies(blocked), []);
  ctx.clock.t += 5 * MIN;
  assert.equal((await login(ctx.base, 'test', { 'x-forwarded-for': '10.200.0.1' })).headers.get('location'), '/accueil');
});

test('TRUST_PROXY=false (port exposé sans proxy) : X-Forwarded-For et X-Forwarded-Proto ignorés', async (t) => {
  const ctx = await start({ trustProxy: parseTrustProxy('false') });
  t.after(() => ctx.close());
  for (let i = 0; i < 10; i++) {
    const res = await login(ctx.base, `faux${i}`, { 'x-forwarded-for': `10.9.0.${i}` });
    assert.equal(res.headers.get('location'), '/login?error=1', `essai ${i + 1}`);
  }
  const blocked = await login(ctx.base, 'test', { 'x-forwarded-for': '1.2.3.4' });
  assert.equal(blocked.headers.get('location'), '/login?error=trop', '11e essai bloqué malgré un X-Forwarded-For neuf');
  ctx.clock.t += 5 * MIN;
  const ok = await login(ctx.base, 'test', { 'x-forwarded-proto': 'https' });
  assert.equal(ok.headers.get('location'), '/accueil');
  assert.doesNotMatch(setCookies(ok)[0], /Secure/, 'X-Forwarded-Proto non cru');
  assert.equal(ok.headers.get('strict-transport-security'), null);
});

test('TRUST_PROXY : lecture de la variable d’environnement', () => {
  assert.equal(DEFAULT_TRUST_PROXY, 'loopback, linklocal, uniquelocal');
  assert.equal(parseTrustProxy(undefined), DEFAULT_TRUST_PROXY);
  assert.equal(parseTrustProxy('  '), DEFAULT_TRUST_PROXY);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('FALSE'), false);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy(' 10.0.0.0/8, 127.0.0.1 '), '10.0.0.0/8, 127.0.0.1');
  assert.throws(() => createApp({ password: 'test', tickMs: 0, trustProxy: 'pas-une-ip' }), /TRUST_PROXY invalide/);
});

test('HTTPS derrière le proxy : en-tête Strict-Transport-Security (absent en HTTP)', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  for (const url of ['/login', '/ecran', '/healthz', '/accueil']) {
    const secure = await get(ctx.base, url, { 'x-forwarded-proto': 'https' });
    assert.equal(secure.headers.get('strict-transport-security'), 'max-age=31536000', url);
    await secure.arrayBuffer();
    const plain = await get(ctx.base, url);
    assert.equal(plain.headers.get('strict-transport-security'), null, url);
    await plain.arrayBuffer();
  }
  const ok = await login(ctx.base, 'test', { 'x-forwarded-proto': 'https' });
  assert.equal(ok.headers.get('strict-transport-security'), 'max-age=31536000');
});

test('Origin étranger refusé pour /login, /logout et le handshake Socket.IO', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  for (const origin of ['http://evil.example', 'null', `${ctx.base.replace('127.0.0.1', 'localhost')}`]) {
    const res = await login(ctx.base, 'test', { origin });
    assert.equal(res.status, 403, origin);
    assert.deepEqual(setCookies(res), []);
  }
  assert.equal((await login(ctx.base, 'test', { origin: ctx.base })).headers.get('location'), '/accueil');
  // derrière le proxy : X-Forwarded-Host fait foi
  const proxied = await login(ctx.base, 'test', { origin: 'https://lobby.example.fr', 'x-forwarded-host': 'lobby.example.fr' });
  assert.equal(proxied.headers.get('location'), '/accueil');

  const logout = await fetch(`${ctx.base}/logout`, { method: 'POST', redirect: 'manual', headers: { origin: 'http://evil.example' } });
  assert.equal(logout.status, 403);

  const cookie = await adminCookie(ctx.base);
  for (const transport of ['websocket', 'polling']) {
    const socket = ctx.track(
      ioClient(ctx.base, {
        transports: [transport],
        extraHeaders: { origin: 'http://evil.example', cookie },
        reconnection: false,
        forceNew: true,
      }),
    );
    const err = await waitFor(socket, 'connect_error');
    assert.ok(err instanceof Error, transport);
    assert.equal(socket.connected, false);
  }
  const ok = await openSocket(ctx, { origin: ctx.base, cookie });
  assert.deepEqual(ok.session, { admin: true });
});

test('/logout efface le cookie', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const res = await fetch(`${ctx.base}/logout`, { method: 'POST', redirect: 'manual', headers: { origin: ctx.base } });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  const [raw] = setCookies(res);
  assert.match(raw, new RegExp(`^${COOKIE_NAME}=;`));
  assert.match(raw, /Max-Age=0/);
  assert.match(raw, /HttpOnly/);
});

test('cookie falsifié, signé par un autre serveur ou expiré : refusé (HTTP et Socket.IO)', async (t) => {
  const ctx = await start();
  const other = await start({ clock: ctx.clock });
  t.after(async () => {
    await ctx.close();
    await other.close();
  });
  const cookie = await adminCookie(ctx.base);
  const [name, token] = cookie.split('=');
  const [, expires, sig] = token.split('.');
  const flip = (c) => (c === 'A' ? 'B' : 'A');
  const forged = [
    `${name}=admin.${expires}.${sig.slice(0, -1)}${flip(sig.slice(-1))}`,
    `${name}=admin.${Number(expires) + 1000}.${sig}`,
    `${name}=root.${expires}.${sig}`,
    `${name}=admin.${expires}`,
    `${name}=n'importe quoi`,
    `${name}=${encodeURIComponent('admin.9999999999999.%%%')}`,
    await adminCookie(other.base), // autre secret de session
  ];
  for (const bad of forged) {
    const res = await get(ctx.base, '/accueil', { cookie: bad });
    assert.equal(res.status, 302, bad);
    assert.equal(res.headers.get('location'), '/login');
  }
  const s = await openSocket(ctx, { cookie: forged[0] });
  assert.deepEqual(s.session, { admin: false });
  assert.equal((await action(s.socket, 'newDay')).code, 'unauthorized');

  // cookie valide…
  assert.equal((await get(ctx.base, '/accueil', { cookie })).status, 200);
  // … jusqu'à son expiration (7 jours)
  ctx.clock.t += 7 * 24 * HOUR + 1;
  const expired = await get(ctx.base, '/accueil', { cookie });
  assert.equal(expired.status, 302);
  assert.equal((await get(ctx.base, '/api/export.csv', { cookie, accept: 'application/json' })).status, 401);
  const late = await openSocket(ctx, { cookie });
  assert.deepEqual(late.session, { admin: false });
});

// ---------------------------------------------------------------- Socket.IO

test('socket public : état public sans email ni billet, toutes les actions refusées', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  ctx.lobby.register([
    { firstName: 'Lucas', lastName: 'Martin', email: 'lucas.secret@exemple.fr', ticket: 'BILLET-SECRET-1' },
    { firstName: 'Emma', lastName: 'Bernard', email: 'emma.secret@exemple.fr', ticket: 'BILLET-SECRET-2' },
  ]);
  ctx.lobby.register([{ firstName: 'Hugo', lastName: 'Dubois', email: 'hugo.secret@exemple.fr', ticket: 'BILLET-SECRET-3' }]);
  const pub = await openSocket(ctx);
  assert.deepEqual(pub.session, { admin: false });
  const json = JSON.stringify(pub.state);
  for (const secret of ['secret', 'SECRET', '@', 'Martin', 'Bernard', 'Dubois']) {
    assert.ok(!json.includes(secret), `l'état public contient « ${secret} »`);
  }
  assert.equal(pub.state.goodies, undefined);
  assert.equal(pub.state.stats, undefined);
  assert.deepEqual(Object.keys(pub.state).sort(), ['day', 'queue', 'serverNow', 'settings', 'tables']);
  assert.equal(pub.state.serverNow, T0);
  assert.deepEqual(pub.state.tables[0].slots.A.players.map((p) => p.displayName), ['Lucas M.', 'Emma B.']);
  assert.deepEqual(Object.keys(pub.state.tables[0].slots.A.players[0]).sort(), ['displayName', 'id', 'seat']);
  assert.deepEqual(pub.state.queue[0].players.map((p) => p.displayName), ['Hugo D.']);
  assert.deepEqual(Object.keys(pub.state.queue[0].players[0]).sort(), ['displayName', 'id']);

  for (const type of [...Object.keys(ACTIONS), 'inconnue']) {
    const res = await action(pub.socket, type, {});
    assert.equal(res.ok, false, type);
    assert.equal(res.code, 'unauthorized', type);
    assert.equal(typeof res.message, 'string');
  }
  // rien n'a changé
  await sleep(30);
  assert.equal(ctx.lobby.getAdminState().stats.registeredToday, 3);
  assert.equal(pub.states.length, 1, 'aucune diffusion après une action refusée');
});

test('socket admin : action mutante → état diffusé aux sockets publics et admin', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const cookie = await adminCookie(ctx.base);
  const admin = await openSocket(ctx, { cookie });
  const admin2 = await openSocket(ctx, { cookie });
  const pub = await openSocket(ctx);
  assert.deepEqual(admin.session, { admin: true });
  assert.ok(Array.isArray(admin.state.goodies));
  assert.ok(admin.state.stats);

  const nextAdmin = waitFor(admin2.socket, 'state');
  const nextPublic = waitFor(pub.socket, 'state');
  const res = await action(admin.socket, 'register', {
    players: [player('Ana', 'Lopez'), player('Bob', 'Durand')],
  });
  assert.equal(res.ok, true);
  assert.equal(res.result.status, 'playing');
  assert.equal(res.result.tableNo, 1);
  assert.equal(res.result.slot, 'A');
  assert.equal(res.result.participantIds.length, 2);
  const a = await nextAdmin;
  const p = await nextPublic;
  assert.equal(a.tables[0].slots.A.players[0].email, `p${seq - 1}@exemple.fr`);
  assert.equal(a.tables[0].slots.A.players[0].statusLabel, 'en train de jouer');
  assert.equal(a.stats.playing, 2);
  assert.deepEqual(p.tables[0].slots.A.players.map((x) => x.displayName), ['Ana L.', 'Bob D.']);
  assert.ok(!JSON.stringify(p).includes('@'));
  assert.equal(p.tables[0].slots.A.matchId, res.result.matchId);
  assert.equal(p.tables[0].slots.A.endsAt, T0 + HOUR);
});

test('check et search ne diffusent pas d’état ; une action sans accusé de réception est exécutée', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const cookie = await adminCookie(ctx.base);
  const admin = await openSocket(ctx, { cookie });
  const pub = await openSocket(ctx);
  const p = player('Zoé', 'Lefèvre');
  ctx.lobby.register([p]);

  const check = await action(admin.socket, 'check', { email: p.email.toUpperCase(), ticket: 'xxx' });
  assert.equal(check.ok, true);
  assert.equal(check.result.email.name, 'Zoé Lefèvre');
  assert.equal(check.result.ticket, null);
  const search = await action(admin.socket, 'search', { query: 'zoe' });
  assert.equal(search.ok, true);
  assert.deepEqual(search.result.map((r) => r.email), [p.email]);

  // action mutante sans fonction d'accusé de réception
  const changed = (st) => st.settings.matchDurationMs === 30 * MIN;
  const both = Promise.all([waitFor(pub.socket, 'state', changed), waitFor(admin.socket, 'state', changed)]);
  admin.socket.emit('action', { type: 'setDuration', payload: { durationMs: 30 * MIN } });
  await both;
  // seule la mutation a produit un état (premier état à la connexion + 1)
  assert.equal(pub.states.length, 2);
  assert.equal(admin.states.length, 2);
  await sleep(50);
  assert.equal(pub.states.length, 2);
});

test('socket admin : action inconnue, message ou payload mal formés, erreurs métier', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const cookie = await adminCookie(ctx.base);
  const admin = await openSocket(ctx, { cookie });
  const pub = await openSocket(ctx);
  const sock = admin.socket;

  for (const type of ['inconnue', 'toString', '__proto__', 'constructor', 'hasOwnProperty', undefined, 42]) {
    const res = await action(sock, type, {});
    assert.deepEqual(res, { ok: false, code: 'unknown_action', message: 'Action inconnue.' }, String(type));
  }
  for (const message of [null, 'register', 12, []]) {
    const res = await sock.timeout(2000).emitWithAck('action', message);
    assert.equal(res.code, 'unknown_action');
  }
  // payload non objet : traité comme {}
  for (const payload of ['x', 12, null, true]) {
    const res = await action(sock, 'register', payload);
    assert.equal(res.ok, false);
    assert.equal(res.code, 'invalid');
    assert.equal(res.message, 'Une inscription concerne 1 ou 2 joueurs.');
  }
  // identifiants mal formés : erreur métier, pas « server_error »
  for (const [type, payload] of [
    ['removeParticipant', { participantId: true }],
    ['releaseMatch', { matchId: { $gt: 0 } }],
    ['giveGoodies', { participantId: [1, 2] }],
    ['editParticipant', { participantId: 'abc', fields: {} }],
    ['check', { email: 'a@b.fr', excludeParticipantId: {} }],
  ]) {
    const res = await action(sock, type, payload);
    assert.equal(res.code, 'invalid', `${type} ${JSON.stringify(payload)}`);
  }

  const p = player('Ana', 'Lopez');
  const ok = await action(sock, 'register', { players: [p] });
  assert.equal(ok.ok, true);
  assert.equal(ok.result.status, 'waiting');
  assert.equal(ok.result.rank, 1);
  const dup = await action(sock, 'register', { players: [player(), { ...player(), email: ` ${p.email.toUpperCase()} ` }] });
  assert.equal(dup.ok, false);
  assert.equal(dup.code, 'email_used');
  assert.match(dup.message, /déjà été utilisé par Ana Lopez \(jour 1, en file d'attente\)/);
  assert.equal(dup.details.field, 'email');
  assert.equal(dup.details.index, 1);
  assert.equal(dup.details.conflict.participantId, ok.result.participantIds[0]);
  assert.equal(dup.details.conflict.status, 'waiting');
  assert.equal(dup.details.conflict.dayNumber, 1);
  const invalid = await action(sock, 'register', { players: [{ ...player(), lastName: ' ' }] });
  assert.deepEqual(invalid, {
    ok: false,
    code: 'invalid',
    message: 'Le nom est obligatoire.',
    details: { field: 'lastName', index: 0 },
  });
  const notFound = await action(sock, 'releaseMatch', { matchId: 999 });
  assert.equal(notFound.code, 'not_found');
  assert.equal(notFound.message, 'Partie introuvable.');

  // erreur inattendue : message générique, pas de détail interne
  const original = ctx.lobby.search;
  const originalError = console.error;
  ctx.lobby.search = () => {
    throw new Error('boom SQLITE interne');
  };
  console.error = () => {};
  try {
    const res = await action(sock, 'search', { query: 'ana' });
    assert.deepEqual(res, { ok: false, code: 'server_error', message: 'Erreur interne du serveur.' });
  } finally {
    ctx.lobby.search = original;
    console.error = originalError;
  }

  // un seul état diffusé : celui de l'inscription réussie
  await sleep(30);
  assert.equal(pub.states.length, 2);
});

test('parcours complet des actions de l’accueil via Socket.IO', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  const cookie = await adminCookie(ctx.base);
  const admin = await openSocket(ctx, { cookie });
  const pub = await openSocket(ctx);
  const sock = admin.socket;
  // chaque action mutante doit diffuser un état au socket public
  const ok = async (type, payload) => {
    const next = waitFor(pub.socket, 'state');
    const res = await action(sock, type, payload);
    assert.equal(res.ok, true, `${type} : ${res.message}`);
    await next;
    return res.result;
  };

  assert.deepEqual(await ok('setTableEnabled', { tableNo: 1, enabled: false }), { tableNo: 1, enabled: false });
  const pair = await ok('register', { players: [player('Ana'), player('Bob')] });
  assert.equal(pair.tableNo, 2);
  const solo = await ok('register', { players: [player('Solo')] });
  assert.equal(solo.status, 'waiting');
  const placed = await ok('placeAnyway', { entryId: solo.entryId });
  assert.deepEqual(placed, { placed: true, matchId: ctx.lobby.whereIs(solo.participantIds[0]).matchId, tableNo: 3, slot: 'A' });
  assert.equal(pub.states[pub.states.length - 1].tables[2].slots.A.vsAnimator, true);
  const solo2 = await ok('register', { players: [player('Seul')] });
  assert.deepEqual(await ok('cancelPlaceAnyway', { entryId: solo2.entryId }), { entryId: solo2.entryId });
  assert.deepEqual(await ok('editParticipant', { participantId: solo2.participantIds[0], fields: { firstName: 'Seule' } }), {
    participantId: solo2.participantIds[0],
  });
  assert.deepEqual(await ok('removeParticipant', { participantId: solo2.participantIds[0] }), {
    removed: solo2.participantIds[0],
  });
  const adj = await ok('adjustMatch', { matchId: pair.matchId, deltaMs: -HOUR });
  assert.equal(adj.endsAt, T0);
  const goodiesState = ctx.lobby.getAdminState();
  assert.deepEqual(goodiesState.goodies.map((g) => g.firstName).sort(), ['Ana', 'Bob']);
  assert.deepEqual(await ok('giveGoodies', { participantId: pair.participantIds[0] }), {
    participantId: pair.participantIds[0],
    given: true,
  });
  assert.deepEqual(await ok('giveGoodies', { participantId: pair.participantIds[0], given: false }), {
    participantId: pair.participantIds[0],
    given: false,
  });
  const soloMatch = ctx.lobby.whereIs(solo.participantIds[0]).matchId;
  assert.deepEqual(await ok('releaseMatch', { matchId: soloMatch }), { released: soloMatch });
  // absent à l'appel, juste après le placement
  const late = await ok('register', { players: [player('Present'), player('Absent')] });
  const lateMatch = ctx.lobby.whereIs(late.participantIds[1]).matchId;
  assert.deepEqual(await ok('noShow', { participantId: late.participantIds[1] }), {
    removed: late.participantIds[1],
    matchId: lateMatch,
    cancelled: false,
    vsAnimator: true,
  });
  const lateSlot = pub.states[pub.states.length - 1].tables[late.tableNo - 1].slots[late.slot];
  assert.deepEqual(lateSlot.players.map((p) => p.displayName), ['Present T.']);
  assert.equal(lateSlot.vsAnimator, true);
  // fermeture du stand le soir : visible sur l'écran public
  assert.deepEqual(await ok('setPlacementsPaused', { paused: true }), { placementsPaused: true, placed: 0 });
  assert.equal(pub.states[pub.states.length - 1].settings.placementsPaused, true);
  const closed = await ok('register', { players: [player('Tard1'), player('Tard2')] });
  assert.equal(closed.status, 'waiting');
  const bad = await action(sock, 'setPlacementsPaused', { paused: 'oui' });
  assert.equal(bad.code, 'invalid');
  assert.deepEqual(await ok('setDuration', { durationMs: 45 * MIN }), { matchDurationMs: 45 * MIN });
  const day = await ok('newDay', {});
  assert.equal(day.dayNumber, 2);
  const last = pub.states[pub.states.length - 1];
  assert.equal(last.day.number, 2);
  assert.equal(last.settings.matchDurationMs, 45 * MIN);
  assert.deepEqual(last.settings.disabledTables, [1]);
  assert.equal(last.settings.placementsPaused, false, 'la nouvelle journée rouvre le stand');
  assert.equal(day.expiredParticipants, 2);
});

// ---------------------------------------------------------------- export CSV

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

test('/api/export.csv : BOM, séparateur ;, échappement et neutralisation des formules', async (t) => {
  const ctx = await start();
  t.after(() => ctx.close());
  ctx.lobby.register([
    { firstName: 'Jean "JJ"', lastName: 'Dupont;Martin', email: 'jj@exemple.fr', ticket: 'AB\nCD' },
    { firstName: '=HYPERLINK("http://x";"clic")', lastName: '+33 6', email: 'f@exemple.fr', ticket: '-42' },
  ]);
  ctx.lobby.register([{ firstName: '@SUM(A1)', lastName: '-Moins', email: 'g@exemple.fr', ticket: 'T3' }]);
  const cookie = await adminCookie(ctx.base);
  const res = await get(ctx.base, '/api/export.csv', { cookie });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.equal(res.headers.get('content-disposition'), 'attachment; filename="participants-riftbound-2026-10-28.csv"');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const buf = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM UTF-8');
  const text = buf.toString('utf8').slice(1);
  assert.ok(text.endsWith('\r\n'));

  // cellules brutes
  assert.ok(text.includes('"Jean ""JJ"""'));
  assert.ok(text.includes('"Dupont;Martin"'));
  assert.ok(text.includes('"AB\nCD"'));
  assert.ok(text.includes(`"'=HYPERLINK(""http://x"";""clic"")"`));
  assert.ok(text.includes(";'+33 6;"));
  assert.ok(text.includes(";'-42;"));
  assert.ok(text.includes("'@SUM(A1);'-Moins;"));

  const rows = parseCsv(text);
  assert.deepEqual(rows[0], [
    'ID', 'Jour', 'Prénom', 'Nom', 'Email', 'Billet', 'Statut', 'Inscrit le', 'Table', 'Emplacement',
    'Contre un animateur', 'Début de partie', 'Fin de partie', 'Goodies remis le',
  ]);
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.length === 14));
  assert.deepEqual(rows[1], [
    '1', '1', 'Jean "JJ"', 'Dupont;Martin', 'jj@exemple.fr', 'AB\nCD', 'en train de jouer', formatDate(T0),
    '1', 'A', 'non', formatDate(T0), '', '',
  ]);
  assert.deepEqual(rows[2].slice(2, 6), [`'=HYPERLINK("http://x";"clic")`, "'+33 6", 'f@exemple.fr', "'-42"]);
  assert.deepEqual(rows[3].slice(2, 11), ["'@SUM(A1)", "'-Moins", 'g@exemple.fr', 'T3', "en file d'attente", formatDate(T0), '', '', '']);
});

// ---------------------------------------------------------------- persistance et timers

test('persistance : redémarrage sur le même fichier, timers écoulés pendant l’arrêt, session conservée', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobby-riftbound-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbFile = path.join(dir, 'data', 'lobby.db');
  const clock = { t: T0 };

  const first = await start({ dbFile, clock });
  for (let i = 0; i < 19; i++) first.lobby.register([player(`A${i}`), player(`B${i}`)]);
  first.lobby.setDuration(30 * MIN); // pour les parties suivantes
  first.lobby.setTableEnabled(9, false); // hors service, la partie en cours continue
  const before = first.lobby.getAdminState();
  assert.equal(before.queue.length, 1);
  const cookie = await adminCookie(first.base);
  await first.close();
  assert.ok(fs.existsSync(dbFile));

  clock.t = T0 + HOUR + 5 * MIN; // le serveur a été arrêté plus d'une heure
  const second = await start({ dbFile, clock });
  t.after(() => second.close());
  const st = second.lobby.getAdminState();
  // au démarrage (runTick) : les 18 parties sont terminées, la paire suivante est placée
  assert.equal(st.goodies.length, 36);
  assert.ok(st.goodies.every((g) => g.endedAt === T0 + HOUR), 'fin enregistrée à la fin prévue du timer');
  assert.equal(st.queue.length, 0);
  assert.deepEqual(st.tables[0].slots.A.players.map((p) => p.firstName), ['A18', 'B18']);
  assert.equal(st.tables[0].slots.A.startedAt, clock.t);
  assert.equal(st.tables[0].slots.A.endsAt, clock.t + 30 * MIN);
  assert.deepEqual(st.settings, {
    matchDurationMs: 30 * MIN,
    disabledTables: [9],
    placementsPaused: false,
    noShowWindowMs: 15 * MIN,
  });
  assert.equal(st.day.id, before.day.id);
  assert.equal(st.stats.completedToday, 36);

  // le secret de session est en base : le cookie émis avant le redémarrage reste valide
  assert.equal((await get(second.base, '/accueil', { cookie })).status, 200);
  const admin = await openSocket(second, { cookie });
  assert.deepEqual(admin.session, { admin: true });
  assert.equal(admin.state.goodies.length, 36);
  const res = await action(admin.socket, 'giveGoodies', { participantId: st.goodies[0].id });
  assert.equal(res.ok, true);
});

test('tick : la fin du timer diffuse un nouvel état (horloge contrôlée)', async (t) => {
  const clock = { t: T0 };
  const ctx = await start({ clock, tickMs: 15 });
  t.after(() => ctx.close());
  const cookie = await adminCookie(ctx.base);
  const admin = await openSocket(ctx, { cookie });
  const pub = await openSocket(ctx);
  for (let i = 0; i < 18; i++) ctx.lobby.register([player(), player()]);
  ctx.lobby.register([player('Suivant1'), player('Suivant2')]);
  ctx.instance.broadcast();
  await waitFor(pub.socket, 'state', (s) => s.queue.length === 1);

  // rien ne change : le tick ne diffuse rien
  const count = pub.states.length;
  await sleep(80);
  assert.equal(pub.states.length, count);

  clock.t += HOUR;
  const [p, a] = await Promise.all([
    waitFor(pub.socket, 'state', (s) => s.queue.length === 0),
    waitFor(admin.socket, 'state', (s) => s.goodies.length === 36),
  ]);
  assert.equal(p.serverNow, clock.t);
  assert.deepEqual(p.tables[0].slots.A.players.map((x) => x.displayName), ['Suivant1 T.', 'Suivant2 T.']);
  assert.equal(p.tables[0].slots.A.startedAt, clock.t);
  assert.ok(p.tables.slice(1).every((tb) => !tb.slots.A && !tb.slots.B));
  assert.equal(a.stats.goodiesPending, 36);
  assert.equal(a.stats.playing, 2);
});
