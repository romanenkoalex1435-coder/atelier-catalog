import test from 'node:test';
import assert from 'node:assert/strict';
import { assertId, decodeImage, validateNotes, validateProduct } from '../lib/catalog.js';

test('product fields require a valid title and price', () => {
  assert.deepEqual(validateProduct({ title: ' Куртка ', price: '4900', description: 'Ок' }), { title: 'Куртка', price: 4900, description: 'Ок', brand: '', era: '', origin: '', condition: '', measures: '' });
  assert.equal(validateProduct({ title: 'Куртка', price: 1, era: ' 1990-е ' }).era, '1990-е');
  assert.throws(() => validateProduct({ title: 'Куртка', price: 1, era: 'x'.repeat(41) }));
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

test('photo notes are validated and rounded', () => {
  assert.deepEqual(validateNotes([{ x: 12.34, y: 99, text: ' Заплатка ' }]), [{ x: 12.3, y: 99, img: 0, type: 'detail', text: 'Заплатка' }]);
  assert.throws(() => validateNotes([{ x: 1, y: 1, img: 3, text: 'a' }], 2));
  assert.throws(() => validateNotes([{ x: 101, y: 1, text: 'a' }]));
  assert.throws(() => validateNotes([{ x: 1, y: 1, text: '' }]));
  assert.throws(() => validateNotes(Array(13).fill({ x: 1, y: 1, text: 'a' })));
});
