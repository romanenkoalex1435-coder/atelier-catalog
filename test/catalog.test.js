import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProductFields, buildOrder } from '../lib/catalog.js';

const products = [{ id: 'jacket-1', title: 'Куртка', price: 4900, sizes: ['S', 'M'], category: 'Верхняя одежда', active: true }];

test('product fields require a valid title, price and sizes', () => {
  assert.deepEqual(parseProductFields('Куртка | 4900 | Верхняя одежда | S, M | Хорошее состояние'), {
    title: 'Куртка', price: 4900, category: 'Верхняя одежда', sizes: ['S', 'M'], description: 'Хорошее состояние'
  });
  assert.throws(() => parseProductFields('Куртка | free | Верхняя одежда | S | Текст'));
});

test('order uses catalog prices and rejects unavailable sizes', () => {
  const order = buildOrder({ customer: '@buyer', items: [{ id: 'jacket-1', size: 'M', quantity: 2 }] }, products);
  assert.equal(order.total, 9800);
  assert.equal(order.items[0].title, 'Куртка');
  assert.throws(() => buildOrder({ customer: '@buyer', items: [{ id: 'jacket-1', size: 'XL', quantity: 1 }] }, products));
});

test('order rejects unknown products and excessive quantities', () => {
  assert.throws(() => buildOrder({ customer: '@buyer', items: [{ id: 'missing', size: 'M', quantity: 1 }] }, products));
  assert.throws(() => buildOrder({ customer: '@buyer', items: [{ id: 'jacket-1', size: 'M', quantity: 99 }] }, products));
});
