// Builds the public storefront as plain files for static hosting (Timeweb App Platform "HTML/CSS/JS", any CDN):
//   node scripts/build-static.mjs        ->  dist/
// The admin and /api stay on the server deployment; this build holds only what visitors see, including the
// /p/<id>/ link-preview pages and sitemap.xml that the server version renders on demand.
// The site address comes from SITE_URL or "siteUrl" in config.json.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const origin = String(process.env.SITE_URL || config.siteUrl || 'https://atelier-catalog.vercel.app').replace(/\/$/, '');
if (!/^https?:\/\/[^\s/]+$/.test(origin)) throw new Error(`Bad site address: ${origin}`);

// the handlers read the catalog from disk and take the address from PUBLIC_SITE_URL
process.env.STORAGE = 'fs';
process.env.DATA_DIR = root;
process.env.PUBLIC_SITE_URL = origin;
const { default: share } = await import('../api/share.js');
const { default: sitemap } = await import('../api/sitemap.js');

async function render(handler, query = {}) {
  let body = '';
  const res = { setHeader() {}, status() { return res; }, send(text) { body = text; return res; } };
  await handler({ query, headers: {} }, res);
  return body;
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ['styles.css', 'app.js', 'config.json', 'favicon.png', 'apple-touch-icon.png', 'og.jpg', 'fonts', 'images', 'video', 'data/products.json']) {
  await mkdir(path.dirname(path.join(out, item)), { recursive: true });
  await cp(path.join(root, item), path.join(out, item), { recursive: true });
}
for (const page of ['index.html', 'sold/index.html']) {
  const html = (await readFile(path.join(root, page), 'utf8')).replaceAll('https://atelier-catalog.vercel.app', origin);
  await mkdir(path.dirname(path.join(out, page)), { recursive: true });
  await writeFile(path.join(out, page), html);
}

const products = JSON.parse(await readFile(path.join(root, 'data/products.json'), 'utf8')).filter(item => item.active);
for (const product of products) {
  if (!/^[a-z0-9-]{1,60}$/.test(product.id)) continue;
  await mkdir(path.join(out, 'p', product.id), { recursive: true });
  await writeFile(path.join(out, 'p', product.id, 'index.html'), await render(share, { id: product.id }));
}
await writeFile(path.join(out, 'sitemap.xml'), await render(sitemap));
await writeFile(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
console.log(`dist/ ready for ${origin}: ${products.length} products, ${products.length} preview pages`);
