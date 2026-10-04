import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, hashPassword, verifyPassword, verifySession, tooManyAttempts, recordFailure } from '../lib/auth.js';

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

test('login is blocked after five failures', () => {
  for (let i = 0; i < 5; i++) recordFailure('1.2.3.4', 1000);
  assert.equal(tooManyAttempts('1.2.3.4', 2000), true);
  assert.equal(tooManyAttempts('1.2.3.4', 1000 + 16 * 60_000), false);
});
