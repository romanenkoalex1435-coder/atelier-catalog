import test from 'node:test';
import assert from 'node:assert/strict';
import share from '../api/share.js';

const res = () => ({ code: 200, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } });
const products = [{ id: 'p-1', title: 'Куртка <b>', price: 4900, brand: 'Wrangler', era: '1990-е', image: '/images/p-1.jpg', images: ['/images/p-1.jpg'], active: true }];

test('share page carries Open Graph tags and escapes content', async () => {
  const old = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => products });
  try {
    const r = res();
    await share({ query: { id: 'p-1' }, headers: { host: 'site.test', 'x-forwarded-proto': 'https' } }, r);
    assert.match(r.body, /og:image" content="https:\/\/site.test\/images\/p-1.jpg"/);
    assert.match(r.body, /4[\s ]900 ₽/);
    assert.ok(!r.body.includes('<b>'));
    assert.match(r.body, /url=\/\?product=p-1/);
  } finally { global.fetch = old; }
});

test('unknown or unsafe ids fall back to the site preview', async () => {
  const old = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => products });
  try {
    for (const id of ['nope', '../x']) {
      const r = res();
      await share({ query: { id }, headers: { host: 'site.test' } }, r);
      assert.match(r.body, /og:image" content="https:\/\/site.test\/og.jpg"/);
      assert.match(r.body, /url=\//);
    }
  } finally { global.fetch = old; }
});
