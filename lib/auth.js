import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_SECONDS = 12 * 60 * 60;
export const COOKIE = 'admin_session';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password, stored = '') {
  const [scheme, salt, hash] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(String(password), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function sign(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

// `version` ties the session to the current account state: after a password or login change old sessions stop working
export function createSession(secret, now = Date.now(), version = '') {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_SECONDS, v: version })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function sessionVersion(token) {
  try { return JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString()).v ?? ''; } catch { return null; }
}

export function verifySession(token, secret, now = Date.now()) {
  if (!token || !secret) return false;
  const [payload, signature] = String(token).split('.');
  if (!payload || !signature) return false;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Math.floor(now / 1000);
  } catch {
    return false;
  }
}

export function readCookie(req, name) {
  for (const part of String(req.headers?.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return '';
}

export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${token ? SESSION_SECONDS : 0}`;
}


// Mutations must come from our own origin as JSON (SameSite=Strict is the main CSRF defence).
export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; }
  }
  return String(req.headers?.['content-type'] || '').startsWith('application/json') || req.method === 'GET' || req.method === 'DELETE';
}

// Checks the session cookie against the current account and the IP allow-list. Returns the account or null.
export async function adminSession(req) {
  const { loadAccount, ipAllowed, clientIp } = await import('./account.js');
  const account = await loadAccount();
  if (!account) return null;
  const token = readCookie(req, COOKIE);
  if (!verifySession(token, account.sessionSecret) || sessionVersion(token) !== account.version) return null;
  if (!ipAllowed(account, clientIp(req))) return null;
  return account;
}

// Brute-force protection (see lib/guard.js): per-IP lock-out, a 24-hour ban for persistent attempts and a global lock.
export { attemptsLeft, clearFailures, guardState, minutesUntilUnlock, recordFailure, tooManyAttempts, MAX_FAILURES } from './guard.js';
