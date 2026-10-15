'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS days (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL
);

-- Une entrée de file = 1 joueur seul ou 2 joueurs placés ensemble.
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id      INTEGER NOT NULL REFERENCES days(id),
  position    INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  status      TEXT NOT NULL
              CHECK (status IN ('waiting', 'playing', 'finished', 'removed', 'merged', 'expired')),
  vs_animator INTEGER NOT NULL DEFAULT 0,
  merged_into INTEGER REFERENCES entries(id)
);
CREATE INDEX IF NOT EXISTS ix_entries_status ON entries(status, position);

CREATE TABLE IF NOT EXISTS participants (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id           INTEGER NOT NULL REFERENCES days(id),
  entry_id         INTEGER NOT NULL REFERENCES entries(id),
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  email            TEXT NOT NULL,
  email_norm       TEXT NOT NULL,
  ticket           TEXT NOT NULL,
  ticket_norm      TEXT NOT NULL,
  status           TEXT NOT NULL
                   CHECK (status IN ('waiting', 'playing', 'completed', 'left_early', 'removed', 'expired', 'interrupted')),
  created_at       INTEGER NOT NULL,
  removed_at       INTEGER,
  goodies_given_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_participants_entry ON participants(entry_id);
-- Un email / billet ne peut être utilisé qu'une fois, sauf par un joueur qui n'a pas joué
-- (retiré pour absence, ou encore en attente lors de la remise à zéro).
CREATE UNIQUE INDEX IF NOT EXISTS ux_participants_email
  ON participants(email_norm) WHERE status NOT IN ('removed', 'expired');
CREATE UNIQUE INDEX IF NOT EXISTS ux_participants_ticket
  ON participants(ticket_norm) WHERE status NOT IN ('removed', 'expired');

CREATE TABLE IF NOT EXISTS matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day_id      INTEGER NOT NULL REFERENCES days(id),
  entry_id    INTEGER NOT NULL UNIQUE REFERENCES entries(id),
  table_no    INTEGER NOT NULL CHECK (table_no BETWEEN 1 AND 9),
  slot        TEXT NOT NULL CHECK (slot IN ('A', 'B')),
  vs_animator INTEGER NOT NULL DEFAULT 0,
  started_at  INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  ended_at    INTEGER,
  end_reason  TEXT CHECK (end_reason IN ('completed', 'released', 'day_end'))
);
-- Un emplacement ne peut accueillir qu'une partie en cours à la fois.
CREATE UNIQUE INDEX IF NOT EXISTS ux_matches_active_slot
  ON matches(table_no, slot) WHERE ended_at IS NULL;
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
