import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// BASE_URL must point to an isolated staging deployment; these tests create and delete products.
const base = process.env.BASE_URL;
const origin = process.env.SITE_ORIGIN || (base ? new URL(base).origin : 'https://rewearvintage.shop');
const login = process.env.PHP_TEST_LOGIN;
const password = process.env.PHP_TEST_PASSWORD;
let cookie = '';
async function req(path, method = 'GET', body, headers = {}) {
  return reqRaw(path, method, body === undefined ? undefined : JSON.stringify(body), headers);
}
async function reqRaw(path, method, body, headers = {}) {
  const r = await fetch(new URL(path, base), { method, redirect: 'manual', headers: {
    'content-type': 'application/json', origin, ...(cookie ? { cookie } : {}), ...headers,
  }, body });
  const raw = await r.text(); let data; try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: r.status, headers: r.headers, data };
}
test('PHP 8.2 source parses (requires PHP_BIN or php)', { skip: !!base }, () => {
  for (const name of ['backend.php', 'index.php', 'router.php', 'init-account.php']) {
    const p = spawnSync(process.env.PHP_BIN || 'php', ['-l', new URL(`../php/${name}`, import.meta.url).pathname], { encoding: 'utf8' });
    assert.equal(p.status, 0, p.error?.message || p.stdout + p.stderr);
  }
});
test('PHP HTTP auth, catalog, account and security contracts', { skip: !base }, async t => {
  assert.ok(login && password, 'Set PHP_TEST_LOGIN and PHP_TEST_PASSWORD for isolated staging');
  cookie = '';
  assert.equal((await req('/api/admin/products')).status, 401);
  assert.equal((await req('/api/admin/login', 'POST', { login, password }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await req('/api/admin/login', 'POST', { login, password }, { origin: origin.replace('https:', 'http:') })).status, 403);
  const oversized = { login, password, padding: 'x'.repeat(16_384) };
  const rejectedLogin = await req('/api/admin/login', 'POST', oversized);
  assert.equal(rejectedLogin.status, 413);
  assert.match(rejectedLogin.data.error, /слишком большой/);
  for (const raw of ['[]', 'null', '{broken']) {
    assert.equal((await reqRaw('/api/admin/login', 'POST', raw)).status, 400);
  }
  const loginJson = JSON.stringify({ login, password });
  assert.ok(Buffer.byteLength(loginJson) <= 16_384);
  const signed = await reqRaw('/api/admin/login', 'POST', loginJson + ' '.repeat(16_384 - Buffer.byteLength(loginJson)));
  assert.equal(signed.status, 200, JSON.stringify(signed.data));
  const header = signed.headers.get('set-cookie');
  for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/admin']) assert.ok(header.includes(part));
  cookie = header.split(';')[0];
  const initialCookie = cookie;
  assert.equal((await req('/api/admin/products')).status, 200);
  assert.equal((await req('/api/admin/account')).data.login, login);
  const rejectedAccount = await req('/api/admin/account', 'PUT', { currentPassword: password, padding: 'x'.repeat(16_384) });
  assert.equal(rejectedAccount.status, 413);
  assert.match(rejectedAccount.data.error, /слишком большой/);
  for (const raw of ['[]', 'null', '{broken']) {
    assert.equal((await reqRaw('/api/admin/account', 'PUT', raw)).status, 400);
  }
  assert.equal((await req('/api/admin/account', 'PUT', { currentPassword: password, allowedIps: ['bad-address'] })).status, 400);
  assert.equal((await req('/api/admin/account', 'PUT', { currentPassword: password, allowedIps: ['192.0.2.240'] })).status, 400);
  assert.equal((await req('/api/admin/products', 'POST', { title: 'test', price: 1.5 })).status, 400);
  assert.equal((await req('/api/admin/products', 'POST', { title: 'test', price: 1, images: ['data:image/jpeg;base64,/9g='] })).status, 400);
  // Actual project JPEG fixture, validated by PHP's getimagesizefromstring, not a magic-byte stub.
  const jpeg = readFileSync(new URL('../og.jpg', import.meta.url));
  const image = 'data:image/jpeg;base64,' + jpeg.toString('base64');
  const preview = 'data:image/webp;base64,' + readFileSync(new URL('../images/preview/demo-01.webp', import.meta.url)).toString('base64');
  const title = 'PHP staging check ' + Date.now();
  const created = await req('/api/admin/products', 'POST', { title, price: 2190, description: 'Проверка', category: 'Аксессуары', padding: 'x'.repeat(16_384), images: [image], preview, notes: [{ x: 10, y: 20, text: 'Деталь', img: 0 }] });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const product = created.data.products.find(p => p.title === title); assert.ok(product);
  try {
    const fetched = await req(product.image); assert.equal(fetched.status, 200);
    assert.equal(fetched.headers.get('content-type'), 'image/jpeg');
    assert.equal((await req(product.preview)).headers.get('content-type'), 'image/webp');
    const cutout = await req('/api/admin/products?id=' + product.id, 'PUT', { preview: '' }); assert.equal(cutout.status, 200);
    assert.equal((await req(product.preview)).status, 404);
    assert.equal((await req('/p/' + product.id)).status, 200);
    assert.ok((await req('/sitemap.xml')).data.includes('/p/' + product.id));
    assert.equal((await req('/api/admin/products?id=' + product.id, 'PUT', { title: 'hacked' }, { origin: 'https://evil.example' })).status, 403);
    assert.equal((await req('/api/admin/products?id=' + product.id, 'DELETE', undefined, { origin: 'https://evil.example' })).status, 403);
    const updates = await Promise.all([
      req('/api/admin/products?id=' + product.id, 'PUT', { sold: true }),
      req('/api/admin/products?id=' + product.id, 'PUT', { reserved: true }),
    ]);
    assert.ok(updates.every(r => r.status === 200));
    const changed = (await req('/api/admin/products')).data.products.find(p => p.id === product.id);
    assert.equal(changed.sold, true); assert.equal(changed.reserved, true);
    assert.ok(!(await req('/sitemap.xml')).data.includes('/p/' + product.id));
    await req('/api/admin/products?id=' + product.id, 'PUT', { active: false });
    assert.ok(!(await req('/data/products.json')).data.some(p => p.id === product.id));
    assert.ok(!(await req('/p/' + product.id)).data.includes(title));
    const save = await req('/api/admin/account', 'PUT', { currentPassword: password, login, allowedIps: [] });
    assert.equal(save.status, 200, JSON.stringify(save.data));
    cookie = save.headers.get('set-cookie').split(';')[0];
    assert.equal((await req('/api/admin/products', 'GET', undefined, { cookie: initialCookie })).status, 401);
    for (const path of ['/private/admin.json', '/php/backend.php', '/lib/auth.js', '/.git/config', '/images/../private/admin.json', '/images/%2e%2e/private/admin.json', '/images/preview/../../private/admin.json', '/work/secret', '/api/admin/unknown']) {
      const response = await req(path); assert.ok([403, 404].includes(response.status), path + ': ' + response.status);
    }
  } finally {
    const deleted = await req('/api/admin/products?id=' + product.id, 'DELETE'); assert.equal(deleted.status, 200);
    assert.equal((await req(product.image)).status, 404);
  }
  assert.equal((await req('/api/admin/logout', 'POST')).status, 200);
  cookie = ''; assert.equal((await req('/api/admin/products')).status, 401);
});

test('persistent per-IP throttle blocks the sixth incorrect login', { skip: !base || process.env.PHP_TEST_THROTTLE !== '1' }, async () => {
  // Run last, only against isolated staging: this intentionally locks the staging client for 15 minutes.
  cookie = '';
  const signed = await req('/api/admin/login', 'POST', { login, password });
  assert.equal(signed.status, 200);
  cookie = signed.headers.get('set-cookie').split(';')[0];
  for (let i = 0; i < 5; i++) {
    const r = await req('/api/admin/login', 'POST', { login, password: 'incorrect-PHP-test-password' });
    assert.equal(r.status, 401, JSON.stringify(r.data));
  }
  assert.equal((await req('/api/admin/login', 'POST', { login, password })).status, 429);
  for (const raw of ['[]', '{broken', JSON.stringify({ padding: 'x'.repeat(16_384) })]) {
    assert.equal((await reqRaw('/api/admin/login', 'POST', raw)).status, 429);
    assert.equal((await reqRaw('/api/admin/account', 'PUT', raw)).status, 429);
  }
});
