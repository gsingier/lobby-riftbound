'use strict';

// Rôle « boutique » : remise des cartes promo (moteur, authentification, Socket.IO).

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { openDb } = require('../server/db');
const { Lobby } = require('../server/lobby');
const { createApp } = require('../server/index');

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 28, 8, 0, 0);

let seq = 0;
function player(firstName = 'Joueur', lastName = 'Test') {
  seq += 1;
  return { firstName, lastName, email: `b${seq}@exemple.fr`, ticket: `PGW-${7000 + seq}` };
}

function engine() {
  const clock = { t: T0 };
  const lobby = new Lobby(openDb(':memory:'), { now: () => clock.t });
  return { clock, lobby };
}

// ---------------------------------------------------------------- moteur

test('état boutique : cartes à remettre (tous les jours), jamais d’email', () => {
  const { clock, lobby } = engine();
  const a = lobby.register([player('Ana', 'Martin'), player('Bob', 'Durand')]);
  clock.t += HOUR;
  lobby.tick();
  lobby.newDay();
  lobby.register([player('Cléo', 'Petit'), player('Dan', 'Roux')]);
  const s = lobby.getBoutiqueState();
  assert.equal(s.day.number, 2);
  assert.equal(s.stats.pending, 2);
  assert.equal(s.stats.playing, 2);
  assert.deepEqual(s.pending.map((p) => p.id).sort(), a.participantIds.slice().sort());
  assert.ok(s.pending.every((p) => p.eligible && p.dayNumber === 1 && p.tableNo === 1 && p.ticket));
  assert.ok(!JSON.stringify(s).includes('@'));
  assert.ok(!('tables' in s) && !('queue' in s));
});

test('une carte promo ne peut être remise qu’une fois ; l’annulation la rend de nouveau due', () => {
  const { clock, lobby } = engine();
  const { participantIds } = lobby.register([player(), player()]);
  clock.t += HOUR;
  lobby.tick();
  lobby.giveGoodies(participantIds[0]);
  assert.throws(
    () => lobby.giveGoodies(participantIds[0]),
    (e) => e.code === 'already_given' && /déjà remise le \d\d\/\d\d à \d\d:\d\d/.test(e.message) && e.details.givenAt === clock.t,
  );
  const s = lobby.getBoutiqueState();
  assert.equal(s.stats.pending, 1);
  assert.equal(s.stats.givenToday, 1);
  assert.equal(s.recentGiven[0].id, participantIds[0]);
  lobby.giveGoodies(participantIds[0], false);
  assert.equal(lobby.getBoutiqueState().stats.pending, 2);
});

test('recherche boutique : billet exact en tête, statuts utiles, sans email', () => {
  const { clock, lobby } = engine();
  const done = player('Lucas', 'Martin');
  const { participantIds } = lobby.register([done, player('Emma', 'Martin')]);
  clock.t += HOUR;
  lobby.tick();
  const playing = player('Lucas', 'Martinez');
  lobby.register([playing, player()]);
  const res = lobby.boutiqueSearch(done.ticket.toLowerCase());
  assert.equal(res[0].id, participantIds[0]);
  assert.equal(res[0].eligible, true);
  const byName = lobby.boutiqueSearch('martin');
  assert.ok(byName.length >= 3);
  assert.ok(byName[0].eligible, 'les cartes à remettre passent avant les joueurs en cours');
  const inGame = byName.find((p) => p.firstName === 'Lucas' && p.lastName === 'Martinez');
  assert.equal(inGame.status, 'playing');
  assert.equal(inGame.eligible, false);
  assert.equal(inGame.endsAt, clock.t + HOUR);
  assert.ok(byName.every((p) => !('email' in p)));
  assert.deepEqual(lobby.boutiqueSearch('m'), []);
});

// ---------------------------------------------------------------- serveur

