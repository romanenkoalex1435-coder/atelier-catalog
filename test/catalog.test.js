import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductFields } from '../lib/catalog.js';

test('product fields require a valid title, price and description', () => {
  assert.deepEqual(parseProductFields('Куртка | 4900 | Хорошее состояние'), { title: 'Куртка', price: 4900, description: 'Хорошее состояние' });
  assert.throws(() => parseProductFields('Куртка | 0 | Хорошее состояние'));
  assert.throws(() => parseProductFields('Куртка | 4900'));
  assert.throws(() => parseProductFields('Куртка | 4900 | Описание | лишнее'));
});
