// Catalog storage on the server's own disk (for a regular VPS / Russian hosting). Same interface as lib/github.js.
// DATA_DIR holds data/products.json and images/ (defaults to the project folder).
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = () => path.resolve(process.env.DATA_DIR || process.cwd());
const catalogFile = () => path.join(root(), 'data/products.json');
const hash = buffer => createHash('sha1').update(buffer).digest('hex');

async function writeAtomic(file, bytes) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, file);
}

export async function getCatalog() {
  const raw = await readFile(catalogFile());
  return { sha: hash(raw), products: JSON.parse(raw.toString('utf8')) };
}

// optimistic lock like GitHub: refuse to overwrite a catalog that changed since it was read
export async function saveCatalog(products, sha) {
  const current = await readFile(catalogFile()).catch(() => null);
  if (current && sha && hash(current) !== sha) throw new Error('Каталог изменился в другой вкладке. Обновите страницу и повторите.');
  await writeAtomic(catalogFile(), Buffer.from(JSON.stringify(products, null, 2) + '\n'));
}

export async function savePhoto(name, bytes) {
  const rel = `images/${name}.jpg`;
  await writeAtomic(path.join(root(), rel), Buffer.from(bytes));
  return `/${rel}`;
}

export async function savePreview(name, bytes, ext) {
  const rel = `images/preview/${name}.${ext}`;
  await writeAtomic(path.join(root(), rel), Buffer.from(bytes));
  return `/${rel}`;
}

export async function deletePhoto(imagePath) {
  const rel = String(imagePath || '').replace(/^\//, '');
  if (!/^images\/(preview\/)?[a-z0-9-]+\.(jpg|webp|png)$/.test(rel)) return;
  await unlink(path.join(root(), rel)).catch(error => console.error('Photo cleanup failed:', error.message));
}
