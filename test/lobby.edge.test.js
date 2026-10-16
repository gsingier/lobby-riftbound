'use strict';

// Cas limites du moteur (server/lobby.js), horloge injectée.

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { Lobby, LobbyError, displayName, normalizeEmail, normalizeTicket } = require('../server/lobby');

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

function setup() {
  const clock = { t: Date.UTC(2026, 9, 28, 8, 0, 0) };
  const db = openDb(':memory:');
  const lobby = new Lobby(db, { now: () => clock.t });
  let n = 0;
  const player = (firstName, extra = {}) => {
    n += 1;
    return {
      firstName: firstName || `Joueur${n}`,
      lastName: `Nom${n}`,
      email: `j${n}@exemple.fr`,
      ticket: `T-${1000 + n}`,
      ...extra,
    };
  };
  const state = () => lobby.getAdminState();
  const slot = (tableNo, s) => state().tables[tableNo - 1].slots[s];
  const firstNames = (unit) => unit.players.map((p) => p.firstName);
  const queue = () => state().queue.map((e) => firstNames(e).join('+'));
  // Remplit les 18 emplacements avec des paires anonymes.
  const fillTables = (count = 18) => {
    const regs = [];
    for (let i = 0; i < count; i++) regs.push(lobby.register([player(), player()]));
    return regs;
  };
  const occupied = () =>
    state().tables.flatMap((t) => ['A', 'B'].filter((s) => t.slots[s]).map((s) => `${t.no}${s}`));
  return { clock, db, lobby, player, state, slot, firstNames, queue, fillTables, occupied };
}

const code = (expected) => (err) => {
  assert.ok(err instanceof LobbyError, `LobbyError attendu, reçu ${err && err.constructor && err.constructor.name}: ${err && err.message}`);
  assert.equal(err.code, expected);
  return true;
};

// ---------------------------------------------------------------- joueurs seuls

test('trois joueurs seuls d’affilée : les deux premiers jouent ensemble, le troisième attend', () => {
  const { lobby, player, state, slot, firstNames } = setup();
  const s1 = lobby.register([player('S1')]);
  assert.equal(s1.status, 'waiting');
  assert.equal(s1.rank, 1);
  const s2 = lobby.register([player('S2')]);
  assert.equal(s2.status, 'playing');
  assert.deepEqual(firstNames(slot(1, 'A')), ['S1', 'S2']);
  assert.equal(slot(1, 'A').vsAnimator, false);
  const s3 = lobby.register([player('S3')]);
  assert.equal(s3.status, 'waiting');
  const st = state();
  assert.equal(st.queue.length, 1);
  assert.equal(st.queue[0].kind, 'solo');
  assert.equal(st.queue[0].ready, false);
  assert.equal(st.queue[0].vsAnimator, false);
  assert.equal(st.stats.waiting, 1);
  assert.equal(st.stats.playing, 2);
  // le joueur seul n'occupe pas de table tant qu'il n'est pas prêt
  assert.equal(slot(2, 'A'), null);
});

test('trois joueurs seuls d’affilée, tables pleines : une paire formée + un joueur seul', () => {
  const { lobby, player, fillTables, queue, state } = setup();
  fillTables();
  lobby.register([player('S1')]);
  lobby.register([player('S2')]);
  lobby.register([player('S3')]);
  assert.deepEqual(queue(), ['S1+S2', 'S3']);
  assert.deepEqual(state().queue.map((e) => [e.rank, e.kind, e.ready]), [[1, 'pair', true], [2, 'solo', false]]);
});

test('joueur seul « prêt » toujours seul quand une place se libère : il joue contre un animateur', () => {
  const { lobby, player, fillTables, slot, firstNames, queue } = setup();
  const regs = fillTables();
  const { entryId, participantIds } = lobby.register([player('Solo')]);
  lobby.register([player('P1'), player('P2')]);
  assert.equal(lobby.placeAnyway(entryId).placed, false);
  // le joueur seul prêt est devant la paire : il passe en premier
  lobby.releaseMatch(regs[4].matchId); // 5A
  assert.deepEqual(firstNames(slot(5, 'A')), ['Solo']);
  assert.equal(slot(5, 'A').vsAnimator, true);
  assert.deepEqual(queue(), ['P1+P2']);
  const row = lobby.exportRows().find((r) => r.id === participantIds[0]);
  assert.equal(row.vsAnimator, true);
  assert.equal(row.tableNo, 5);
});

test('« placer quand même » puis annulation : le joueur seul redevient non prêt et est sauté', () => {
  const { lobby, player, fillTables, slot, firstNames, queue, state } = setup();
  const regs = fillTables();
  const { entryId } = lobby.register([player('Solo')]);
  lobby.register([player('P1'), player('P2')]);
  lobby.placeAnyway(entryId);
  assert.equal(state().queue[0].ready, true);
  lobby.cancelPlaceAnyway(entryId);
  assert.equal(state().queue[0].ready, false);
  lobby.releaseMatch(regs[0].matchId);
  assert.deepEqual(firstNames(slot(1, 'A')), ['P1', 'P2']);
  assert.deepEqual(queue(), ['Solo']);
  assert.equal(state().queue[0].rank, 1);
});

test('placeAnyway / cancelPlaceAnyway : refusés sur une paire ou une entrée qui joue', () => {
  const { lobby, player, fillTables } = setup();
  fillTables();
  const pair = lobby.register([player(), player()]);
  assert.throws(() => lobby.placeAnyway(pair.entryId), code('conflict'));
  assert.throws(() => lobby.cancelPlaceAnyway(pair.entryId), code('conflict'));
  const { lobby: l2, player: p2 } = setup();
  const playing = l2.register([p2(), p2()]);
  assert.throws(() => l2.placeAnyway(playing.entryId), code('not_found'));
  assert.throws(() => l2.placeAnyway(99999), code('not_found'));
});

// ---------------------------------------------------------------- retirer

