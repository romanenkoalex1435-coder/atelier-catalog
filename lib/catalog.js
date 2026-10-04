export function validateProduct(input) {
  const title = String(input?.title ?? '').trim();
  const description = String(input?.description ?? '').trim();
  const price = Number(input?.price);
  if (!title || title.length > 100) throw new Error('Название: от 1 до 100 символов.');
  if (!Number.isSafeInteger(price) || price <= 0 || price > 10_000_000) throw new Error('Цена: целое число больше нуля.');
  if (description.length > 1000) throw new Error('Описание: не больше 1000 символов.');
  return { title, price, description };
}

const MAX_IMAGE_BYTES = 3_000_000;

export function decodeImage(dataUrl) {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!match) throw new Error('Фото должно быть в формате JPEG.');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('Фото больше 3 МБ.');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('Файл не похож на JPEG.');
  return bytes;
}

export function assertId(id) {
  if (!/^[a-z0-9-]{1,60}$/.test(String(id))) throw new Error('Неверный ID товара.');
  return String(id);
}
