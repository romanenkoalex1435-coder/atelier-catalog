import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const helper = new URL('../php/verify-scrypt.cjs', import.meta.url).pathname;
const salt = '0123456789abcdef0123456789abcdef';
const password = 'Migration-Secret-7z!';
const hash = 'scrypt$' + salt + '$' + scryptSync(password, salt, 64).toString('hex');
function verify(input) {
  return spawnSync(process.execPath, [helper], { input: JSON.stringify(input), encoding: 'utf8' });
}
test('legacy helper verifies actual Node scrypt hash using stdin', () => {
  const result = verify({ password, hash });
  assert.equal(result.status, 0); assert.equal(result.stdout, 'OK'); assert.equal(result.stderr, '');
});
test('legacy helper rejects wrong password without leaking input', () => {
  const result = verify({ password: 'wrong-secret', hash });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});
test('legacy helper rejects malformed hash rather than throwing public detail', () => {
  for (const hash of ['scrypt$bad$00', 'argon2id$test', null]) {
    const result = verify({ password, hash });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  }
});