test('retirer les deux membres d’une paire : l’entrée disparaît, la paire suivante prend le rang 1', () => {
  const { lobby, player, fillTables, queue, state, slot, firstNames } = setup();
  const regs = fillTables();
  const ab = lobby.register([player('A'), player('B')]);
  lobby.register([player('C'), player('D')]);
  lobby.removeParticipant(ab.participantIds[0]);
  assert.deepEqual(queue(), ['B', 'C+D']);
  lobby.removeParticipant(ab.participantIds[1]);
  assert.deepEqual(queue(), ['C+D']);
  assert.equal(state().queue[0].rank, 1);
  assert.equal(lobby.whereIs(ab.participantIds[0]).status, 'removed');
  assert.equal(lobby.whereIs(ab.participantIds[1]).status, 'removed');
  lobby.releaseMatch(regs[0].matchId);
  assert.deepEqual(firstNames(slot(1, 'A')), ['C', 'D']);
  assert.equal(state().queue.length, 0);
  // les deux absents peuvent se réinscrire
  assert.doesNotThrow(() => lobby.register([
    { firstName: 'A', lastName: 'X', email: 'j37@exemple.fr', ticket: 'T-1037' },
    { firstName: 'B', lastName: 'X', email: 'j38@exemple.fr', ticket: 'T-1038' },
  ]));
});

test('retirer un membre d’une paire : le partenaire est associé au joueur seul suivant, à sa place', () => {
  const { lobby, player, fillTables, queue } = setup();
  fillTables();
  const ab = lobby.register([player('A'), player('B')]);
  lobby.register([player('C'), player('D')]);
  lobby.register([player('S')]);
  assert.deepEqual(queue(), ['A+B', 'C+D', 'S']);
  lobby.removeParticipant(ab.participantIds[0]);
  assert.deepEqual(queue(), ['B+S', 'C+D']);
});

test('retirer : refusé pour un joueur qui joue, qui a fini, déjà retiré ou inconnu', () => {
  const { lobby, player, clock } = setup();
  const reg = lobby.register([player(), player()]);
  assert.throws(() => lobby.removeParticipant(reg.participantIds[0]), code('conflict'));
  clock.t += HOUR;
  lobby.tick();
  assert.throws(() => lobby.removeParticipant(reg.participantIds[0]), code('conflict'));
  const solo = lobby.register([player()]);
  lobby.removeParticipant(solo.participantIds[0]);
  assert.throws(() => lobby.removeParticipant(solo.participantIds[0]), code('conflict'));
  assert.throws(() => lobby.removeParticipant(424242), code('not_found'));
  // le joueur qui joue est toujours à sa table
  assert.equal(lobby.whereIs(reg.participantIds[1]).status, 'completed');
});

// ---------------------------------------------------------------- fin de partie

test('libérer deux fois la même partie : la seconde est refusée', () => {
  const { lobby, player } = setup();
  const { matchId } = lobby.register([player(), player()]);
  assert.deepEqual(lobby.releaseMatch(matchId), { released: matchId, withGoodies: false });
  assert.throws(() => lobby.releaseMatch(matchId), code('conflict'));
  assert.throws(() => lobby.releaseMatch(123456), code('not_found'));
});

test('ajuster le temps d’une partie terminée ou libérée : refusé ; ajustements invalides', () => {
  const { lobby, player, clock } = setup();
  const a = lobby.register([player(), player()]);
  const b = lobby.register([player(), player()]);
  lobby.releaseMatch(a.matchId);
  assert.throws(() => lobby.adjustMatch(a.matchId, 5 * MIN), code('conflict'));
  for (const bad of [0, NaN, 'abc', null, undefined, Infinity, 2 * HOUR + 1, -2 * HOUR - 1]) {
    assert.throws(() => lobby.adjustMatch(b.matchId, bad), code('invalid'), `delta ${bad}`);
  }
  clock.t += HOUR;
  lobby.tick();
  assert.throws(() => lobby.adjustMatch(b.matchId, 5 * MIN), code('conflict'));
});

test('timer écoulé mais tick pas encore passé : « Libérer » ne fait pas perdre les goodies', () => {
  const { lobby, player, clock, state } = setup();
  const { matchId, participantIds } = lobby.register([player(), player()]);
  clock.t += HOUR + 200; // le tick (toutes les secondes) n'a pas encore tourné
  lobby.releaseMatch(matchId);
  assert.equal(lobby.whereIs(participantIds[0]).status, 'completed');
  assert.equal(state().goodies.length, 2);
  assert.doesNotThrow(() => lobby.giveGoodies(participantIds[0]));
});

test('timer écoulé mais tick pas encore passé : « Nouvelle journée » compte la partie comme terminée', () => {
  const { lobby, player, clock } = setup();
  const done = lobby.register([player(), player()]);
  clock.t += 30 * MIN;
  const running = lobby.register([player(), player()]);
  clock.t += 30 * MIN + 100; // la première partie est arrivée au bout de son heure
  const res = lobby.newDay();
  assert.equal(res.interruptedMatches, 1);
  assert.equal(lobby.whereIs(done.participantIds[0]).status, 'completed');
  assert.equal(lobby.whereIs(running.participantIds[0]).status, 'interrupted');
});

test('fin de partie : le même tick ne termine pas deux fois, le suivant ne change rien', () => {
  const { lobby, player, clock } = setup();
  lobby.register([player(), player()]);
  clock.t += HOUR;
  assert.equal(lobby.tick(), true);
  assert.equal(lobby.tick(), false);
});

// ---------------------------------------------------------------- modification

test('editParticipant : email d’un autre refusé, son propre email (autre casse) accepté', () => {
  const { lobby, player, state } = setup();
  const a = lobby.register([player('Ana'), player('Bob')]);
  const [anaId, bobId] = a.participantIds;
  const bobEmail = state().tables[0].slots.A.players[1].email;
  assert.throws(
    () => lobby.editParticipant(anaId, { email: bobEmail.toUpperCase() }),
    (err) => code('email_used')(err) && err.details.field === 'email' && err.details.conflict.participantId === bobId,
  );
  assert.throws(() => lobby.editParticipant(anaId, { ticket: 't 1002' }), code('ticket_used'));
  assert.doesNotThrow(() => lobby.editParticipant(anaId, { email: '  J1@EXEMPLE.FR ', firstName: '  Ana   Maria ' }));
  const ana = state().tables[0].slots.A.players[0];
  assert.equal(ana.firstName, 'Ana Maria');
  assert.equal(ana.email, 'J1@EXEMPLE.FR');
  assert.equal(ana.displayName, 'Ana Maria N.');
  assert.throws(() => lobby.editParticipant(anaId, { email: 'pas-un-email' }), (e) => code('invalid')(e) && e.details.field === 'email');
  assert.throws(() => lobby.editParticipant(anaId, { lastName: '   ' }), (e) => code('invalid')(e) && e.details.field === 'lastName');
  assert.throws(() => lobby.editParticipant(999, { firstName: 'X' }), code('not_found'));
  // les doublons restent détectés avec le nouvel email
  assert.equal(lobby.check({ email: 'j1@exemple.fr' }).email.participantId, anaId);
  assert.equal(lobby.check({ email: 'j1@exemple.fr', excludeParticipantId: anaId }).email, null);
});

