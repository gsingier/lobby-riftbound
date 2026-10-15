'use strict';

// Limitation des essais de connexion (server/auth.js), horloge injectée.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAuth, LOGIN_MAX_ATTEMPTS, LOGIN_MAX_ATTEMPTS_PER_PEER, LOGIN_MAX_TRACKED } = require('../server/auth');

const MIN = 60 * 1000;

function setup() {
  const clock = { t: Date.UTC(2026, 9, 28, 8, 0, 0) };
  const auth = createAuth({ password: 'test', secret: 'secret', now: () => clock.t });
  return { clock, auth };
}

test('essais par IP client et par connexion : la première limite atteinte bloque', () => {
  const { auth, clock } = setup();
  // même IP : 10 essais, puis bloqué
  for (let i = 0; i < LOGIN_MAX_ATTEMPTS; i++) assert.equal(auth.allowAttempt('1.1.1.1'), true);
  assert.equal(auth.allowAttempt('1.1.1.1'), false);
  assert.equal(auth.allowAttempt('2.2.2.2'), true, 'une autre IP n’est pas touchée');

  // X-Forwarded-For différent à chaque essai, même connexion TCP : bloqué au-delà du plafond
  clock.t += 5 * MIN;
  for (let i = 0; i < LOGIN_MAX_ATTEMPTS_PER_PEER; i++) assert.equal(auth.allowAttempt(`10.0.0.${i}`, '9.9.9.9'), true);
  assert.equal(auth.allowAttempt('10.1.0.1', '9.9.9.9'), false);
  assert.equal(auth.allowAttempt('10.1.0.2', '8.8.8.8'), true, 'une autre connexion n’est pas touchée');

  // une connexion réussie remet à zéro le compteur de l'IP, pas celui de la connexion
  auth.resetAttempts('10.1.0.1');
  assert.equal(auth.allowAttempt('10.1.0.1', '9.9.9.9'), false);
  clock.t += 5 * MIN;
  assert.equal(auth.allowAttempt('10.1.0.1', '9.9.9.9'), true, 'fenêtre de 5 minutes écoulée');
});

test('nombre de compteurs borné : au-delà, les nouvelles adresses sont refusées jusqu’à la purge', () => {
  const { auth, clock } = setup();
  for (let i = 0; i < LOGIN_MAX_TRACKED; i++) auth.allowAttempt(`ip-${i}`);
  assert.equal(auth.allowAttempt('nouvelle'), false);
  assert.equal(auth.allowAttempt('ip-0'), true, 'une adresse déjà suivie garde son compteur');
  clock.t += 5 * MIN;
  assert.equal(auth.allowAttempt('nouvelle'), true, 'les compteurs expirés sont purgés');
});
