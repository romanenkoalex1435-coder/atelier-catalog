// The public catalog as visitors see it: from disk on regular hosting, from the deployed site on Vercel.
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function siteOrigin(req) {
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

export async function publicProducts(req) {
  try {
    if (process.env.STORAGE === 'fs') {
      const file = path.join(path.resolve(process.env.DATA_DIR || process.cwd()), 'data/products.json');
      return JSON.parse(await readFile(file, 'utf8')).filter(item => item.active);
    }
    const response = await fetch(`${siteOrigin(req)}/data/products.json`);
    return response.ok ? (await response.json()).filter(item => item.active) : [];
  } catch {
    return [];
  }
}