test('editParticipant sur un joueur retiré dont l’email a été réutilisé : pas d’erreur SQLite', () => {
  const { lobby, player } = setup();
  const p = player('Absent');
  const first = lobby.register([p]);
  lobby.removeParticipant(first.participantIds[0]);
  const second = lobby.register([{ ...p, firstName: 'Revenu' }]);
  // modifier l'ancienne fiche (retirée) ne viole pas l'index unique
  assert.doesNotThrow(() => lobby.editParticipant(first.participantIds[0], { firstName: 'Corrigé' }));
  assert.doesNotThrow(() => lobby.editParticipant(first.participantIds[0], { email: p.email.toUpperCase(), ticket: p.ticket }));
  // la nouvelle fiche peut toujours être modifiée avec son email
  assert.doesNotThrow(() => lobby.editParticipant(second.participantIds[0], { email: p.email, lastName: 'Nouveau' }));
  assert.equal(lobby.check({ email: p.email }).email.participantId, second.participantIds[0]);
});

test('réinscription d’un joueur retiré, puis 3e usage du même email ou billet : refusé', () => {
  const { lobby, player } = setup();
  const p = player('Ana');
  const first = lobby.register([p]);
  lobby.removeParticipant(first.participantIds[0]);
  const second = lobby.register([{ ...p, ticket: ` ${p.ticket.toLowerCase()} ` }]);
  assert.throws(
    () => lobby.register([{ ...player(), email: p.email }]),
    (e) => code('email_used')(e) && e.details.conflict.participantId === second.participantIds[0] && e.details.index === 0,
  );
  assert.throws(
    () => lobby.register([player(), { ...player(), ticket: p.ticket.replace('-', '') }]),
    (e) => code('ticket_used')(e) && e.details.index === 1,
  );
});

test('inscription refusée : rien n’est enregistré (pas d’inscription partielle)', () => {
  const { lobby, player } = setup();
  const p = player();
  lobby.register([p]);
  const before = lobby.exportRows().length;
  assert.throws(() => lobby.register([player(), { ...player(), email: p.email }]), code('email_used'));
  assert.equal(lobby.exportRows().length, before);
  assert.equal(lobby.getAdminState().queue.length, 1);
});

test('inscription : validations (nombre de joueurs, doublons internes, champs)', () => {
  const { lobby, player } = setup();
  for (const bad of [undefined, null, [], 'x', [player(), player(), player()]]) {
    assert.throws(() => lobby.register(bad), code('invalid'));
  }
  const a = player();
  assert.throws(() => lobby.register([a, { ...player(), email: ` ${a.email.toUpperCase()}` }]), (e) => code('invalid')(e) && e.details.field === 'email' && e.details.index === 1);
  assert.throws(() => lobby.register([a, { ...player(), ticket: a.ticket.replace('-', '.') }]), (e) => code('invalid')(e) && e.details.field === 'ticket');
  assert.throws(() => lobby.register([player(), { ...player(), email: 'a b@c.fr' }]), (e) => code('invalid')(e) && e.details.index === 1);
  assert.throws(() => lobby.register([{ ...player(), ticket: ' - . _ ' }]), (e) => code('invalid')(e) && e.details.field === 'ticket');
  assert.throws(() => lobby.register([{ ...player(), firstName: 'x'.repeat(61) }]), (e) => code('invalid')(e) && e.details.field === 'firstName');
  assert.throws(() => lobby.register(['pas un joueur']), code('invalid'));
});

// ---------------------------------------------------------------- tables

