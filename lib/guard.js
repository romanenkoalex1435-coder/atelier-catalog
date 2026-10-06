// Brute-force protection for the admin sign-in.
//  - per IP: 5 wrong passwords in 15 minutes lock that IP for 15 minutes;
//  - per IP: 15 wrong passwords in 24 hours ban that IP for 24 hours;
//  - globally: 20 wrong passwords from any addresses in 15 minutes close the sign-in for 15 minutes
//    (addresses on the owner's allow-list still get in, so an attacker cannot lock the owner out);
//  - every wrong attempt from an IP makes its next answer slower (up to 4 s).
// On the standalone server (STORAGE=fs) the counters are saved to DATA_DIR/private/throttle.json and survive restarts;
// on Vercel they live in the memory of each running function.
import { readPrivate, writePrivate } from './store.js';

export const MAX_FAILURES = 5;
const SHORT = 15 * 60_000, LONG = 24 * 60 * 60_000, LONG_LIMIT = 15, GLOBAL_LIMIT = 20;
let state = { ips: {}, all: [] };
let loaded = false;

const persistent = () => process.env.STORAGE === 'fs';

async function load() {
  if (loaded) return;
  loaded = true;
  if (!persistent()) return;
  try { const saved = await readPrivate('throttle'); if (saved?.ips && Array.isArray(saved.all)) state = saved; } catch { /* start clean */ }
}

function prune(now) {
  for (const [ip, times] of Object.entries(state.ips)) {
    const kept = times.filter(time => now - time < LONG);
    if (kept.length) state.ips[ip] = kept; else delete state.ips[ip];
  }
  state.all = state.all.filter(time => now - time < SHORT);
}

async function save() {
  if (persistent()) await writePrivate('throttle', state).catch(error => console.error('Throttle save failed:', error.message));
}

// { blocked, minutes, reason } for this IP right now; `trusted` = the IP is on the owner's allow-list
export async function guardState(ip, { trusted = false, now = Date.now() } = {}) {
  await load();
  prune(now);
  const times = state.ips[ip] || [];
  const recent = times.filter(time => now - time < SHORT);
  if (times.length >= LONG_LIMIT) {
    const until = times[times.length - LONG_LIMIT] + LONG;
    return { blocked: true, minutes: Math.ceil((until - now) / 60_000), reason: 'day' };
  }
  if (recent.length >= MAX_FAILURES) return { blocked: true, minutes: Math.max(1, Math.ceil((recent[recent.length - MAX_FAILURES] + SHORT - now) / 60_000)), reason: 'ip' };
  if (!trusted && state.all.length >= GLOBAL_LIMIT) return { blocked: true, minutes: Math.max(1, Math.ceil((state.all[state.all.length - GLOBAL_LIMIT] + SHORT - now) / 60_000)), reason: 'global' };
  return { blocked: false, minutes: 0, reason: '', delay: Math.min(4000, recent.length * 800) };
}

export async function recordFailure(ip, now = Date.now()) {
  await load();
  (state.ips[ip] ||= []).push(now);
  state.all.push(now);
  prune(now);
  await save();
}

export async function clearFailures(ip) {
  await load();
  if (state.ips[ip]) { delete state.ips[ip]; await save(); }
}

// compatibility helpers
export async function tooManyAttempts(ip, now = Date.now()) { return (await guardState(ip, { trusted: true, now })).blocked; }
export async function minutesUntilUnlock(ip, now = Date.now()) { return (await guardState(ip, { trusted: true, now })).minutes; }
export async function attemptsLeft(ip, now = Date.now()) {
  await load();
  return Math.max(0, MAX_FAILURES - (state.ips[ip] || []).filter(time => now - time < SHORT).length);
}

export function resetGuardForTests() { state = { ips: {}, all: [] }; loaded = false; }
