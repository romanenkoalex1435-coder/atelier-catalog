import { isAdmin, sameOrigin } from '../../lib/auth.js';
import { PASSPORT_FIELDS, assertId, decodeImage, validateProduct } from '../../lib/catalog.js';
import { deletePhoto, getCatalog, saveCatalog, savePhoto } from '../../lib/github.js';

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (!isAdmin(req)) return res.status(401).json({ error: 'Войдите в админ-панель.' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос отклонён.' });
  try {
    const { sha, products } = await getCatalog();
    if (req.method === 'GET') return res.status(200).json({ products });

    if (req.method === 'POST') {
      const fields = validateProduct(req.body);
      const id = `p-${Date.now().toString(36)}`;
      const image = req.body?.image ? await savePhoto(id, decodeImage(req.body.image)) : '';
      products.unshift({ id, ...fields, image, active: true, sold: false });
      await saveCatalog(products, sha, `Add product ${id}`);
      return res.status(200).json({ products });
    }

    const id = assertId(req.query?.id ?? req.body?.id);
    const index = products.findIndex(product => product.id === id);
    if (index < 0) return res.status(404).json({ error: 'Товар не найден.' });
    const product = products[index];

    if (req.method === 'PUT') {
      const body = req.body || {};
      if (['title', 'price', 'description', ...PASSPORT_FIELDS].some(key => key in body)) Object.assign(product, validateProduct({ ...product, ...body }));
      if (typeof body.active === 'boolean') product.active = body.active;
      if (typeof body.sold === 'boolean') product.sold = body.sold;
      let oldImage = '';
      if (body.image) {
        oldImage = product.image;
        product.image = await savePhoto(`${id}-${Date.now().toString(36)}`, decodeImage(body.image));
      }
      await saveCatalog(products, sha, `Update product ${id}`);
      if (oldImage) await deletePhoto(oldImage);
      return res.status(200).json({ products });
    }

    if (req.method === 'DELETE') {
      products.splice(index, 1);
      await saveCatalog(products, sha, `Delete product ${id}`);
      if (product.image) await deletePhoto(product.image);
      return res.status(200).json({ products });
    }
    return res.status(405).end();
  } catch (error) {
    console.error('Admin request failed:', error.message);
    const known = /^(Название|Цена|Описание|Поле|Фото|Файл|Неверный)/.test(error.message);
    return res.status(known ? 400 : 500).json({ error: known ? error.message : 'Не удалось сохранить. Проверьте GITHUB_TOKEN в Vercel и повторите.' });
  }
}
