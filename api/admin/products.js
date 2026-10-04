import { isAdmin, sameOrigin } from '../../lib/auth.js';
import { MAX_PHOTOS, PASSPORT_FIELDS, assertId, decodeImage, validateNotes, validateProduct } from '../../lib/catalog.js';
import { deletePhoto, getCatalog, saveCatalog, savePhoto } from '../../lib/github.js';

const photosOf = product => (Array.isArray(product.images) && product.images.length ? product.images : product.image ? [product.image] : []);

// `list` mixes paths that already belong to the product with new JPEG data URLs.
async function resolvePhotos(list, id, current) {
  if (!Array.isArray(list) || list.length > MAX_PHOTOS) throw new Error(`Фото: не больше ${MAX_PHOTOS}.`);
  const result = [];
  for (const item of list) {
    if (typeof item === 'string' && current.includes(item)) result.push(item);
    else result.push(await savePhoto(`${id}-${Date.now().toString(36)}${result.length}`, decodeImage(item)));
  }
  return result;
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Войдите в админ-панель.' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос отклонён.' });
  try {
    const { sha, products } = await getCatalog();
    if (req.method === 'GET') return res.status(200).json({ products });
    const body = req.body || {};
    const incoming = 'images' in body ? body.images : 'image' in body ? (body.image ? [body.image] : []) : undefined;

    if (req.method === 'POST') {
      const fields = validateProduct(body);
      const id = `p-${Date.now().toString(36)}`;
      const images = incoming ? await resolvePhotos(incoming, id, []) : [];
      const notes = 'notes' in body ? validateNotes(body.notes, images.length) : [];
      products.unshift({ id, ...fields, image: images[0] || '', images, notes, active: true, sold: false, reserved: false });
      await saveCatalog(products, sha, `Add product ${id}`);
      return res.status(200).json({ products });
    }

    const id = assertId(req.query?.id ?? body.id);
    const index = products.findIndex(product => product.id === id);
    if (index < 0) return res.status(404).json({ error: 'Товар не найден.' });
    const product = products[index];

    if (req.method === 'PUT') {
      if (['title', 'price', 'description', ...PASSPORT_FIELDS].some(key => key in body)) Object.assign(product, validateProduct({ ...product, ...body }));
      for (const flag of ['active', 'sold', 'reserved']) if (typeof body[flag] === 'boolean') product[flag] = body[flag];
      let removed = [];
      if (incoming !== undefined) {
        const before = photosOf(product);
        product.images = await resolvePhotos(incoming, id, before);
        product.image = product.images[0] || '';
        removed = before.filter(path => !product.images.includes(path));
      }
      const count = photosOf(product).length;
      if ('notes' in body) product.notes = validateNotes(body.notes, count);
      else if (Array.isArray(product.notes)) product.notes = product.notes.filter(note => (note.img ?? 0) < count);
      await saveCatalog(products, sha, `Update product ${id}`);
      for (const path of removed) await deletePhoto(path);
      return res.status(200).json({ products });
    }

    if (req.method === 'DELETE') {
      products.splice(index, 1);
      await saveCatalog(products, sha, `Delete product ${id}`);
      for (const path of photosOf(product)) await deletePhoto(path);
      return res.status(200).json({ products });
    }
    return res.status(405).end();
  } catch (error) {
    console.error('Admin request failed:', error.message);
    const known = /^(Название|Цена|Описание|Поле|Детали|Фото|Файл|Неверный)/.test(error.message);
    return res.status(known ? 400 : 500).json({ error: known ? error.message : 'Не удалось сохранить. Проверьте GITHUB_TOKEN в Vercel и повторите.' });
  }
}
