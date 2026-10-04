import test from 'node:test';
import assert from 'node:assert/strict';
import { assertId, decodeImage, validateProduct } from '../lib/catalog.js';

test('product fields require a valid title and price', () => {
  assert.deepEqual(validateProduct({ title: ' Куртка ', price: '4900', description: 'Ок' }), { title: 'Куртка', price: 4900, description: 'Ок' });
  assert.throws(() => validateProduct({ title: 'Куртка', price: 0 }));
  assert.throws(() => validateProduct({ title: '', price: 100 }));
});

test('images must be real JPEGs and ids must be safe', () => {
  assert.throws(() => decodeImage('data:image/png;base64,AAAA'));
  assert.throws(() => decodeImage('data:image/jpeg;base64,AAAA'));
  assert.equal(decodeImage('data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 1]).toString('base64')).length, 3);
  assert.throws(() => assertId('../secret'));
  assert.equal(assertId('p-abc1'), 'p-abc1');
});
