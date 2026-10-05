// Standalone server for regular hosting (VPS, Russian providers): serves the site and runs the same API handlers as Vercel.
//   STORAGE=fs DATA_DIR=/var/rewear PORT=3000 node server.mjs
// Put it behind nginx (or the provider's proxy) with HTTPS: the admin session cookie is `Secure`.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.DATA_DIR || here);
const port = Number(process.env.PORT || 3000);
const MAX_BODY = 40 * 1024 * 1024; // up to 8 photos plus a preview as data URLs

const routes = {
  '/api/admin/login': () => import('./api/admin/login.js'),
  '/api/admin/logout': () => import('./api/admin/logout.js'),
  '/api/admin/products': () => import('./api/admin/products.js'),
  '/api/share': () => import('./api/share.js'),
  '/api/sitemap': () => import('./api/sitemap.js'),
};

const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream',
};

// only these public paths are served; code, tests, secrets and git internals never are
const PUBLIC = /^\/(index\.html|styles\.css|app\.js|config\.json|robots\.txt|favicon\.png|apple-touch-icon\.png|og\.jpg|admin\/[\w.-]+|fonts\/[\w.-]+|images\/(preview\/)?[\w.-]+|video\/[\w.-]+|models\/[\w.-]+|vendor\/ort\/[\w.-]+|data\/products\.json)$/;
const FROM_DATA = /^\/(images\/|data\/products\.json)/;

function cacheFor(pathname) {
  if (/^\/(models|vendor)\//.test(pathname)) return 'public, max-age=31536000, immutable';
  if (/^\/(images|video|fonts)\//.test(pathname)) return 'public, max-age=86400';
  if (pathname === '/data/products.json' || pathname.startsWith('/admin/')) return 'no-store';
  return 'public, max-age=300';
}

async function serveFile(req, res, pathname) {
  if (pathname === '/' || pathname === '/admin' || pathname === '/admin/') pathname = pathname.replace(/\/?$/, '/') + 'index.html';
  if (!PUBLIC.test(pathname)) return notFound(res);
  const base = FROM_DATA.test(pathname) ? dataDir : here;
  const file = path.join(base, pathname);
  if (!file.startsWith(base + path.sep)) return notFound(res);
  let info;
  try { info = await stat(file); } catch { return notFound(res); }
  if (!info.isFile()) return notFound(res);
  res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
  res.setHeader('cache-control', cacheFor(pathname));
  res.setHeader('x-content-type-options', 'nosniff');
  if (pathname.startsWith('/admin/')) res.setHeader('x-robots-tag', 'noindex, nofollow');
  // byte ranges, so the hero video can start before it is fully downloaded (Safari requires it)
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start >= info.size || start > end) { res.statusCode = 416; res.setHeader('content-range', `bytes */${info.size}`); return res.end(); }
    res.statusCode = 206;
    res.setHeader('accept-ranges', 'bytes');
    res.setHeader('content-range', `bytes ${start}-${end}/${info.size}`);
    res.setHeader('content-length', end - start + 1);
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.setHeader('accept-ranges', 'bytes');
  res.setHeader('content-length', info.size);
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.end('Не найдено');
}

// Vercel-style helpers the API handlers rely on
function adapt(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = body => { if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8'); res.end(JSON.stringify(body)); return res; };
  res.send = body => { res.end(body); return res; };
  return res;
}

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  if (String(req.headers['content-type'] || '').startsWith('application/json')) return JSON.parse(raw);
  return raw;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    let pathname = decodeURIComponent(url.pathname);
    const query = Object.fromEntries(url.searchParams);
    // the same rewrites as vercel.json
    const share = /^\/p\/([a-z0-9-]{1,60})$/.exec(pathname);
    if (share) { pathname = '/api/share'; query.id = share[1]; }
    if (pathname === '/sitemap.xml') pathname = '/api/sitemap';
    if (routes[pathname]) {
      req.query = query;
      req.body = ['POST', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : undefined;
      const { default: handler } = await routes[pathname]();
      return await handler(req, adapt(res));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; return res.end(); }
    return await serveFile(req, res, pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) { res.statusCode = error.status || 500; res.setHeader('content-type', 'text/plain; charset=utf-8'); }
    res.end(error.status === 413 ? 'Слишком большой запрос' : 'Ошибка сервера');
  }
});

server.listen(port, () => console.log(`REWEAR on http://localhost:${port} (storage: ${process.env.STORAGE === 'fs' ? `disk, ${dataDir}` : 'GitHub'})`));
