import test from 'node:test';
import assert from 'node:assert/strict';
import login from '../api/admin/login.js';
import products from '../api/admin/products.js';
import { hashPassword } from '../lib/auth.js';

const res = () => ({ code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const env = { ADMIN_LOGIN: 'owner', ADMIN_PASSWORD_HASH: hashPassword('a-long-password'), ADMIN_SESSION_SECRET: 's'.repeat(40), GITHUB_TOKEN: 't', GITHUB_REPO: 'o/r' };
const json = { 'content-type': 'application/json', host: 'site.test' };

async function withEnv(fn) {
  const old = { ...process.env }, oldFetch = global.fetch;
  Object.assign(process.env, env);
  try { await fn(); } finally { global.fetch = oldFetch; for (const k of Object.keys(env)) old[k] === undefined ? delete process.env[k] : (process.env[k] = old[k]); }
}

async function session() {
  const r = res();
  await login({ method: 'POST', headers: { ...json, 'x-forwarded-for': '9.9.9.9' }, body: { login: 'owner', password: 'a-long-password' } }, r);
  assert.equal(r.code, 200);
  assert.match(r.headers['set-cookie'], /HttpOnly; Secure; SameSite=Strict/);
  return r.headers['set-cookie'].split(';')[0];
}

test('login rejects wrong credentials and unconfigured server', async () => {
  await withEnv(async () => {
    const r = res();
    await login({ method: 'POST', headers: { ...json, 'x-forwarded-for': '8.8.8.8' }, body: { login: 'owner', password: 'nope' } }, r);
    assert.equal(r.code, 401);
    delete process.env.ADMIN_LOGIN;
    const r2 = res();
    await login({ method: 'POST', headers: json, body: { login: 'owner', password: 'a-long-password' } }, r2);
    assert.equal(r2.code, 503);
  });
});

test('products API requires a session', async () => {
  await withEnv(async () => {
    const r = res();
    await products({ method: 'GET', headers: { host: 'site.test' }, query: {} }, r);
    assert.equal(r.code, 401);
  });
});

test('admin can add a product with a photo and commit goes to GitHub', async () => {
  await withEnv(async () => {
    const cookie = await session();
    const calls = [];
    const catalog = [{ id: 'demo', title: 'Старое', price: 100, description: '', image: '', active: true }];
    global.fetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
      if (url.endsWith('data/products.json') && !options.method) return { ok: true, json: async () => ({ sha: 'abc', content: Buffer.from(JSON.stringify(catalog)).toString('base64') }) };
      return { ok: true, json: async () => ({}) };
    };
    const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
    const r = res();
    await products({ method: 'POST', headers: { ...json, cookie, origin: 'https://site.test' }, query: {}, body: { title: 'Куртка', price: 4900, description: 'Ок', images: [jpeg, jpeg], notes: [{ x: 10, y: 20, img: 1, type: 'flaw', text: 'Пятно' }] } }, r);
    assert.equal(r.code, 200);
    assert.equal(r.body.products[0].title, 'Куртка');
    assert.match(r.body.products[0].image, /^\/images\/p-[a-z0-9-]+\.jpg$/);
    assert.equal(r.body.products[0].images.length, 2);
    assert.deepEqual(r.body.products[0].notes[0], { x: 10, y: 20, img: 1, type: 'flaw', text: 'Пятно' });
    assert.ok(calls.some(c => c.method === 'PUT' && c.url.includes('images/')));
    assert.ok(calls.some(c => c.method === 'PUT' && c.url.endsWith('data/products.json')));
  });
});

test('products API rejects cross-origin mutations and bad input', async () => {
  await withEnv(async () => {
    const cookie = await session();
    global.fetch = async () => ({ ok: true, json: async () => ({ sha: 'a', content: Buffer.from('[]').toString('base64') }) });
    const evil = res();
    await products({ method: 'POST', headers: { ...json, cookie, origin: 'https://evil.test' }, query: {}, body: { title: 'x', price: 1 } }, evil);
    assert.equal(evil.code, 403);
    const bad = res();
    await products({ method: 'POST', headers: { ...json, cookie }, query: {}, body: { title: '', price: -5 } }, bad);
    assert.equal(bad.code, 400);
  });
});

test('PUT keeps own photos, rejects foreign paths, toggles reserved', async () => {
  await withEnv(async () => {
    const cookie = await session();
    const catalog = [{ id: 'p-one', title: 'Куртка', price: 100, description: '', image: '/images/p-one.jpg', images: ['/images/p-one.jpg'], notes: [], active: true, sold: false }];
    global.fetch = async (url, options = {}) => {
      if (url.endsWith('data/products.json') && !options.method) return { ok: true, json: async () => ({ sha: 'abc', content: Buffer.from(JSON.stringify(catalog)).toString('base64') }) };
      return { ok: true, json: async () => ({}) };
    };
    const headers = { ...json, cookie };
    const ok = res();
    await products({ method: 'PUT', headers, query: { id: 'p-one' }, body: { reserved: true, images: ['/images/p-one.jpg'] } }, ok);
    assert.equal(ok.code, 200);
    assert.equal(ok.body.products[0].reserved, true);
    const foreign = res();
    await products({ method: 'PUT', headers, query: { id: 'p-one' }, body: { images: ['/images/other.jpg'] } }, foreign);
    assert.equal(foreign.code, 400);
  });
});
