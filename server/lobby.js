'use strict';

// Moteur métier du stand : inscriptions, file d'attente, placement aux tables, timers.
// Toute la logique est ici, sans dépendance au réseau, pour pouvoir être testée
// avec une horloge injectée.

const TABLE_COUNT = 9;
const SLOTS = ['A', 'B'];
const DEFAULT_DURATION_MS = 60 * 60 * 1000;
const MIN_DURATION_MS = 60 * 1000;
const MAX_DURATION_MS = 3 * 60 * 60 * 1000;
const MAX_ADJUST_MS = 2 * 60 * 60 * 1000;
// Un joueur placé qui ne se présente pas à l'appel peut être déclaré absent pendant ce délai.
const NO_SHOW_WINDOW_MS = 15 * 60 * 1000;

const NAME_MAX = 60;
const EMAIL_MAX = 254;
const TICKET_MAX = 64;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Statuts qui ne bloquent pas une nouvelle inscription : le joueur n'a pas joué.
const NON_BLOCKING_STATUSES = ['removed', 'expired'];

class LobbyError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'LobbyError';
    this.code = code;
    this.details = details;
  }
}

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

// \p{Pd} : tous les tirets (« - », « – », « — », trait d'union insécable…).
function normalizeTicket(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[\s\p{Pd}_.]/gu, '');
}

function cleanName(value) {
  return String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}

// Pour la recherche : minuscules, sans accents (« Émilie » ≈ « emilie »).
function foldText(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Identifiant reçu de l'accueil (nombre, ou nombre en texte).
function toId(value) {
  const n = typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n <= 0) throw new LobbyError('invalid', 'Identifiant invalide.');
  return n;
}

// « Lucas M. » : seul format affiché sur l'écran public.
function displayName(firstName, lastName) {
  const first = cleanName(firstName);
  const last = cleanName(lastName);
  // Initiale = première lettre (« d'Artagnan » → « D. ») ; à défaut, premier caractère complet.
  const chars = Array.from(last);
  const letter = chars.find((c) => /\p{L}/u.test(c)) || chars[0];
  const initial = letter ? `${letter.toLocaleUpperCase('fr-FR')}.` : '';
  return [first, initial].filter(Boolean).join(' ');
}

function validatePlayer(raw, index) {
  const p = raw || {};
  const player = {
    firstName: cleanName(p.firstName),
    lastName: cleanName(p.lastName),
    email: String(p.email ?? '').trim(),
    ticket: String(p.ticket ?? '').trim(),
  };
  player.emailNorm = normalizeEmail(player.email);
  player.ticketNorm = normalizeTicket(player.ticket);

  const fail = (field, message) => {
    throw new LobbyError('invalid', message, { field, index });
  };
  if (!player.firstName) fail('firstName', 'Le prénom est obligatoire.');
  if (!player.lastName) fail('lastName', 'Le nom est obligatoire.');
  if (player.firstName.length > NAME_MAX) fail('firstName', 'Le prénom est trop long.');
  if (player.lastName.length > NAME_MAX) fail('lastName', 'Le nom est trop long.');
  if (!player.email) fail('email', "L'email est obligatoire.");
  if (player.email.length > EMAIL_MAX || !EMAIL_RE.test(player.emailNorm)) fail('email', "L'email n'est pas valide.");
  if (!player.ticketNorm) fail('ticket', 'Le numéro de billet est obligatoire.');
  if (player.ticket.length > TICKET_MAX) fail('ticket', 'Le numéro de billet est trop long.');
  return player;
}

const PARTICIPANT_STATUS_LABELS = {
  waiting: "en file d'attente",
  playing: 'en train de jouer',
  completed: 'partie terminée',
  left_early: 'parti avant la fin',
  removed: 'retiré (absent)',
  expired: 'en attente lors de la remise à zéro',
  interrupted: 'partie interrompue (nouvelle journée)',
};

