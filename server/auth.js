'use strict';

// Authentification de l'accueil : un mot de passe unique, un cookie signé (HMAC).
// Le mot de passe entre dans la clé de signature : le changer déconnecte toutes les sessions.

const crypto = require('crypto');

const COOKIE_NAME = 'rb_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

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

function createAuth({ password, secret, now = () => Date.now() }) {
  if (!password) throw new Error('Mot de passe de l’accueil manquant.');
  const key = sha256(`${secret}:${password}`);
  const sign = (payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url');
  const attempts = new Map();

  function issueToken() {
    const expires = now() + SESSION_TTL_MS;
    const payload = `admin.${expires}`;
    return `${payload}.${sign(payload)}`;
  }

  function verifyToken(token) {
    if (typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'admin') return false;
    const expires = Number(parts[1]);
    if (!Number.isFinite(expires) || expires < now()) return false;
    const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
    const given = Buffer.from(parts[2]);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  function checkPassword(candidate) {
    return crypto.timingSafeEqual(sha256(candidate ?? ''), sha256(password));
  }

  function isAuthenticated(cookieHeader) {
    return verifyToken(parseCookies(cookieHeader)[COOKIE_NAME]);
  }

  // Limite les essais de mot de passe par adresse IP.
  function allowAttempt(ip) {
    const t = now();
    for (const [k, v] of attempts) if (v.resetAt <= t) attempts.delete(k);
    const entry = attempts.get(ip) || { count: 0, resetAt: t + LOGIN_WINDOW_MS };
    entry.count += 1;
    attempts.set(ip, entry);
    return entry.count <= LOGIN_MAX_ATTEMPTS;
  }

  function resetAttempts(ip) {
    attempts.delete(ip);
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
    checkPassword,
    isAuthenticated,
    allowAttempt,
    resetAttempts,
    cookieHeader,
    clearCookieHeader,
  };
}

module.exports = { createAuth, parseCookies, COOKIE_NAME };
