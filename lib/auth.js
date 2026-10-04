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

export function createSession(secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(now / 1000) + SESSION_SECONDS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
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

export function authConfigured() {
  const { ADMIN_LOGIN, ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET } = process.env;
  return Boolean(ADMIN_LOGIN && ADMIN_PASSWORD_HASH && ADMIN_SESSION_SECRET && ADMIN_SESSION_SECRET.length >= 32);
}

// Mutations must come from our own origin as JSON (SameSite=Strict is the main CSRF defence).
export function sameOrigin(req) {
  const origin = req.headers?.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return false; } catch { return false; }
  }
  return String(req.headers?.['content-type'] || '').startsWith('application/json') || req.method === 'GET' || req.method === 'DELETE';
}

export function isAdmin(req) {
  return authConfigured() && verifySession(readCookie(req, COOKIE), process.env.ADMIN_SESSION_SECRET);
}

// Best-effort limiter per serverless instance: 5 failures per 15 minutes per IP.
const failures = new Map();
export function tooManyAttempts(ip, now = Date.now()) {
  const recent = (failures.get(ip) || []).filter(time => now - time < 15 * 60_000);
  failures.set(ip, recent);
  return recent.length >= 5;
}
export function recordFailure(ip, now = Date.now()) {
  failures.set(ip, [...(failures.get(ip) || []), now]);
}
export function clearFailures(ip) {
  failures.delete(ip);
}