class Lobby {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db;
    this.now = now;
    // SQLite lower() ne gère que l'ASCII : la recherche passe par cette fonction.
    db.function('rb_fold', { deterministic: true }, (value) => foldText(value));
    this.ensureDay();
  }

  // ---------------------------------------------------------------- utilitaires

  tx(fn) {
    return this.db.transaction(fn)();
  }

  getSetting(key, fallback) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }

  setSetting(key, value) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  getSettings() {
    return {
      matchDurationMs: this.getSetting('match_duration_ms', DEFAULT_DURATION_MS),
      disabledTables: this.getSetting('disabled_tables', []),
      // Stand fermé (le soir) : plus aucun placement automatique, la file attend.
      placementsPaused: this.getSetting('placements_paused', false) === true,
      noShowWindowMs: NO_SHOW_WINDOW_MS,
    };
  }

  ensureDay() {
    if (!this.currentDay()) {
      this.db.prepare('INSERT INTO days (started_at) VALUES (?)').run(this.now());
    }
  }

  currentDay() {
    return this.db.prepare('SELECT id, started_at FROM days ORDER BY id DESC LIMIT 1').get();
  }

  dayNumber(dayId) {
    return this.db.prepare('SELECT COUNT(*) AS n FROM days WHERE id <= ?').get(dayId).n;
  }

  // ---------------------------------------------------------------- disponibilité

  // Renvoie le participant (le plus récent) qui bloque cet email ou ce billet, ou null.
  findConflict(field, normValue, excludeParticipantId = null) {
    if (!normValue) return null;
    const column = field === 'email' ? 'email_norm' : 'ticket_norm';
    const row = this.db
      .prepare(
        `SELECT p.id, p.first_name, p.last_name, p.status, p.created_at, p.day_id
           FROM participants p
          WHERE p.${column} = ?
            AND p.status NOT IN ('removed', 'expired')
            AND (? IS NULL OR p.id <> ?)
          ORDER BY p.id DESC LIMIT 1`,
      )
      .get(normValue, excludeParticipantId, excludeParticipantId);
    if (!row) return null;
    return {
      participantId: row.id,
      name: `${row.first_name} ${row.last_name}`,
      status: row.status,
      statusLabel: PARTICIPANT_STATUS_LABELS[row.status],
      registeredAt: row.created_at,
      dayNumber: this.dayNumber(row.day_id),
    };
  }

  check({ email, ticket, excludeParticipantId = null } = {}) {
    const exclude = excludeParticipantId == null || excludeParticipantId === '' ? null : toId(excludeParticipantId);
    return {
      email: this.findConflict('email', normalizeEmail(email), exclude),
      ticket: this.findConflict('ticket', normalizeTicket(ticket), exclude),
    };
  }

  assertAvailable(player, index, excludeParticipantId = null) {
    const emailConflict = this.findConflict('email', player.emailNorm, excludeParticipantId);
    if (emailConflict) {
      throw new LobbyError(
        'email_used',
        `L'email ${player.email} a déjà été utilisé par ${emailConflict.name} (jour ${emailConflict.dayNumber}, ${emailConflict.statusLabel}).`,
        { field: 'email', index, conflict: emailConflict },
      );
    }
    const ticketConflict = this.findConflict('ticket', player.ticketNorm, excludeParticipantId);
    if (ticketConflict) {
      throw new LobbyError(
        'ticket_used',
        `Le billet ${player.ticket} a déjà été utilisé par ${ticketConflict.name} (jour ${ticketConflict.dayNumber}, ${ticketConflict.statusLabel}).`,
        { field: 'ticket', index, conflict: ticketConflict },
      );
    }
  }

  // ---------------------------------------------------------------- inscription

  register(players) {
    if (!Array.isArray(players) || players.length < 1 || players.length > 2) {
      throw new LobbyError('invalid', 'Une inscription concerne 1 ou 2 joueurs.');
    }
    const clean = players.map((p, i) => validatePlayer(p, i));
    if (clean.length === 2) {
      if (clean[0].emailNorm === clean[1].emailNorm) {
        throw new LobbyError('invalid', 'Les deux joueurs ont le même email.', { field: 'email', index: 1 });
      }
      if (clean[0].ticketNorm === clean[1].ticketNorm) {
        throw new LobbyError('invalid', 'Les deux joueurs ont le même numéro de billet.', { field: 'ticket', index: 1 });
      }
    }

    return this.tx(() => {
      clean.forEach((p, i) => this.assertAvailable(p, i));
      const t = this.now();
      const day = this.currentDay();
      const position = this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM entries').get().p;
      const entryId = Number(
        this.db
          .prepare("INSERT INTO entries (day_id, position, created_at, status) VALUES (?, ?, ?, 'waiting')")
          .run(day.id, position, t).lastInsertRowid,
      );
      const insert = this.db.prepare(
        `INSERT INTO participants
           (day_id, entry_id, first_name, last_name, email, email_norm, ticket, ticket_norm, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting', ?)`,
      );
      const participantIds = clean.map((p) =>
        Number(
          insert.run(day.id, entryId, p.firstName, p.lastName, p.email, p.emailNorm, p.ticket, p.ticketNorm, t)
            .lastInsertRowid,
        ),
      );
      this.mergeSolos();
      this.fill();
      return { participantIds, ...this.whereIs(participantIds[0]) };
    });
  }

  // Où se trouve un participant : en file (rang) ou à une table.
  whereIs(participantId) {
    const p = this.db.prepare('SELECT entry_id, status FROM participants WHERE id = ?').get(participantId);
    if (!p) return { status: 'unknown' };
    if (p.status === 'playing') {
      const m = this.db.prepare('SELECT id, table_no, slot FROM matches WHERE entry_id = ?').get(p.entry_id);
      return { status: 'playing', entryId: p.entry_id, matchId: m.id, tableNo: m.table_no, slot: m.slot };
    }
    if (p.status === 'waiting') {
      const rank = this.waitingEntries().findIndex((e) => e.id === p.entry_id) + 1;
      return { status: 'waiting', entryId: p.entry_id, rank };
    }
    return { status: p.status, entryId: p.entry_id };
  }

  // ---------------------------------------------------------------- file d'attente

  waitingEntries() {
    const day = this.currentDay();
    return this.db
      .prepare(
        `SELECT e.id, e.position, e.created_at, e.vs_animator,
                (SELECT COUNT(*) FROM participants p WHERE p.entry_id = e.id AND p.status = 'waiting') AS n
           FROM entries e
          WHERE e.status = 'waiting' AND e.day_id = ?
          ORDER BY e.position`,
      )
      .all(day.id);
  }

  // Deux joueurs seuls en attente sont associés : le second rejoint la place du premier.
  mergeSolos() {
    const solos = this.waitingEntries().filter((e) => e.n === 1);
    for (let i = 0; i + 1 < solos.length; i += 2) {
      const keep = solos[i];
      const absorbed = solos[i + 1];
      this.db
        .prepare("UPDATE participants SET entry_id = ? WHERE entry_id = ? AND status = 'waiting'")
        .run(keep.id, absorbed.id);
      this.db.prepare("UPDATE entries SET status = 'merged', merged_into = ? WHERE id = ?").run(keep.id, absorbed.id);
      this.db.prepare('UPDATE entries SET vs_animator = 0 WHERE id = ?').run(keep.id);
    }
  }

  // Emplacements libres, par ordre de préférence : tables vides d'abord, puis demi-tables.
  freeSlots() {
    const { disabledTables } = this.getSettings();
    const active = this.db.prepare('SELECT table_no, slot FROM matches WHERE ended_at IS NULL').all();
    const occupied = new Map();
    for (const m of active) {
      if (!occupied.has(m.table_no)) occupied.set(m.table_no, new Set());
      occupied.get(m.table_no).add(m.slot);
    }
    const empty = [];
    const half = [];
    for (let tableNo = 1; tableNo <= TABLE_COUNT; tableNo++) {
      if (disabledTables.includes(tableNo)) continue;
      const taken = occupied.get(tableNo) || new Set();
      const free = SLOTS.filter((s) => !taken.has(s));
      if (free.length === SLOTS.length) empty.push({ tableNo, slot: free[0] });
      else if (free.length > 0) half.push({ tableNo, slot: free[0] });
    }
    return [...empty, ...half];
  }

  // Première entrée prête : une paire, ou un joueur seul « placé quand même ».
  // Un joueur seul non prêt est sauté : les paires derrière lui passent devant.
  nextReadyEntry() {
    return this.waitingEntries().find((e) => e.n >= 2 || (e.n === 1 && e.vs_animator)) || null;
  }

  fill() {
    if (this.getSettings().placementsPaused) return 0;
    let placed = 0;
    for (;;) {
      const slot = this.freeSlots()[0];
      if (!slot) break;
      const entry = this.nextReadyEntry();
      if (!entry) break;
      this.place(entry, slot);
      placed++;
    }
    return placed;
  }

  place(entry, { tableNo, slot }) {
    const t = this.now();
    const { matchDurationMs } = this.getSettings();
    const day = this.currentDay();
    this.db
      .prepare(
        `INSERT INTO matches (day_id, entry_id, table_no, slot, vs_animator, started_at, ends_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(day.id, entry.id, tableNo, slot, entry.n === 1 ? 1 : 0, t, t + matchDurationMs);
    this.db.prepare("UPDATE entries SET status = 'playing' WHERE id = ?").run(entry.id);
    this.db
      .prepare("UPDATE participants SET status = 'playing' WHERE entry_id = ? AND status = 'waiting'")
      .run(entry.id);
  }

  // ---------------------------------------------------------------- fin de partie

  endMatch(matchId, reason) {
    const match = this.db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    const t = this.now();
    const endedAt = reason === 'completed' ? Math.min(t, match.ends_at) : t;
    this.db.prepare('UPDATE matches SET ended_at = ?, end_reason = ? WHERE id = ?').run(endedAt, reason, matchId);
    this.db.prepare("UPDATE entries SET status = 'finished' WHERE id = ?").run(match.entry_id);
    const participantStatus = { completed: 'completed', released: 'left_early', day_end: 'interrupted' }[reason];
    this.db
      .prepare("UPDATE participants SET status = ? WHERE entry_id = ? AND status = 'playing'")
      .run(participantStatus, match.entry_id);
  }

  getActiveMatch(matchId) {
    const match = this.db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId);
    if (!match) throw new LobbyError('not_found', 'Partie introuvable.');
    if (match.ended_at !== null) throw new LobbyError('conflict', 'Cette partie est déjà terminée.');
    return match;
  }

  // Termine (goodies dus) les parties dont le timer est écoulé. Renvoie leur nombre.
  completeDueMatches() {
    const due = this.db
      .prepare('SELECT id FROM matches WHERE ended_at IS NULL AND ends_at <= ? ORDER BY ends_at, id')
      .all(this.now());
    for (const m of due) this.endMatch(m.id, 'completed');
    return due.length;
  }

  // Appelé chaque seconde : termine les parties dont le timer est écoulé et place les suivants.
  // Renvoie true si l'état a changé.
  tick() {
    return this.tx(() => {
      const ended = this.completeDueMatches();
      const placed = this.fill();
      return ended > 0 || placed > 0;
    });
  }

  releaseMatch(matchId) {
    const id = toId(matchId);
    return this.tx(() => {
      const match = this.getActiveMatch(id);
      // Timer déjà écoulé (le tick n'est pas encore passé) : partie terminée, goodies dus.
      this.endMatch(id, match.ends_at <= this.now() ? 'completed' : 'released');
      this.fill();
      return { released: id };
    });
  }

  adjustMatch(matchId, deltaMs) {
    const delta = Number(deltaMs);
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > MAX_ADJUST_MS) {
      throw new LobbyError('invalid', 'Ajustement de temps invalide.');
    }
    const id = toId(matchId);
    return this.tx(() => {
      const match = this.getActiveMatch(id);
      const endsAt = Math.max(this.now(), match.ends_at + delta);
      this.db.prepare('UPDATE matches SET ends_at = ? WHERE id = ?').run(endsAt, id);
      if (endsAt <= this.now()) {
        this.endMatch(id, 'completed');
        this.fill();
      }
      return { matchId: id, endsAt };
    });
  }

  // ---------------------------------------------------------------- actions de l'accueil

  removeParticipant(participantId) {
    const id = toId(participantId);
    return this.tx(() => {
      const p = this.db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
      if (!p) throw new LobbyError('not_found', 'Joueur introuvable.');
      if (p.status !== 'waiting') {
        throw new LobbyError('conflict', "Seul un joueur en file d'attente peut être retiré.");
      }
      this.db
        .prepare("UPDATE participants SET status = 'removed', removed_at = ? WHERE id = ?")
        .run(this.now(), id);
      const remaining = this.db
        .prepare("SELECT COUNT(*) AS n FROM participants WHERE entry_id = ? AND status = 'waiting'")
        .get(p.entry_id).n;
      if (remaining === 0) {
        this.db.prepare("UPDATE entries SET status = 'removed' WHERE id = ?").run(p.entry_id);
      } else {
        // Le partenaire redevient joueur seul, à la même place dans la file.
        this.db.prepare('UPDATE entries SET vs_animator = 0 WHERE id = ?').run(p.entry_id);
      }
      this.mergeSolos();
      this.fill();
      return { removed: id };
    });
  }

  // Joueur placé mais absent à l'appel (début de partie) : il n'a pas joué et pourra se réinscrire.
  // Son partenaire continue contre un animateur ; sans partenaire, la partie est annulée.
  noShow(participantId) {
    const id = toId(participantId);
    return this.tx(() => {
      const p = this.db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
      if (!p) throw new LobbyError('not_found', 'Joueur introuvable.');
      if (p.status === 'waiting') {
        throw new LobbyError('conflict', "Ce joueur est en file d'attente : utilisez « Retirer ».");
      }
      const match = this.db.prepare('SELECT * FROM matches WHERE entry_id = ? AND ended_at IS NULL').get(p.entry_id);
      if (p.status !== 'playing' || !match) throw new LobbyError('conflict', "Ce joueur n'est pas à une table.");
      const t = this.now();
      if (t - match.started_at > NO_SHOW_WINDOW_MS) {
        throw new LobbyError(
          'conflict',
          `La partie a commencé il y a plus de ${Math.round(NO_SHOW_WINDOW_MS / 60000)} minutes : ` +
            "le joueur ne peut plus être déclaré absent (utilisez « Libérer l'emplacement »).",
        );
      }
      this.db.prepare("UPDATE participants SET status = 'removed', removed_at = ? WHERE id = ?").run(t, id);
      const remaining = this.db
        .prepare("SELECT COUNT(*) AS n FROM participants WHERE entry_id = ? AND status = 'playing'")
        .get(p.entry_id).n;
      if (remaining > 0) {
        this.db.prepare('UPDATE matches SET vs_animator = 1 WHERE id = ?').run(match.id);
        return { removed: id, matchId: match.id, cancelled: false, vsAnimator: true };
      }
      // Plus personne à la table : partie annulée (aucun joueur n'est marqué « parti avant la fin »).
      this.endMatch(match.id, 'released');
      this.db.prepare("UPDATE entries SET status = 'removed' WHERE id = ?").run(p.entry_id);
      this.fill();
      return { removed: id, matchId: match.id, cancelled: true, vsAnimator: false };
    });
  }

  getWaitingSoloEntry(entryId) {
    const id = toId(entryId);
    const entry = this.waitingEntries().find((e) => e.id === id);
    if (!entry) throw new LobbyError('not_found', "Cette entrée n'est plus en file d'attente.");
    if (entry.n !== 1) throw new LobbyError('conflict', 'Seul un joueur seul peut jouer contre un animateur.');
    return entry;
  }

  // Le joueur seul jouera contre un animateur : il devient prêt et est placé dès qu'un emplacement est libre.
  placeAnyway(entryId) {
    return this.tx(() => {
      const { id } = this.getWaitingSoloEntry(entryId);
      this.db.prepare('UPDATE entries SET vs_animator = 1 WHERE id = ?').run(id);
      this.fill();
      const match = this.db.prepare('SELECT id, table_no, slot FROM matches WHERE entry_id = ?').get(id);
      return match
        ? { placed: true, matchId: match.id, tableNo: match.table_no, slot: match.slot }
        : { placed: false };
    });
  }

  cancelPlaceAnyway(entryId) {
    return this.tx(() => {
      const { id } = this.getWaitingSoloEntry(entryId);
      this.db.prepare('UPDATE entries SET vs_animator = 0 WHERE id = ?').run(id);
      return { entryId: id };
    });
  }

  giveGoodies(participantId, given = true) {
    const id = toId(participantId);
    return this.tx(() => {
      const p = this.db.prepare('SELECT status FROM participants WHERE id = ?').get(id);
      if (!p) throw new LobbyError('not_found', 'Joueur introuvable.');
      if (p.status !== 'completed') {
        throw new LobbyError('conflict', "Ce joueur n'a pas terminé sa partie : pas de goodies.");
      }
      this.db
        .prepare('UPDATE participants SET goodies_given_at = ? WHERE id = ?')
        .run(given ? this.now() : null, id);
      return { participantId: id, given: !!given };
    });
  }

  editParticipant(participantId, fields) {
    const id = toId(participantId);
    return this.tx(() => {
      const current = this.db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
      if (!current) throw new LobbyError('not_found', 'Joueur introuvable.');
      const merged = {
        firstName: fields?.firstName ?? current.first_name,
        lastName: fields?.lastName ?? current.last_name,
        email: fields?.email ?? current.email,
        ticket: fields?.ticket ?? current.ticket,
      };
      const player = validatePlayer(merged, 0);
      if (!NON_BLOCKING_STATUSES.includes(current.status)) this.assertAvailable(player, 0, id);
      this.db
        .prepare(
          `UPDATE participants
              SET first_name = ?, last_name = ?, email = ?, email_norm = ?, ticket = ?, ticket_norm = ?
            WHERE id = ?`,
        )
        .run(player.firstName, player.lastName, player.email, player.emailNorm, player.ticket, player.ticketNorm, id);
      return { participantId: id };
    });
  }

  setDuration(durationMs) {
    const ms = Math.round(Number(durationMs));
    if (!Number.isFinite(ms) || ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) {
      throw new LobbyError('invalid', 'La durée doit être comprise entre 1 minute et 3 heures.');
    }
    this.setSetting('match_duration_ms', ms);
    return { matchDurationMs: ms };
  }

  setTableEnabled(tableNo, enabled) {
    const no = Number(tableNo);
    if (!Number.isInteger(no) || no < 1 || no > TABLE_COUNT) throw new LobbyError('invalid', 'Table invalide.');
    return this.tx(() => {
      const disabled = new Set(this.getSettings().disabledTables);
      if (enabled) disabled.delete(no);
      else disabled.add(no);
      this.setSetting('disabled_tables', [...disabled].sort((a, b) => a - b));
      this.fill();
      return { tableNo: no, enabled: !!enabled };
    });
  }

  // « Fermer le stand » le soir : les parties en cours continuent, mais plus personne n'est
  // placé (les joueurs encore en file pourront se réinscrire après la « Nouvelle journée »).
  setPlacementsPaused(paused) {
    if (typeof paused !== 'boolean') throw new LobbyError('invalid', 'Valeur invalide (oui ou non attendu).');
    return this.tx(() => {
      this.setSetting('placements_paused', paused);
      const placed = this.fill();
      return { placementsPaused: paused, placed };
    });
  }

  // Remise à zéro du matin : la file est vidée, tous les participants restent en base.
  newDay() {
    return this.tx(() => {
      const t = this.now();
      const day = this.currentDay();
      // Les parties dont le timer est déjà écoulé sont terminées normalement (goodies dus).
      this.completeDueMatches();
      const active = this.db.prepare('SELECT id FROM matches WHERE ended_at IS NULL').all();
      for (const m of active) this.endMatch(m.id, 'day_end');
      const expired = this.db
        .prepare("UPDATE participants SET status = 'expired' WHERE status = 'waiting'")
        .run().changes;
      this.db.prepare("UPDATE entries SET status = 'expired' WHERE status = 'waiting'").run();
      // Le stand rouvre : les placements automatiques reprennent.
      this.setSetting('placements_paused', false);
      const newDayId = Number(this.db.prepare('INSERT INTO days (started_at) VALUES (?)').run(t).lastInsertRowid);
      return {
        previousDayId: day.id,
        dayId: newDayId,
        dayNumber: this.dayNumber(newDayId),
        expiredParticipants: expired,
        interruptedMatches: active.length,
      };
    });
  }

  search(query) {
    const q = cleanName(query);
    if (q.length < 2) return [];
    const like = `%${foldText(q).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const ticketLike = `%${normalizeTicket(q).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM participants
          WHERE rb_fold(first_name || ' ' || last_name) LIKE ? ESCAPE '\\'
             OR rb_fold(last_name || ' ' || first_name) LIKE ? ESCAPE '\\'
             OR rb_fold(email_norm) LIKE ? ESCAPE '\\'
             OR (? <> '%%' AND ticket_norm LIKE ? ESCAPE '\\')
          ORDER BY id DESC LIMIT 25`,
      )
      .all(like, like, like, ticketLike, ticketLike);
    return rows.map((r) => this.participantView(r, true));
  }

  // ---------------------------------------------------------------- projections

  participantView(row, full) {
    const base = { id: row.id, displayName: displayName(row.first_name, row.last_name) };
    if (!full) return base;
    return {
      ...base,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      ticket: row.ticket,
      status: row.status,
      statusLabel: PARTICIPANT_STATUS_LABELS[row.status],
      createdAt: row.created_at,
      dayNumber: this.dayNumber(row.day_id),
      goodiesGivenAt: row.goodies_given_at,
    };
  }

  participantsOfEntry(entryId, status) {
    return this.db
      .prepare('SELECT * FROM participants WHERE entry_id = ? AND status = ? ORDER BY id')
      .all(entryId, status);
  }

  buildState(full) {
    const t = this.now();
    const day = this.currentDay();
    const settings = this.getSettings();

    const activeMatches = this.db.prepare('SELECT * FROM matches WHERE ended_at IS NULL').all();
    const tables = [];
    for (let no = 1; no <= TABLE_COUNT; no++) {
      const slots = {};
      for (const slot of SLOTS) {
        const m = activeMatches.find((x) => x.table_no === no && x.slot === slot);
        slots[slot] = m
          ? {
              matchId: m.id,
              startedAt: m.started_at,
              endsAt: m.ends_at,
              vsAnimator: !!m.vs_animator,
              players: this.participantsOfEntry(m.entry_id, 'playing').map((p) => this.participantView(p, full)),
            }
          : null;
      }
      tables.push({ no, enabled: !settings.disabledTables.includes(no), slots });
    }

    const queue = this.waitingEntries().map((e, i) => {
      const players = this.participantsOfEntry(e.id, 'waiting').map((p) => this.participantView(p, full));
      return {
        entryId: e.id,
        rank: i + 1,
        kind: players.length >= 2 ? 'pair' : 'solo',
        ready: players.length >= 2 || !!e.vs_animator,
        vsAnimator: !!e.vs_animator,
        createdAt: e.created_at,
        players,
      };
    });

    const state = {
      serverNow: t,
      day: { id: day.id, number: this.dayNumber(day.id), startedAt: day.started_at },
      settings,
      tables,
      queue,
    };

    if (full) {
      const goodies = this.db
        .prepare(
          `SELECT p.*, m.table_no, m.slot, m.ended_at
             FROM participants p JOIN matches m ON m.entry_id = p.entry_id
            WHERE p.status = 'completed' AND m.day_id = ?
            ORDER BY (p.goodies_given_at IS NOT NULL), m.ended_at DESC, p.id`,
        )
        .all(day.id)
        .map((r) => ({ ...this.participantView(r, true), tableNo: r.table_no, slot: r.slot, endedAt: r.ended_at }));
      const count = (sql, ...args) => this.db.prepare(sql).get(...args).n;
      state.goodies = goodies;
      state.stats = {
        registeredToday: count(
          "SELECT COUNT(*) AS n FROM participants WHERE day_id = ? AND status NOT IN ('removed')",
          day.id,
        ),
        waiting: count("SELECT COUNT(*) AS n FROM participants WHERE status = 'waiting'"),
        playing: count("SELECT COUNT(*) AS n FROM participants WHERE status = 'playing'"),
        completedToday: count(
          "SELECT COUNT(*) AS n FROM participants WHERE day_id = ? AND status = 'completed'",
          day.id,
        ),
        goodiesPending: goodies.filter((g) => !g.goodiesGivenAt).length,
        totalParticipants: count(
          "SELECT COUNT(*) AS n FROM participants WHERE status NOT IN ('removed', 'expired')",
        ),
      };
    }
    return state;
  }

  getPublicState() {
    return this.buildState(false);
  }

  getAdminState() {
    return this.buildState(true);
  }

  // Toutes les lignes pour l'export CSV (tous les jours du salon).
  exportRows() {
    return this.db
      .prepare(
        `SELECT p.*, m.table_no, m.slot, m.started_at AS match_started_at, m.ended_at AS match_ended_at,
                m.end_reason, m.vs_animator AS match_vs_animator
           FROM participants p
           -- un joueur retiré garde l'entrée de son ex-partenaire : il n'a pas joué sa partie
           LEFT JOIN matches m ON m.entry_id = p.entry_id
                              AND p.status IN ('playing', 'completed', 'left_early', 'interrupted')
          ORDER BY p.id`,
      )
      .all()
      .map((r) => ({
        id: r.id,
        dayNumber: this.dayNumber(r.day_id),
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        ticket: r.ticket,
        status: r.status,
        statusLabel: PARTICIPANT_STATUS_LABELS[r.status],
        createdAt: r.created_at,
        tableNo: r.table_no ?? null,
        slot: r.slot ?? null,
        vsAnimator: !!r.match_vs_animator,
        matchStartedAt: r.match_started_at ?? null,
        matchEndedAt: r.match_ended_at ?? null,
        goodiesGivenAt: r.goodies_given_at ?? null,
      }));
  }
}

module.exports = {
  Lobby,
  LobbyError,
  TABLE_COUNT,
  SLOTS,
  DEFAULT_DURATION_MS,
  PARTICIPANT_STATUS_LABELS,
  normalizeEmail,
  normalizeTicket,
  displayName,
};