async function start(options = {}) {
  const instance = createApp({ password: 'accueil', tickMs: 0, now: () => T0, ...options });
  await new Promise((resolve) => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const sockets = [];
  return {
    instance,
    base,
    async socket(cookie) {
      const s = ioClient(base, { transports: ['websocket'], extraHeaders: cookie ? { cookie } : {}, forceNew: true, reconnection: false });
      sockets.push(s);
      const states = [];
      s.on('state', (st) => states.push(st));
      const session = new Promise((resolve) => s.once('session', resolve));
      const first = new Promise((resolve) => s.once('state', resolve));
      return { s, states, session: await session, state: await first };
    },
    async close() {
      for (const s of sockets) s.disconnect();
      await instance.close();
    },
  };
}

async function loginAs(base, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }).toString(),
  });
  const cookie = res.headers.getSetCookie()[0]?.split(';')[0];
  return { res, cookie };
}

const get = (base, url, cookie) => fetch(`${base}${url}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
const act = (s, type, payload) => s.timeout(2000).emitWithAck('action', { type, payload });

test('mot de passe boutique : accès à /boutique seulement, redirections par rôle', async (t) => {
  const ctx = await start({ boutiquePassword: 'boutique' });
  t.after(() => ctx.close());
  const { res, cookie } = await loginAs(ctx.base, 'boutique');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/boutique');
  assert.equal((await get(ctx.base, '/boutique', cookie)).status, 200);
  assert.equal((await get(ctx.base, '/accueil', cookie)).headers.get('location'), '/login');
  assert.equal((await get(ctx.base, '/login', cookie)).headers.get('location'), '/boutique');
  assert.notEqual((await get(ctx.base, '/api/export.csv', cookie)).status, 200);
  assert.equal((await get(ctx.base, '/boutique')).headers.get('location'), '/login');
  // l'accueil a aussi accès à la boutique
  const admin = await loginAs(ctx.base, 'accueil');
  assert.equal(admin.res.headers.get('location'), '/accueil');
  assert.equal((await get(ctx.base, '/boutique', admin.cookie)).status, 200);
});

test('sans BOUTIQUE_PASSWORD (ou identique à l’accueil), pas de rôle boutique distinct', async (t) => {
  const none = await start();
  t.after(() => none.close());
  assert.equal((await loginAs(none.base, 'boutique')).res.headers.get('location'), '/login?error=1');
  const same = await start({ boutiquePassword: 'accueil' });
  t.after(() => same.close());
  assert.equal((await loginAs(same.base, 'accueil')).res.headers.get('location'), '/accueil');
});

test('socket boutique : état boutique, seules la recherche et la remise sont permises', async (t) => {
  const ctx = await start({ boutiquePassword: 'boutique' });
  t.after(() => ctx.close());
  const { lobby } = ctx.instance;
  const { participantIds } = lobby.register([player('Ana'), player('Bob')]);
  lobby.releaseMatch(lobby.getAdminState().tables[0].slots.A.matchId, { withGoodies: true });

  const { cookie } = await loginAs(ctx.base, 'boutique');
  const shop = await ctx.socket(cookie);
  assert.deepEqual(shop.session, { admin: false, role: 'boutique' });
  assert.equal(shop.state.stats.pending, 2);
  assert.ok(!JSON.stringify(shop.state).includes('@'));

  const found = await act(shop.s, 'boutiqueSearch', { query: 'Ana' });
  assert.equal(found.ok, true);
  assert.equal(found.result[0].id, participantIds[0]);

  for (const type of ['register', 'search', 'newDay', 'releaseMatch', 'setPlacementsPaused']) {
    const r = await act(shop.s, type, {});
    assert.equal(r.code, 'forbidden', type);
  }

  const admin = await ctx.socket((await loginAs(ctx.base, 'accueil')).cookie);
  const given = await act(shop.s, 'giveGoodies', { participantId: participantIds[0] });
  assert.equal(given.ok, true);
  const again = await act(shop.s, 'giveGoodies', { participantId: participantIds[0] });
  assert.equal(again.code, 'already_given');
  // l'accueil et la boutique reçoivent chacun leur état mis à jour
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(shop.states.at(-1).stats.pending, 1);
  const adminGoodies = admin.states.at(-1).goodies.find((g) => g.id === participantIds[0]);
  assert.ok(adminGoodies.goodiesGivenAt);
});