test('toutes les tables hors service puis réactivation : placement immédiat', () => {
  const { lobby, player, state, occupied, queue, firstNames, slot } = setup();
  for (let no = 1; no <= 9; no++) lobby.setTableEnabled(no, false);
  lobby.register([player('A1'), player('A2')]);
  lobby.register([player('B1'), player('B2')]);
  lobby.register([player('C1'), player('C2')]);
  assert.deepEqual(occupied(), []);
  assert.equal(state().queue.length, 3);
  assert.ok(state().queue.every((e) => e.ready));
  assert.deepEqual(lobby.getPublicState().settings.disabledTables, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  lobby.setTableEnabled(5, true);
  assert.deepEqual(firstNames(slot(5, 'A')), ['A1', 'A2']);
  assert.deepEqual(firstNames(slot(5, 'B')), ['B1', 'B2']);
  assert.deepEqual(queue(), ['C1+C2']);
  lobby.setTableEnabled(2, true);
  assert.deepEqual(occupied(), ['2A', '5A', '5B']);
  assert.deepEqual(state().settings.disabledTables, [1, 3, 4, 6, 7, 8, 9]);
  for (const bad of [0, 10, 'x', 1.5, null]) assert.throws(() => lobby.setTableEnabled(bad, true), code('invalid'));
});

test('table hors service occupée : la partie continue, aucun nouveau placement', () => {
  const { lobby, player, fillTables, state, slot, queue } = setup();
  const regs = fillTables();
  lobby.register([player('Q1'), player('Q2')]);
  lobby.setTableEnabled(4, false);
  const t4 = state().tables[3];
  assert.equal(t4.enabled, false);
  assert.ok(t4.slots.A && t4.slots.B, 'les parties en cours restent affichées');
  lobby.releaseMatch(regs[3].matchId); // 4A
  assert.equal(slot(4, 'A'), null);
  assert.deepEqual(queue(), ['Q1+Q2']);
  // fin du timer sur la table hors service : goodies dus mais pas de nouveau placement
  lobby.adjustMatch(regs[12].matchId, -HOUR); // 4B (2e tour de placement : 9 + 4)
  assert.equal(slot(4, 'B'), null);
  assert.equal(state().goodies.length, 2);
  assert.deepEqual(queue(), ['Q1+Q2']);
  lobby.releaseMatch(regs[6].matchId); // 7A
  assert.deepEqual(slot(7, 'A').players.map((p) => p.firstName), ['Q1', 'Q2']);
});

test('18 matchs puis plusieurs emplacements libérés en même temps : tables vides d’abord', () => {
  const { lobby, player, fillTables, clock, firstNames, slot, queue } = setup();
  const regs = fillTables(); // regs[0..8] = 1A..9A, regs[9..17] = 1B..9B
  const ms = (tableNo, s) => regs[(s === 'A' ? 0 : 9) + tableNo - 1].matchId;
  for (const m of [ms(2, 'A'), ms(5, 'A'), ms(5, 'B')]) lobby.adjustMatch(m, -30 * MIN);
  lobby.register([player('Q1'), player('Q2')]);
  lobby.register([player('R1'), player('R2')]);
  lobby.register([player('S1'), player('S2')]);
  lobby.register([player('T1'), player('T2')]);
  clock.t += 30 * MIN;
  assert.equal(lobby.tick(), true);
  assert.deepEqual(firstNames(slot(5, 'A')), ['Q1', 'Q2']); // table entièrement libre
  assert.deepEqual(firstNames(slot(2, 'A')), ['R1', 'R2']); // puis demi-tables, plus petit numéro
  assert.deepEqual(firstNames(slot(5, 'B')), ['S1', 'S2']);
  assert.deepEqual(queue(), ['T1+T2']);
});

test('une table entièrement libre passe avant une demi-table de plus petit numéro', () => {
  const { lobby, player, fillTables, firstNames, slot, occupied } = setup();
  const regs = fillTables(); // regs[0..8] = 1A..9A, regs[9..17] = 1B..9B
  // personne n'attend : les emplacements restent libres
  lobby.releaseMatch(regs[1].matchId); // 2A (demi-table)
  lobby.releaseMatch(regs[6].matchId); // 7A
  lobby.releaseMatch(regs[15].matchId); // 7B → table 7 entièrement libre
  assert.equal(occupied().length, 15);
  lobby.register([player('X1'), player('X2')]);
  assert.deepEqual(firstNames(slot(7, 'A')), ['X1', 'X2']);
  assert.equal(slot(2, 'A'), null);
  lobby.register([player('Y1'), player('Y2')]);
  assert.deepEqual(firstNames(slot(2, 'A')), ['Y1', 'Y2']); // demi-tables : plus petit numéro d'abord
  lobby.register([player('Z1'), player('Z2')]);
  assert.deepEqual(firstNames(slot(7, 'B')), ['Z1', 'Z2']);
});

// ---------------------------------------------------------------- durée

test('durée invalide refusée, la durée précédente est conservée', () => {
  const { lobby, player, clock, slot } = setup();
  for (const bad of [0, 59999, 3 * HOUR + 1, 'abc', null, undefined, NaN, Infinity, -HOUR, {}]) {
    assert.throws(() => lobby.setDuration(bad), code('invalid'), `durée ${String(bad)}`);
  }
  assert.equal(lobby.getAdminState().settings.matchDurationMs, HOUR);
  assert.deepEqual(lobby.setDuration('1800000'), { matchDurationMs: 30 * MIN });
  assert.deepEqual(lobby.setDuration(MIN), { matchDurationMs: MIN });
  assert.deepEqual(lobby.setDuration(3 * HOUR), { matchDurationMs: 3 * HOUR });
  const started = clock.t;
  lobby.register([player(), player()]);
  lobby.setDuration(20 * MIN);
  assert.equal(slot(1, 'A').endsAt, started + 3 * HOUR, 'la partie en cours garde sa durée');
});

// ---------------------------------------------------------------- normalisation

test('normalisation billet / email : espaces, casse, tirets, points, underscores', () => {
  assert.equal(normalizeEmail('  Jean.Dupont@Exemple.FR \t'), 'jean.dupont@exemple.fr');
  assert.equal(normalizeTicket(' pgw-12 34.5_6 '), 'PGW123456');
  assert.equal(normalizeTicket('PGW 123–456'), 'PGW123456'); // espace insécable, tiret demi-cadratin
  assert.equal(normalizeTicket('PGW—123‑456'), 'PGW123456'); // tiret cadratin, trait d'union insécable
  const { lobby, player } = setup();
  lobby.register([{ ...player(), email: '  Jean.Dupont@Exemple.FR ', ticket: ' pgw-12 34.5_6 ' }]);
  assert.throws(() => lobby.register([{ ...player(), email: 'jean.dupont@exemple.fr' }]), code('email_used'));
  assert.throws(() => lobby.register([{ ...player(), ticket: 'PGW123456' }]), code('ticket_used'));
  assert.throws(() => lobby.register([{ ...player(), ticket: 'pgw–123–456' }]), code('ticket_used'));
  const res = lobby.check({ email: 'JEAN.DUPONT@exemple.fr ', ticket: 'p.g.w 1234 56' });
  assert.ok(res.email && res.ticket);
  assert.deepEqual(lobby.check({ email: '', ticket: '' }), { email: null, ticket: null });
  assert.deepEqual(lobby.check(), { email: null, ticket: null });
});

test('noms avec espaces multiples, tabulations, accents décomposés, emoji', () => {
  const { lobby, player, state } = setup();
  lobby.register([{ ...player(), firstName: '  Jean \t  Pierre ', lastName: '  de   La\nFontaine ' }]);
  const p = state().queue[0].players[0];
  assert.equal(p.firstName, 'Jean Pierre');
  assert.equal(p.lastName, 'de La Fontaine');
  assert.equal(p.displayName, 'Jean Pierre D.');
  assert.equal(displayName('Lucas', '  martin '), 'Lucas M.');
  assert.equal(displayName('Lucas', ''), 'Lucas');
  assert.equal(displayName('Émilie', 'école'), 'Émilie É.'); // NFD → NFC
  assert.equal(displayName('Zoé', '\u{1D49C}bc'), 'Zoé \u{1D49C}.'); // pas de demi-caractère
  assert.throws(() => lobby.register([{ ...player(), firstName: ' \t ' }]), code('invalid'));
});

// ---------------------------------------------------------------- recherche

test('recherche : insensible à la casse et aux accents (é/É), ordre prénom/nom', () => {
  const { lobby, player } = setup();
  lobby.register([{ ...player(), firstName: 'Émilie', lastName: 'Durand' }]);
  lobby.register([{ ...player(), firstName: 'Zoé', lastName: 'Lefèvre' }]);
  const found = (q) => lobby.search(q).map((r) => r.firstName);
  for (const q of ['Émilie', 'émilie', 'ÉMILIE', 'emilie', 'Emi', 'durand émilie', 'émilie   durand']) {
    assert.deepEqual(found(q), ['Émilie'], `recherche « ${q} »`);
  }
  assert.deepEqual(found('zoe'), ['Zoé']);
  assert.deepEqual(found('ZOÉ'), ['Zoé']);
  assert.deepEqual(found('lefevre'), ['Zoé']);
  assert.deepEqual(found('LEFÈVRE zoé'), ['Zoé']);
});

test('recherche : % et _ sont des caractères littéraux ; email, billet, longueur minimale', () => {
  const { lobby, player } = setup();
  lobby.register([{ ...player(), firstName: 'Jo_n', lastName: 'Cent%' }]);
  lobby.register([{ ...player(), firstName: 'Joan', lastName: 'Centaine' }]);
  const found = (q) => lobby.search(q).map((r) => r.firstName).sort();
  assert.deepEqual(found('o_n'), ['Jo_n']);
  assert.deepEqual(found('t%'), ['Jo_n']);
  assert.deepEqual(found('%%'), []);
  assert.deepEqual(found('__'), []);
  assert.deepEqual(found('jo'), ['Jo_n', 'Joan']);
  assert.deepEqual(found('j'), []);
  assert.deepEqual(found('   '), []);
  assert.deepEqual(found(undefined), []);
  assert.deepEqual(found('J2@EXEMPLE'), ['Joan']);
  assert.deepEqual(found('t 1002'), ['Joan']);
  assert.deepEqual(found('t-1001'), ['Jo_n']);
  const r = lobby.search('joan')[0];
  assert.equal(r.status, 'playing'); // les deux joueurs seuls ont été associés et placés
  assert.equal(r.email, 'j2@exemple.fr');
  assert.equal(r.dayNumber, 1);
});

test('recherche : retrouve aussi les joueurs retirés et ceux des jours précédents', () => {
  const { lobby, player } = setup();
  const a = lobby.register([{ ...player(), firstName: 'Ancien' }]);
  lobby.removeParticipant(a.participantIds[0]);
  lobby.newDay();
  lobby.register([{ ...player(), firstName: 'Ancien' }]);
  const rows = lobby.search('ancien');
  assert.deepEqual(rows.map((r) => [r.status, r.dayNumber]), [['waiting', 2], ['removed', 1]]);
});

// ---------------------------------------------------------------- nouvelle journée

test('nouvelle journée avec parties en cours : interrompues, pas de goodies ; terminées la veille : goodies possibles', () => {
  const { lobby, player, clock, state } = setup();
  const done = lobby.register([player('Fini1'), player('Fini2')]);
  clock.t += 30 * MIN;
  const running = lobby.register([player('Cours1'), player('Cours2')]);
  const waiting = lobby.register([player('Attente')]);
  clock.t += 30 * MIN;
  lobby.tick();
  assert.equal(state().goodies.length, 2);
  const res = lobby.newDay();
  assert.equal(res.interruptedMatches, 1);
  assert.equal(res.expiredParticipants, 1);
  assert.equal(res.dayNumber, 2);
  for (const id of running.participantIds) {
    assert.equal(lobby.whereIs(id).status, 'interrupted');
    assert.throws(() => lobby.giveGoodies(id), code('conflict'));
  }
  assert.equal(lobby.whereIs(waiting.participantIds[0]).status, 'expired');
  // la partie terminée la veille donne toujours droit aux goodies
  assert.doesNotThrow(() => lobby.giveGoodies(done.participantIds[0]));
  const st = state();
  assert.equal(st.queue.length, 0);
  assert.ok(st.tables.every((t) => !t.slots.A && !t.slots.B));
  // le joueur expiré peut se réinscrire le lendemain, pas les interrompus
  assert.doesNotThrow(() => lobby.register([{ firstName: 'Attente', lastName: 'Bis', email: 'j5@exemple.fr', ticket: 'T-1005' }]));
});

test('statistiques sur plusieurs jours', () => {
  const { lobby, player, fillTables, clock, state } = setup();
  fillTables(19);
  const solo = lobby.register([player()]);
  lobby.removeParticipant(solo.participantIds[0]);
  assert.deepEqual(state().stats, {
    registeredToday: 38,
    waiting: 2,
    playing: 36,
    completedToday: 0,
    goodiesPending: 0,
    totalParticipants: 38,
  });
  clock.t += HOUR;
  lobby.tick();
  lobby.giveGoodies(state().goodies[0].id);
  assert.deepEqual(state().stats, {
    registeredToday: 38,
    waiting: 0,
    playing: 2,
    completedToday: 36,
    goodiesPending: 35,
    totalParticipants: 38,
  });
  clock.t += 12 * HOUR;
  lobby.newDay(); // la dernière partie est déjà finie (timer écoulé) : comptée comme terminée
  let st = state();
  assert.equal(st.day.number, 2);
  assert.deepEqual(st.stats, {
    registeredToday: 0,
    waiting: 0,
    playing: 0,
    completedToday: 0,
    goodiesPending: 0,
    totalParticipants: 38,
  });
  lobby.register([player(), player()]);
  lobby.register([player()]);
  st = state();
  assert.equal(st.stats.registeredToday, 3);
  assert.equal(st.stats.playing, 2);
  assert.equal(st.stats.waiting, 1);
  assert.equal(st.stats.totalParticipants, 41);
});

// ---------------------------------------------------------------- ordre de la file

test('ordre de la file stable après fusion des joueurs seuls', () => {
  const { lobby, player, fillTables, queue, state, firstNames, slot } = setup();
  const regs = fillTables();
  const s1 = lobby.register([player('S1')]);
  lobby.register([player('P1'), player('P2')]);
  lobby.register([player('Q1'), player('Q2')]);
  const s2 = lobby.register([player('S2')]);
  assert.equal(s2.status, 'waiting');
  assert.equal(s2.rank, 1, 'le second joueur seul remonte à la place du premier');
  assert.equal(s2.entryId, s1.entryId);
  lobby.register([player('S3')]);
  lobby.register([player('R1'), player('R2')]);
  lobby.register([player('S4')]);
  assert.deepEqual(queue(), ['S1+S2', 'P1+P2', 'Q1+Q2', 'S3+S4', 'R1+R2']);
  assert.deepEqual(state().queue.map((e) => e.rank), [1, 2, 3, 4, 5]);
  assert.equal(lobby.whereIs(s2.participantIds[0]).rank, 1);
  lobby.releaseMatch(regs[0].matchId);
  lobby.releaseMatch(regs[1].matchId);
  assert.deepEqual(firstNames(slot(1, 'A')), ['S1', 'S2']);
  assert.deepEqual(firstNames(slot(2, 'A')), ['P1', 'P2']);
  assert.deepEqual(queue(), ['Q1+Q2', 'S3+S4', 'R1+R2']);
});

// ---------------------------------------------------------------- whereIs / goodies / export

test('whereIs : inconnu, en file, à table, terminé', () => {
  const { lobby, player, fillTables, clock } = setup();
  assert.deepEqual(lobby.whereIs(12345), { status: 'unknown' });
  const regs = fillTables();
  const w = lobby.register([player(), player()]);
  assert.deepEqual(lobby.whereIs(w.participantIds[1]), { status: 'waiting', entryId: w.entryId, rank: 1 });
  const p = regs[10];
  assert.deepEqual(lobby.whereIs(p.participantIds[0]), { status: 'playing', entryId: p.entryId, matchId: p.matchId, tableNo: 2, slot: 'B' });
  clock.t += HOUR;
  lobby.tick();
  assert.deepEqual(lobby.whereIs(p.participantIds[0]), { status: 'completed', entryId: p.entryId });
  assert.equal(lobby.whereIs(w.participantIds[0]).status, 'playing');
});

test('goodies : remise, annulation, refus pour un joueur en file ou inconnu', () => {
  const { lobby, player, clock, state } = setup();
  const reg = lobby.register([player(), player()]);
  const solo = lobby.register([player()]);
  clock.t += HOUR;
  lobby.tick();
  assert.deepEqual(lobby.giveGoodies(reg.participantIds[0]), { participantId: reg.participantIds[0], given: true });
  assert.equal(state().stats.goodiesPending, 1);
  // les goodies remis passent en fin de liste
  assert.deepEqual(state().goodies.map((g) => g.id), [reg.participantIds[1], reg.participantIds[0]]);
  assert.equal(state().goodies[1].goodiesGivenAt, clock.t);
  lobby.giveGoodies(reg.participantIds[0], false);
  assert.equal(state().stats.goodiesPending, 2);
  assert.throws(() => lobby.giveGoodies(solo.participantIds[0]), code('conflict'));
  assert.throws(() => lobby.giveGoodies(777), code('not_found'));
  const g = state().goodies[0];
  assert.equal(g.tableNo, 1);
  assert.equal(g.slot, 'A');
  assert.equal(g.endedAt, clock.t);
});

test('exportRows : tous les jours, partie jouée, et un joueur retiré n’hérite pas de la table de son ex-partenaire', () => {
  const { lobby, player, fillTables, clock } = setup();
  const regs = fillTables();
  const pair = lobby.register([player('Absent'), player('Reste')]);
  lobby.removeParticipant(pair.participantIds[0]);
  lobby.register([player('Solo')]); // associé à « Reste », sur l'entrée de la paire d'origine
  lobby.releaseMatch(regs[0].matchId);
  const rows = lobby.exportRows();
  const byName = (name) => rows.find((r) => r.firstName === name);
  assert.equal(byName('Reste').tableNo, 1);
  assert.equal(byName('Solo').tableNo, 1);
  const absent = byName('Absent');
  assert.equal(absent.status, 'removed');
  assert.equal(absent.statusLabel, 'retiré (absent)');
  assert.equal(absent.tableNo, null);
  assert.equal(absent.slot, null);
  assert.equal(absent.matchStartedAt, null);
  assert.equal(absent.matchEndedAt, null);
  assert.equal(absent.vsAnimator, false);
  const left = rows.find((r) => r.id === regs[0].participantIds[0]);
  assert.equal(left.status, 'left_early');
  assert.equal(left.matchEndedAt, clock.t);
  clock.t += HOUR;
  lobby.tick();
  lobby.newDay();
  lobby.register([player('Jour2')]);
  const all = lobby.exportRows();
  assert.equal(all.length, 36 + 2 + 1 + 1);
  assert.deepEqual(all.map((r) => r.id), [...all.map((r) => r.id)].sort((a, b) => a - b));
  assert.equal(all.find((r) => r.firstName === 'Jour2').dayNumber, 2);
  assert.equal(all.find((r) => r.firstName === 'Jour2').tableNo, null);
  assert.equal(all.find((r) => r.firstName === 'Reste').status, 'completed');
});

// ---------------------------------------------------------------- robustesse des identifiants

test('identifiants mal formés : erreur métier « invalid », jamais une exception SQLite', () => {
  const { lobby, player } = setup();
  const reg = lobby.register([player(), player()]);
  const calls = {
    removeParticipant: (v) => lobby.removeParticipant(v),
    editParticipant: (v) => lobby.editParticipant(v, { firstName: 'X' }),
    giveGoodies: (v) => lobby.giveGoodies(v),
    releaseMatch: (v) => lobby.releaseMatch(v),
    adjustMatch: (v) => lobby.adjustMatch(v, MIN),
    placeAnyway: (v) => lobby.placeAnyway(v),
    cancelPlaceAnyway: (v) => lobby.cancelPlaceAnyway(v),
    checkExclude: (v) => lobby.check({ email: 'j1@exemple.fr', excludeParticipantId: v }),
  };
  for (const [name, fn] of Object.entries(calls)) {
    for (const bad of [true, {}, { id: 1 }, [1], 'abc', -1, 0, 1.5, NaN]) {
      assert.throws(() => fn(bad), code('invalid'), `${name}(${JSON.stringify(bad)})`);
    }
  }
  // un identifiant numérique transmis en texte est accepté partout
  assert.equal(lobby.check({ email: 'j1@exemple.fr', excludeParticipantId: String(reg.participantIds[0]) }).email, null);
  assert.doesNotThrow(() => lobby.adjustMatch(String(reg.matchId), MIN));
  const solo = lobby.register([player()]);
  assert.equal(lobby.cancelPlaceAnyway(String(solo.entryId)).entryId, solo.entryId);
  assert.equal(lobby.placeAnyway(String(solo.entryId)).placed, true);
});

// ---------------------------------------------------------------- fermeture du stand (le soir)

test('stand fermé : la file n’est plus placée la nuit ; après la nouvelle journée, ces joueurs peuvent se réinscrire', () => {
  const { lobby, player, fillTables, clock, state, queue } = setup();
  fillTables();
  const nuit = lobby.register([player('Nuit1'), player('Nuit2')]);
  assert.equal(nuit.status, 'waiting');
  assert.deepEqual(lobby.setPlacementsPaused(true), { placementsPaused: true, placed: 0 });
  assert.equal(state().settings.placementsPaused, true);
  assert.equal(lobby.getPublicState().settings.placementsPaused, true, 'visible sur l’écran public');

  // la nuit : les timers se terminent, personne n'est placé
  clock.t += 11 * HOUR;
  assert.equal(lobby.tick(), true);
  clock.t += 2 * HOUR;
  assert.equal(lobby.tick(), false);
  const night = state();
  assert.deepEqual(queue(), ['Nuit1+Nuit2']);
  assert.equal(night.stats.playing, 0);
  assert.equal(night.stats.completedToday, 36);
  assert.equal(night.goodies.length, 36);
  assert.ok(!night.goodies.some((g) => g.firstName.startsWith('Nuit')), 'pas de goodies pour la file');
  assert.equal(lobby.whereIs(nuit.participantIds[0]).status, 'waiting');

  // le matin : la remise à zéro expire la file et rouvre le stand
  const day = lobby.newDay();
  assert.equal(day.expiredParticipants, 2);
  assert.equal(day.interruptedMatches, 0);
  assert.equal(state().settings.placementsPaused, false);
  const [n1, n2] = lobby.db.prepare('SELECT * FROM participants WHERE id IN (?, ?) ORDER BY id').all(...nuit.participantIds);
  assert.equal(lobby.check({ email: n1.email, ticket: n1.ticket }).email, null);
  const again = lobby.register([
    { firstName: n1.first_name, lastName: n1.last_name, email: n1.email, ticket: n1.ticket },
    { firstName: n2.first_name, lastName: n2.last_name, email: n2.email, ticket: n2.ticket },
  ]);
  assert.equal(again.status, 'playing', 'placés dès la réouverture');
  assert.equal(again.tableNo, 1);
  const rows = lobby.exportRows().filter((r) => r.email === n1.email);
  assert.deepEqual(rows.map((r) => [r.dayNumber, r.status, r.tableNo]), [
    [1, 'expired', null],
    [2, 'playing', 1],
  ]);
});

test('stand fermé : « Libérer » ou « −5 min » sur toutes les parties ne place personne', () => {
  const { lobby, player, fillTables, clock, state, queue } = setup();
  const regs = fillTables();
  const waiting = [];
  for (let i = 0; i < 4; i++) waiting.push(lobby.register([player(`F${i}a`), player(`F${i}b`)]));
  lobby.setPlacementsPaused(true);
  clock.t += 55 * MIN;
  const matchIds = regs.map((r) => r.matchId);
  for (const id of matchIds.slice(0, 9)) lobby.releaseMatch(id);
  for (const id of matchIds.slice(9)) lobby.adjustMatch(id, -10 * MIN);
  const st = state();
  assert.equal(st.stats.playing, 0, '18 actions suffisent : aucune nouvelle partie');
  assert.equal(queue().length, 4);
  assert.equal(st.goodies.length, 18, 'seules les parties menées au bout donnent des goodies');
  const left = lobby.db.prepare("SELECT COUNT(*) AS n FROM participants WHERE status = 'left_early'").get().n;
  assert.equal(left, 18);

  lobby.newDay();
  for (const reg of waiting) {
    for (const id of reg.participantIds) assert.equal(lobby.whereIs(id).status, 'expired');
  }
  const p = lobby.db.prepare('SELECT * FROM participants WHERE id = ?').get(waiting[3].participantIds[1]);
  const res = lobby.register([{ firstName: p.first_name, lastName: p.last_name, email: p.email, ticket: p.ticket }]);
  assert.equal(res.status, 'waiting', 'réinscription acceptée');
});

test('stand fermé : inscription, « Placer quand même » et tables remises en service ne placent personne ; la réouverture place la file', () => {
  const { lobby, player, state, slot, queue, firstNames } = setup();
  lobby.setTableEnabled(1, false);
  lobby.setPlacementsPaused(true);
  const pair = lobby.register([player('A'), player('B')]);
  assert.equal(pair.status, 'waiting');
  assert.equal(pair.rank, 1);
  const solo = lobby.register([player('S')]);
  assert.deepEqual(lobby.placeAnyway(solo.entryId), { placed: false });
  lobby.setTableEnabled(1, true);
  assert.deepEqual(queue(), ['A+B', 'S']);
  assert.equal(state().stats.playing, 0);
  // le réglage est en base : il survit à un redémarrage du serveur
  const restarted = new Lobby(lobby.db, { now: lobby.now });
  assert.equal(restarted.tick(), false);
  assert.equal(restarted.getAdminState().settings.placementsPaused, true);

  assert.deepEqual(lobby.setPlacementsPaused(false), { placementsPaused: false, placed: 2 });
  assert.deepEqual(firstNames(slot(1, 'A')), ['A', 'B']);
  assert.deepEqual(firstNames(slot(2, 'A')), ['S']);
  assert.equal(slot(2, 'A').vsAnimator, true);
  assert.deepEqual(queue(), []);
  for (const bad of [undefined, null, 'true', 1, 0, {}]) {
    assert.throws(() => lobby.setPlacementsPaused(bad), code('invalid'), JSON.stringify(bad));
  }
  assert.equal(state().settings.placementsPaused, false);
});

// ---------------------------------------------------------------- absent à l'appel, après le placement

test('absent à la table : retiré (réinscriptible), le partenaire présent continue contre un animateur', () => {
  const { lobby, player, fillTables, clock, state, slot, firstNames } = setup();
  const regs = fillTables();
  const pair = lobby.register([player('Present'), player('Absent')]);
  clock.t += 20 * MIN;
  lobby.releaseMatch(regs[0].matchId);
  const loc = lobby.whereIs(pair.participantIds[1]);
  assert.equal(loc.status, 'playing');
  assert.equal(loc.tableNo, 1);
  const before = slot(1, 'A');

  clock.t += 5 * MIN;
  const [presentId, absentId] = pair.participantIds;
  assert.deepEqual(lobby.noShow(absentId), { removed: absentId, matchId: loc.matchId, cancelled: false, vsAnimator: true });
  const after = slot(1, 'A');
  assert.deepEqual(firstNames(after), ['Present']);
  assert.equal(after.vsAnimator, true);
  assert.equal(after.matchId, before.matchId);
  assert.equal(after.endsAt, before.endsAt, 'le timer continue');
  assert.equal(lobby.whereIs(absentId).status, 'removed');

  // l'absent peut se réinscrire avec le même email et le même billet
  const a = lobby.db.prepare('SELECT * FROM participants WHERE id = ?').get(absentId);
  const back = lobby.register([{ firstName: a.first_name, lastName: a.last_name, email: a.email, ticket: a.ticket }]);
  assert.equal(back.status, 'waiting');

  // fin du timer : goodies pour le joueur présent uniquement
  clock.t = before.endsAt;
  lobby.tick();
  assert.equal(lobby.whereIs(presentId).status, 'completed');
  const goodies = state().goodies.map((g) => g.firstName);
  assert.ok(goodies.includes('Present'));
  assert.ok(!goodies.includes('Absent'));
  const rows = lobby.exportRows().filter((r) => r.firstName === 'Absent');
  assert.deepEqual(rows.map((r) => [r.status, r.tableNo, r.matchStartedAt]), [
    ['removed', null, null],
    ['waiting', null, null],
  ]);
  const present = lobby.exportRows().find((r) => r.firstName === 'Present');
  assert.equal(present.vsAnimator, true);
});

test('absent à la table : sans joueur présent, la partie est annulée et l’emplacement réattribué', () => {
  const { lobby, player, fillTables, clock, slot, firstNames } = setup();
  const regs = fillTables(17);
  const ab = lobby.register([player('A'), player('B')]); // 9 B
  lobby.register([player('C'), player('D')]); // en file
  assert.equal(ab.tableNo, 9);
  clock.t += 2 * MIN;
  assert.equal(lobby.noShow(ab.participantIds[0]).cancelled, false);
  const res = lobby.noShow(ab.participantIds[1]);
  assert.equal(res.cancelled, true);
  assert.equal(res.vsAnimator, false);
  assert.deepEqual(firstNames(slot(9, 'B')), ['C', 'D'], 'paire suivante placée');
  assert.equal(slot(9, 'B').startedAt, clock.t);
  const left = lobby.db.prepare("SELECT COUNT(*) AS n FROM participants WHERE status = 'left_early'").get().n;
  assert.equal(left, 0, 'personne n’est marqué « parti avant la fin »');
  for (const id of ab.participantIds) assert.equal(lobby.whereIs(id).status, 'removed');
  assert.equal(lobby.check({ email: 'j35@exemple.fr', ticket: 'T-1035' }).email, null);
  assert.equal(regs.length, 17);

  // joueur seul contre un animateur, absent : partie annulée
  const solo = lobby.register([player('Seul')]);
  lobby.releaseMatch(regs[0].matchId);
  assert.equal(lobby.placeAnyway(solo.entryId).placed, true);
  const cancel = lobby.noShow(solo.participantIds[0]);
  assert.equal(cancel.cancelled, true);
  assert.equal(slot(1, 'A'), null);
});

test('absent à la table : stand fermé, l’emplacement libéré reste vide', () => {
  const { lobby, player, fillTables, clock, slot } = setup();
  fillTables(17);
  const ab = lobby.register([player('A'), player('B')]);
  lobby.register([player('C'), player('D')]);
  lobby.setPlacementsPaused(true);
  clock.t += MIN;
  lobby.noShow(ab.participantIds[0]);
  lobby.noShow(ab.participantIds[1]);
  assert.equal(slot(9, 'B'), null);
  assert.equal(lobby.getAdminState().queue.length, 1);
});

test('absent à la table : refusé après le délai, pour un joueur en file, qui a fini ou inconnu', () => {
  const { lobby, player, fillTables, clock, state } = setup();
  const reg = lobby.register([player(), player()]);
  assert.equal(state().settings.noShowWindowMs, 15 * MIN);
  clock.t += 15 * MIN + 1;
  assert.throws(() => lobby.noShow(reg.participantIds[0]), (err) => {
    code('conflict')(err);
    assert.match(err.message, /plus de 15 minutes/);
    assert.match(err.message, /« Libérer sans goodies »/);
    assert.match(err.message, /contre un animateur/);
    assert.doesNotMatch(err.message, /Libérer l'emplacement/, 'ce bouton n’existe plus');
    return true;
  });
  assert.equal(lobby.whereIs(reg.participantIds[0]).status, 'playing', 'rien n’a changé');
  assert.equal(state().tables[0].slots.A.vsAnimator, false);

  fillTables(17);
  const waiting = lobby.register([player()]);
  assert.throws(() => lobby.noShow(waiting.participantIds[0]), (err) => {
    code('conflict')(err);
    assert.match(err.message, /Retirer/);
    return true;
  });
  clock.t += HOUR;
  lobby.tick();
  assert.equal(lobby.whereIs(reg.participantIds[0]).status, 'completed');
  assert.throws(() => lobby.noShow(reg.participantIds[0]), code('conflict'));
  assert.throws(() => lobby.noShow(424242), code('not_found'));
  for (const bad of [true, {}, [1], 'abc', -1, 0, 1.5, NaN]) {
    assert.throws(() => lobby.noShow(bad), code('invalid'), JSON.stringify(bad));
  }
});
