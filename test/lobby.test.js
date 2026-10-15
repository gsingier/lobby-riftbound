'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { Lobby, displayName, normalizeTicket } = require('../server/lobby');

const HOUR = 60 * 60 * 1000;

function setup() {
  const clock = { t: Date.UTC(2026, 9, 28, 8, 0, 0) };
  const db = openDb(':memory:');
  const lobby = new Lobby(db, { now: () => clock.t });
  let n = 0;
  const player = (first) => ({
    firstName: first || `Joueur${++n}`,
    lastName: `Nom${first ? ++n : n}`,
    email: `j${n}@exemple.fr`,
    ticket: `T-${1000 + n}`,
  });
  return { clock, db, lobby, player };
}

function activeMatches(lobby) {
  return lobby.getAdminState().tables.flatMap((t) =>
    ['A', 'B']
      .filter((s) => t.slots[s])
      .map((s) => ({ table: t.no, slot: s, names: t.slots[s].players.map((p) => p.firstName) })),
  );
}

test('une paire inscrite est placée immédiatement sur la table 1 A', () => {
  const { lobby, player } = setup();
  const res = lobby.register([player('Ana'), player('Bob')]);
  assert.equal(res.status, 'playing');
  assert.deepEqual(activeMatches(lobby), [{ table: 1, slot: 'A', names: ['Ana', 'Bob'] }]);
});

test('les tables entièrement libres sont remplies avant les demi-tables', () => {
  const { lobby, player } = setup();
  for (let i = 0; i < 10; i++) lobby.register([player(), player()]);
  const placed = activeMatches(lobby).map((m) => `${m.table}${m.slot}`);
  assert.deepEqual(placed.sort(), ['1A', '1B', '2A', '3A', '4A', '5A', '6A', '7A', '8A', '9A'].sort());
  // ordre de placement : 1A..9A puis 1B
  const state = lobby.getAdminState();
  assert.ok(state.tables[0].slots.B.startedAt >= state.tables[8].slots.A.startedAt);
});

test('au-delà de 18 matchs, les paires attendent', () => {
  const { lobby, player } = setup();
  for (let i = 0; i < 20; i++) lobby.register([player(), player()]);
  const state = lobby.getAdminState();
  assert.equal(activeMatches(lobby).length, 18);
  assert.equal(state.queue.length, 2);
  assert.equal(state.queue[0].rank, 1);
});

test('un joueur seul attend un partenaire, les paires derrière lui passent devant', () => {
  const { lobby, player } = setup();
  for (let i = 0; i < 18; i++) lobby.register([player(), player()]);
  lobby.register([player('Solo')]);
  lobby.register([player('P1'), player('P2')]);
  let state = lobby.getAdminState();
  assert.equal(state.queue[0].kind, 'solo');
  assert.equal(state.queue[0].ready, false);
  // libère un emplacement : la paire derrière le joueur seul est placée
  lobby.releaseMatch(state.tables[0].slots.A.matchId);
  state = lobby.getAdminState();
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].players[0].firstName, 'Solo');
  assert.deepEqual(state.tables[0].slots.A.players.map((p) => p.firstName), ['P1', 'P2']);
});

test('deux joueurs seuls sont associés, le second remonte à la place du premier', () => {
  const { lobby, player } = setup();
  for (let i = 0; i < 18; i++) lobby.register([player(), player()]);
  lobby.register([player('Solo1')]);
  lobby.register([player('A1'), player('A2')]);
  lobby.register([player('B1'), player('B2')]);
  lobby.register([player('Solo2')]);
  const state = lobby.getAdminState();
  assert.equal(state.queue.length, 3);
  assert.equal(state.queue[0].kind, 'pair');
  assert.deepEqual(state.queue[0].players.map((p) => p.firstName), ['Solo1', 'Solo2']);
  assert.deepEqual(state.queue[1].players.map((p) => p.firstName), ['A1', 'A2']);
});

