import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, hashPassword, verifyPassword, verifySession, tooManyAttempts, recordFailure, guardState } from '../lib/auth.js';
import { resetGuardForTests } from '../lib/guard.js';

test('password hash verifies only the right password', () => {
  const hash = hashPassword('correct horse battery');
  assert.equal(verifyPassword('correct horse battery', hash), true);
  assert.equal(verifyPassword('wrong', hash), false);
  assert.equal(verifyPassword('anything', ''), false);
});

test('session token is signed and expires', () => {
  const secret = 'x'.repeat(32), now = 1_700_000_000_000;
  const token = createSession(secret, now);
  assert.equal(verifySession(token, secret, now + 1000), true);
  assert.equal(verifySession(token, 'y'.repeat(32), now + 1000), false);
  assert.equal(verifySession(token, secret, now + 13 * 3600 * 1000), false);
  assert.equal(verifySession(token.replace(/.$/, c => (c === 'a' ? 'b' : 'a')), secret, now), false);
});

test('login is blocked after five failures', async () => {
  resetGuardForTests();
  for (let i = 0; i < 5; i++) await recordFailure('1.2.3.4', 1000);
  assert.equal(await tooManyAttempts('1.2.3.4', 2000), true);
  assert.equal(await tooManyAttempts('1.2.3.4', 1000 + 16 * 60_000), false);
});

test('15 failures in a day ban the IP for 24 hours', async () => {
  resetGuardForTests();
  const hour = 60 * 60_000;
  for (let round = 0; round < 3; round++) for (let i = 0; i < 5; i++) await recordFailure('2.2.2.2', round * hour + i);
  const state = await guardState('2.2.2.2', { now: 3 * hour });
  assert.equal(state.blocked, true);
  assert.equal(state.reason, 'day');
  assert.equal((await guardState('2.2.2.2', { now: 25 * hour })).blocked, false);
});

test('a distributed attack closes sign-in for everyone except the allow-listed owner', async () => {
  resetGuardForTests();
  for (let i = 0; i < 20; i++) await recordFailure(`3.3.${i}.1`, 1000);
  assert.equal((await guardState('9.9.9.9', { now: 2000 })).reason, 'global');
  assert.equal((await guardState('9.9.9.9', { trusted: true, now: 2000 })).blocked, false);
  assert.equal((await guardState('9.9.9.9', { now: 1000 + 16 * 60_000 })).blocked, false);
});
