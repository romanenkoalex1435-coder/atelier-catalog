import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, isOwner } from '../lib/telegram.js';

test('only configured owner can change catalog', () => {
  assert.equal(isOwner(123, '123'), true);
  assert.equal(isOwner(124, '123'), false);
  assert.equal(isOwner(123, ''), false);
});

test('photo caption parses a new product', () => {
  assert.deepEqual(parseCommand('/add Куртка | 4900 | Хорошее состояние'), {
    type: 'add', fields: { title: 'Куртка', price: 4900, description: 'Хорошее состояние' }
  });
});

test('edit and delete commands require safe product identifiers', () => {
  assert.equal(parseCommand('/delete abc-12').id, 'abc-12');
  assert.throws(() => parseCommand('/delete ../secret'));
  assert.equal(parseCommand('/edit abc-12 | Куртка | 5000 | Отличная').type, 'edit');
});
