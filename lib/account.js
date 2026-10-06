// Admin account: login, password hash, session secret and the IP allow-list.
// Stored as private settings (DATA_DIR/private/admin.json on the server, private/admin.json in the repo for the Vercel preview).
// Falls back to ADMIN_* environment variables when no file exists. Every change gets a new `version`, which ends all old sessions.
import { randomBytes } from 'node:crypto';
import { readPrivate, writePrivate } from './store.js';

const NAME = 'admin';
const TTL = 15_000;
let cache = null, cachedAt = 0;

const complete = account => Boolean(account?.login && account?.passwordHash && account?.sessionSecret && account.sessionSecret.length >= 32);

export async function loadAccount({ fresh = false } = {}) {
  if (!fresh && cachedAt && Date.now() - cachedAt < TTL) return cache;
  let stored = null;
  try { stored = await readPrivate(NAME); } catch (error) { console.error('Admin settings unavailable:', error.message); }
  const { ADMIN_LOGIN, ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET } = process.env;
  const fromEnv = { login: ADMIN_LOGIN, passwordHash: ADMIN_PASSWORD_HASH, sessionSecret: ADMIN_SESSION_SECRET, mustChange: false, allowedIps: [], version: 'env' };
  if (complete(stored)) cache = { allowedIps: [], mustChange: false, version: 'file', ...stored, source: 'file' };
  else if (complete(fromEnv)) cache = { ...fromEnv, source: 'env' };
  else cache = null;
  cachedAt = Date.now();
  return cache;
}

export async function saveAccount(next) {
  const { source, ...clean } = next;
  const saved = { ...clean, version: randomBytes(8).toString('hex'), updatedAt: new Date().toISOString() };
  await writePrivate(NAME, saved);
  cache = { ...saved, source: 'file' };
  cachedAt = Date.now();
  return cache;
}

export const newSessionSecret = () => randomBytes(32).toString('hex');

// A client address; on the standalone server x-forwarded-for is set (or overwritten) by server.mjs itself.
export function clientIp(req) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers?.['x-real-ip'] || '') || req.socket?.remoteAddress || 'unknown';
}

const normalise = ip => String(ip || '').replace(/^::ffff:/, '').trim();

// "85.140.12.7" matches exactly, "85.140.*" matches a range (handy for mobile operators)
export function validIpPattern(pattern) {
  const value = String(pattern || '').trim();
  return /^[0-9a-f:.]{2,45}$/i.test(value) || /^[0-9a-f:.]{1,44}\*$/i.test(value);
}

export function ipAllowed(account, ip) {
  const list = Array.isArray(account?.allowedIps) ? account.allowedIps : [];
  if (!list.length) return true;
  const address = normalise(ip);
  return list.some(pattern => (pattern.endsWith('*') ? address.startsWith(pattern.slice(0, -1)) : address === normalise(pattern)));
}