test('deux joueurs seuls arrivant quand des tables sont libres sont placés ensemble', () => {
  const { lobby, player } = setup();
  const first = lobby.register([player('Solo1')]);
  assert.equal(first.status, 'waiting');
  assert.equal(activeMatches(lobby).length, 0);
  lobby.register([player('Solo2')]);
  assert.deepEqual(activeMatches(lobby), [{ table: 1, slot: 'A', names: ['Solo1', 'Solo2'] }]);
});

test('« placer quand même » installe un joueur seul face à un animateur', () => {
  const { lobby, player } = setup();
  const { entryId } = lobby.register([player('Solo')]);
  const res = lobby.placeAnyway(entryId);
  assert.equal(res.placed, true);
  const slot = lobby.getAdminState().tables[0].slots.A;
  assert.equal(slot.vsAnimator, true);
  assert.equal(slot.players.length, 1);
});

test('« placer quand même » sans place libre : le joueur seul devient prêt à son rang', () => {
  const { lobby, player } = setup();
  for (let i = 0; i < 18; i++) lobby.register([player(), player()]);
  const { entryId } = lobby.register([player('Solo')]);
  lobby.register([player('P1'), player('P2')]);
  assert.equal(lobby.placeAnyway(entryId).placed, false);
  const state = lobby.getAdminState();
  assert.equal(state.queue[0].ready, true);
  lobby.releaseMatch(state.tables[4].slots.B.matchId);
  const after = lobby.getAdminState();
  assert.deepEqual(after.tables[4].slots.B.players.map((p) => p.firstName), ['Solo']);
  assert.equal(after.tables[4].slots.B.vsAnimator, true);
});

test('un joueur seul « prêt » est associé si un autre joueur seul arrive avant une place', () => {
  const { lobby, player } = setup();
  for (let i = 0; i < 18; i++) lobby.register([player(), player()]);
  const { entryId } = lobby.register([player('Solo1')]);
  lobby.placeAnyway(entryId);
  lobby.register([player('Solo2')]);
  const q = lobby.getAdminState().queue;
  assert.equal(q.length, 1);
  assert.equal(q[0].kind, 'pair');
  assert.equal(q[0].vsAnimator, false);
});

test('fin du timer : partie terminée, goodies dus, joueurs suivants placés', () => {
  const { lobby, player, clock } = setup();
  for (let i = 0; i < 19; i++) lobby.register([player(), player()]);
  const firstMatch = lobby.getAdminState().tables[0].slots.A;
  clock.t += HOUR - 1;
  assert.equal(lobby.tick(), false);
  clock.t += 1;
  assert.equal(lobby.tick(), true);
  const state = lobby.getAdminState();
  assert.equal(state.queue.length, 0);
  assert.notEqual(state.tables[0].slots.A.matchId, firstMatch.matchId);
  // les 18 premières parties ont démarré en même temps : 36 joueurs ont droit aux goodies
  assert.equal(state.goodies.length, 36);
  assert.ok(state.goodies.every((g) => g.goodiesGivenAt === null));
  lobby.giveGoodies(state.goodies[0].id);
  assert.equal(lobby.getAdminState().stats.goodiesPending, 35);
});

test('« libérer l’emplacement » : pas de goodies', () => {
  const { lobby, player } = setup();
  const { participantIds, matchId } = lobby.register([player(), player()]);
  lobby.releaseMatch(matchId);
  assert.equal(lobby.getAdminState().goodies.length, 0);
  assert.throws(() => lobby.giveGoodies(participantIds[0]), /pas de goodies/);
});

test('un email ou un billet déjà utilisé est refusé, même un autre jour', () => {
  const { lobby, player } = setup();
  const p = player('Ana');
  lobby.register([p, player()]);
  assert.throws(() => lobby.register([{ ...player(), email: `  ${p.email.toUpperCase()} ` }]), (e) => e.code === 'email_used');
  lobby.newDay();
  assert.throws(() => lobby.register([{ ...player(), ticket: p.ticket.toLowerCase().replace('-', ' ') }]), (e) => e.code === 'ticket_used');
});

