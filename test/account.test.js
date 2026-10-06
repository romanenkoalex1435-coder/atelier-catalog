import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hashPassword } from '../lib/auth.js';
import { writePrivate } from '../lib/fs-store.js';
import { ipAllowed, loadAccount, validIpPattern } from '../lib/account.js';
import login from '../api/admin/login.js';
import account from '../api/admin/account.js';
import products from '../api/admin/products.js';

const res = () => ({ code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const json = ip => ({ 'content-type': 'application/json', host: 'site.test', 'x-forwarded-for': ip });
const cookieOf = r => r.headers['set-cookie'].split(';')[0];

async function setup(extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rewear-acc-'));
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await writeFile(path.join(dir, 'data/products.json'), '[]');
  Object.assign(process.env, { STORAGE: 'fs', DATA_DIR: dir });
  for (const key of ['ADMIN_LOGIN', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET']) delete process.env[key];
  await writePrivate('admin', { login: 'rewear', passwordHash: hashPassword('temp-pass-12345'), sessionSecret: 's'.repeat(64), mustChange: true, allowedIps: [], version: 'v1', ...extra });
  await loadAccount({ fresh: true });
  return dir;
}

async function signIn(ip, loginName = 'rewear', password = 'temp-pass-12345') {
  const r = res();
  await login({ method: 'POST', headers: json(ip), body: { login: loginName, password } }, r);
  return r;
}

test('IP patterns: exact address and a range', () => {
  assert.equal(validIpPattern('85.140.12.7'), true);
  assert.equal(validIpPattern('85.140.*'), true);
  assert.equal(validIpPattern('85.140.12.7; rm'), false);
  assert.equal(ipAllowed({ allowedIps: [] }, '1.2.3.4'), true);
  assert.equal(ipAllowed({ allowedIps: ['85.140.*'] }, '85.140.9.9'), true);
  assert.equal(ipAllowed({ allowedIps: ['85.140.*'] }, '::ffff:85.140.9.9'), true);
  assert.equal(ipAllowed({ allowedIps: ['10.0.0.1'] }, '10.0.0.2'), false);
});

test('temporary password: products are locked until it is changed, then old sessions stop working', async () => {
  const dir = await setup();
  const first = await signIn('7.7.7.1');
  assert.equal(first.code, 200);
  assert.equal(first.body.mustChange, true);
  const oldCookie = cookieOf(first);
  const locked = res();
  await products({ method: 'GET', headers: { host: 'site.test', cookie: oldCookie, 'x-forwarded-for': '7.7.7.1' }, query: {} }, locked);
  assert.equal(locked.code, 403);

  const weak = res();
  await account({ method: 'PUT', headers: { ...json('7.7.7.1'), cookie: oldCookie }, body: { currentPassword: 'temp-pass-12345', login: 'owner', password: 'short' } }, weak);
  assert.equal(weak.code, 400);

  const changed = res();
  await account({ method: 'PUT', headers: { ...json('7.7.7.1'), cookie: oldCookie }, body: { currentPassword: 'temp-pass-12345', login: 'owner', password: 'my-new-long-password' } }, changed);
  assert.equal(changed.code, 200);
  const stored = JSON.parse(await readFile(path.join(dir, 'private/admin.json'), 'utf8'));
  assert.equal(stored.login, 'owner');
  assert.equal(stored.mustChange, false);
  assert.ok(!JSON.stringify(stored).includes('my-new-long-password'));

  const stale = res();
  await products({ method: 'GET', headers: { host: 'site.test', cookie: oldCookie, 'x-forwarded-for': '7.7.7.1' }, query: {} }, stale);
  assert.equal(stale.code, 401);
  const fresh = res();
  await products({ method: 'GET', headers: { host: 'site.test', cookie: cookieOf(changed), 'x-forwarded-for': '7.7.7.1' }, query: {} }, fresh);
  assert.equal(fresh.code, 200);
  assert.equal((await signIn('7.7.7.1')).code, 401);
  assert.equal((await signIn('7.7.7.1', 'owner', 'my-new-long-password')).code, 200);
});

test('IP allow-list blocks sign-in and sessions from other addresses and refuses to lock the owner out', async () => {
  await setup({ mustChange: false });
  const ok = await signIn('8.8.8.1');
  const cookie = cookieOf(ok);
  const lockout = res();
  await account({ method: 'PUT', headers: { ...json('8.8.8.1'), cookie }, body: { currentPassword: 'temp-pass-12345', allowedIps: ['9.9.9.9'] } }, lockout);
  assert.equal(lockout.code, 400);
  const set = res();
  await account({ method: 'PUT', headers: { ...json('8.8.8.1'), cookie }, body: { currentPassword: 'temp-pass-12345', allowedIps: ['8.8.8.*'] } }, set);
  assert.equal(set.code, 200);
  assert.equal((await signIn('5.5.5.5')).code, 403);
  assert.equal((await signIn('8.8.8.20')).code, 200);
  const elsewhere = res();
  await products({ method: 'GET', headers: { host: 'site.test', cookie: cookieOf(set), 'x-forwarded-for': '5.5.5.5' }, query: {} }, elsewhere);
  assert.equal(elsewhere.code, 401);
});

test('five wrong passwords block the IP', async () => {
  await setup({ mustChange: false });
  for (let i = 0; i < 5; i++) assert.equal((await signIn('6.6.6.6', 'rewear', 'wrong')).code, 401);
  const blocked = await signIn('6.6.6.6');
  assert.equal(blocked.code, 429);
  assert.match(blocked.body.error, /мин/);
  assert.equal((await signIn('6.6.6.7')).code, 200);
});
