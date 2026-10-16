'use strict';

// Authentification de l'accueil : un mot de passe unique, un cookie signé (HMAC).
// Le mot de passe entre dans la clé de signature : le changer déconnecte toutes les sessions.

const crypto = require('crypto');

const COOKIE_NAME = 'rb_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
// Par connexion TCP (le proxy, ou le client en accès direct) : borne aussi les essais d'un client
// qui ferait varier X-Forwarded-For. Derrière le proxy, c'est un plafond toutes IP confondues.
const LOGIN_MAX_ATTEMPTS_PER_PEER = 50;
// Nombre de compteurs suivis au plus : mémoire et temps de purge bornés.
const LOGIN_MAX_TRACKED = 10000;

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

// Deux rôles : « admin » (accueil, mot de passe ACCUEIL_PASSWORD, accès à tout) et « boutique »
// (remise des cartes promo, mot de passe BOUTIQUE_PASSWORD facultatif). Chaque rôle a sa propre clé
// de signature : changer un mot de passe ne déconnecte que les sessions de ce rôle.
function createAuth({ password, boutiquePassword = null, secret, now = () => Date.now() }) {
  if (!password) throw new Error('Mot de passe de l’accueil manquant.');
  const keys = { admin: sha256(`${secret}:${password}`) };
  if (boutiquePassword && boutiquePassword !== password) {
    keys.boutique = sha256(`${secret}:boutique:${boutiquePassword}`);
  }
  const sign = (role, payload) => crypto.createHmac('sha256', keys[role]).update(payload).digest('base64url');
  const attempts = new Map();

  function issueToken(role = 'admin') {
    if (!keys[role]) throw new Error(`Rôle inconnu : ${role}`);
    const expires = now() + SESSION_TTL_MS;
    const payload = `${role}.${expires}`;
    return `${payload}.${sign(role, payload)}`;
  }

  // Rôle porté par un jeton valide (« admin » ou « boutique »), sinon null.
  function roleOfToken(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3 || !Object.prototype.hasOwnProperty.call(keys, parts[0])) return null;
    const expires = Number(parts[1]);
    if (!Number.isFinite(expires) || expires < now()) return null;
    const expected = Buffer.from(sign(parts[0], `${parts[0]}.${parts[1]}`));
    const given = Buffer.from(parts[2]);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? parts[0] : null;
  }

  function verifyToken(token) {
    return roleOfToken(token) === 'admin';
  }

  const matches = (candidate, secretValue) =>
    crypto.timingSafeEqual(sha256(candidate ?? ''), sha256(secretValue));

  function checkPassword(candidate) {
    return matches(candidate, password);
  }

  // Rôle donné par un mot de passe (les deux comparaisons sont toujours faites), sinon null.
  function roleForPassword(candidate) {
    const admin = matches(candidate, password);
    const boutique = keys.boutique ? matches(candidate, boutiquePassword) : false;
    if (admin) return 'admin';
    return boutique ? 'boutique' : null;
  }

  function roleOf(cookieHeader) {
    return roleOfToken(parseCookies(cookieHeader)[COOKIE_NAME]);
  }

  function isAuthenticated(cookieHeader) {
    return roleOf(cookieHeader) === 'admin';
  }

  function bump(key, t, max) {
    let entry = attempts.get(key);
    if (!entry) {
      if (attempts.size >= LOGIN_MAX_TRACKED) return false;
      entry = { count: 0, resetAt: t + LOGIN_WINDOW_MS };
      attempts.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= max;
  }

  // Limite les essais de mot de passe par adresse IP du client et par connexion (`peer`).
  function allowAttempt(ip, peer = ip) {
    const t = now();
    // Compteurs rangés par date de création : on s'arrête au premier encore valable.
    for (const [k, v] of attempts) {
      if (v.resetAt > t) break;
      attempts.delete(k);
    }
    const ipOk = bump(`ip:${ip}`, t, LOGIN_MAX_ATTEMPTS);
    const peerOk = peer === ip || bump(`peer:${peer}`, t, LOGIN_MAX_ATTEMPTS_PER_PEER);
    return ipOk && peerOk;
  }

  function resetAttempts(ip) {
    attempts.delete(`ip:${ip}`);
  }

  function cookieHeader(token, { secure }) {
    const attrs = [
      `${COOKIE_NAME}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
  }

  function clearCookieHeader({ secure }) {
    const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
    if (secure) attrs.push('Secure');
    return attrs.join('; ');
  }

  return {
    issueToken,
    verifyToken,
    roleOfToken,
    checkPassword,
    roleForPassword,
    roleOf,
    isAuthenticated,
    hasBoutiqueRole: Boolean(keys.boutique),
    allowAttempt,
    resetAttempts,
    cookieHeader,
    clearCookieHeader,
  };
}

module.exports = {
  createAuth,
  parseCookies,
  COOKIE_NAME,
  LOGIN_MAX_ATTEMPTS,
  LOGIN_MAX_ATTEMPTS_PER_PEER,
  LOGIN_MAX_TRACKED,
};