test('un joueur retiré pour absence peut se réinscrire', () => {
  const { lobby, player } = setup();
  const p = player('Absent');
  const { participantIds } = lobby.register([p]);
  lobby.removeParticipant(participantIds[0]);
  assert.doesNotThrow(() => lobby.register([p]));
});

test('un joueur parti avant la fin reste bloqué', () => {
  const { lobby, player } = setup();
  const p = player('Pressé');
  const { matchId } = lobby.register([p, player()]);
  lobby.releaseMatch(matchId);
  assert.throws(() => lobby.register([p]), (e) => e.code === 'email_used');
});

test('retirer un membre d’une paire : le partenaire redevient seul à la même place', () => {
  const { lobby, player } = setup();
  for (let i = 0; i < 18; i++) lobby.register([player(), player()]);
  const { participantIds } = lobby.register([player('A'), player('B')]);
  lobby.register([player('C'), player('D')]);
  lobby.removeParticipant(participantIds[0]);
  const q = lobby.getAdminState().queue;
  assert.equal(q[0].kind, 'solo');
  assert.equal(q[0].players[0].firstName, 'B');
  assert.equal(q[1].kind, 'pair');
});

test('nouvelle journée : la file est vidée, les participants restent en base', () => {
  const { lobby, player } = setup();
  for (let i = 0; i < 19; i++) lobby.register([player(), player()]);
  const res = lobby.newDay();
  assert.equal(res.expiredParticipants, 2);
  assert.equal(res.interruptedMatches, 18);
  const state = lobby.getAdminState();
  assert.equal(state.day.number, 2);
  assert.equal(state.queue.length, 0);
  assert.equal(activeMatches(lobby).length, 0);
  assert.equal(lobby.exportRows().length, 38);
});

test('une table hors service ne reçoit plus de joueurs', () => {
  const { lobby, player } = setup();
  lobby.setTableEnabled(1, false);
  lobby.register([player(), player()]);
  assert.deepEqual(activeMatches(lobby).map((m) => m.table), [2]);
});

test('la durée réglée s’applique aux nouvelles parties', () => {
  const { lobby, player, clock } = setup();
  lobby.setDuration(30 * 60 * 1000);
  const { matchId } = lobby.register([player(), player()]);
  const slot = lobby.getAdminState().tables[0].slots.A;
  assert.equal(slot.matchId, matchId);
  assert.equal(slot.endsAt - clock.t, 30 * 60 * 1000);
});

test('ajuster le temps d’une partie', () => {
  const { lobby, player, clock } = setup();
  const { matchId } = lobby.register([player(), player()]);
  lobby.adjustMatch(matchId, 5 * 60 * 1000);
  assert.equal(lobby.getAdminState().tables[0].slots.A.endsAt, clock.t + HOUR + 5 * 60 * 1000);
  lobby.adjustMatch(matchId, -2 * HOUR);
  assert.equal(lobby.getAdminState().tables[0].slots.A, null);
  assert.equal(lobby.getAdminState().goodies.length, 2);
});

test('l’état public ne contient ni email ni billet', () => {
  const { lobby, player } = setup();
  lobby.register([player('Ana'), player('Bob')]);
  lobby.register([player('Solo')]);
  const json = JSON.stringify(lobby.getPublicState());
  assert.ok(!json.includes('@'));
  assert.ok(!json.includes('T-'));
  assert.ok(json.includes('Ana N.'));
});

test('helpers de normalisation et d’affichage', () => {
  assert.equal(displayName('  lucas ', 'martin'), 'lucas M.');
  assert.equal(displayName('Éloïse', 'école'), 'Éloïse É.');
  assert.equal(normalizeTicket(' ab-12 34.5_6 '), 'AB123456');
});

test('l’initiale affichée est la première lettre du nom', () => {
  assert.equal(displayName('Zélie', '<b>Quartz</b>'), 'Zélie B.');
  assert.equal(displayName('Jean', "d'Artagnan"), 'Jean D.');
  assert.equal(displayName('Ana', '123'), 'Ana 1.');
});
