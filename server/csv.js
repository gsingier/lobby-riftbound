'use strict';

// Export CSV pour Excel (FR) : séparateur « ; », BOM UTF-8, dates à l'heure de Paris.

const TIME_ZONE = 'Europe/Paris';

const dateFormatter = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatDate(ms) {
  return ms ? dateFormatter.format(new Date(ms)) : '';
}

function escapeCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  // Neutralise l'injection de formules dans Excel / LibreOffice.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

const COLUMNS = [
  ['ID', (r) => r.id],
  ['Jour', (r) => r.dayNumber],
  ['Prénom', (r) => r.firstName],
  ['Nom', (r) => r.lastName],
  ['Email', (r) => r.email],
  ['Billet', (r) => r.ticket],
  ['Statut', (r) => r.statusLabel],
  ['Inscrit le', (r) => formatDate(r.createdAt)],
  ['Table', (r) => r.tableNo ?? ''],
  ['Emplacement', (r) => r.slot ?? ''],
  ['Contre un animateur', (r) => (r.tableNo ? (r.vsAnimator ? 'oui' : 'non') : '')],
  ['Début de partie', (r) => formatDate(r.matchStartedAt)],
  ['Fin de partie', (r) => formatDate(r.matchEndedAt)],
  ['Goodies remis le', (r) => formatDate(r.goodiesGivenAt)],
];

function buildCsv(rows) {
  const lines = [COLUMNS.map(([title]) => escapeCell(title)).join(';')];
  for (const row of rows) lines.push(COLUMNS.map(([, get]) => escapeCell(get(row))).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

module.exports = { buildCsv, escapeCell, formatDate };
