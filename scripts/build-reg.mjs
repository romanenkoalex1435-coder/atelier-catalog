// Complete PHP storefront. Live catalog, uploads and credentials stay outside this artifact.
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-reg');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ['index.html', 'sold', 'styles.css', 'app.js', 'config.json', 'favicon.png', 'apple-touch-icon.png', 'og.jpg', 'fonts', 'video', 'admin', 'models', 'vendor']) {
  await cp(path.join(root, item), path.join(out, item), { recursive: true });
}
await mkdir(path.join(out, 'php'));
for (const name of ['backend.php', 'index.php', 'router.php', 'init-account.php', 'verify-scrypt.cjs']) {
  await cp(path.join(root, 'php', name), path.join(out, 'php', name));
}
await writeFile(path.join(out, 'index.php'), "<?php\nrequire __DIR__ . '/php/router.php';\n");
await writeFile(path.join(out, '.htaccess'), `RewriteEngine On
RewriteCond %{HTTP_HOST} !^rewearvintage\\.shop$ [NC]
RewriteRule ^ https://rewearvintage.shop%{REQUEST_URI} [R=301,L]
RewriteCond %{HTTPS} !=on
RewriteCond %{HTTP:X-Forwarded-Proto} !^https$ [NC]
RewriteRule ^ https://rewearvintage.shop%{REQUEST_URI} [R=301,L]
RewriteRule (^|/)\\. - [F,L]
RewriteRule ^(?:php|private|test|scripts|deploy|lib|docs)(?:/|$) - [F,L]
RewriteRule ^(?:api/|p/|images/|data/products\\.json$|sitemap\\.xml$) index.php [L,QSA]
<FilesMatch "^package.*\\.json$">
Require all denied
</FilesMatch>
`);
await writeFile(path.join(out, 'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: https://rewearvintage.shop/sitemap.xml\n');
console.log('dist-reg ready: complete storefront + PHP admin, no private data');
