import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as disk from '../lib/fs-store.js';
import sitemap from '../api/sitemap.js';

async function withDataDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'rewear-'));
  await mkdir(path.join(dir, 'data'), { recursive: true });
  await writeFile(path.join(dir, 'data/products.json'), JSON.stringify([{ id: 'p-1', title: 'Куртка', price: 1, active: true }, { id: 'p-2', title: 'Скрыто', price: 1, active: false }]));
  const old = { ...process.env };
  Object.assign(process.env, { STORAGE: 'fs', DATA_DIR: dir });
  try { await fn(dir); } finally { for (const key of ['STORAGE', 'DATA_DIR', 'PUBLIC_SITE_URL']) old[key] === undefined ? delete process.env[key] : (process.env[key] = old[key]); }
}

test('disk storage saves the catalog and refuses a stale write', async () => {
  await withDataDir(async dir => {
    const { sha, products } = await disk.getCatalog();
    products[0].price = 5;
    await disk.saveCatalog(products, sha);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'data/products.json'), 'utf8'))[0].price, 5);
    await assert.rejects(() => disk.saveCatalog(products, sha), /изменился/);
  });
});

test('disk storage writes and deletes photos only inside images/', async () => {
  await withDataDir(async dir => {
    const photo = await disk.savePhoto('p-1-a', Buffer.from([0xff, 0xd8, 1]));
    const preview = await disk.savePreview('p-1-b', Buffer.from('x'), 'webp');
    assert.equal(photo, '/images/p-1-a.jpg');
    await access(path.join(dir, 'images/preview/p-1-b.webp'));
    await disk.deletePhoto(preview);
    await assert.rejects(() => access(path.join(dir, 'images/preview/p-1-b.webp')));
    await disk.deletePhoto('/../data/products.json');
    await access(path.join(dir, 'data/products.json'));
  });
});

test('sitemap lists the home page and visible items only', async () => {
  await withDataDir(async () => {
    process.env.PUBLIC_SITE_URL = 'https://rewear.example';
    let body = '';
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status() { return this; }, send(b) { body = b; return this; } };
    await sitemap({ headers: {} }, res);
    assert.match(body, /<loc>https:\/\/rewear\.example\/<\/loc>/);
    assert.match(body, /\/p\/p-1</);
    assert.doesNotMatch(body, /p-2/);
  });
});
