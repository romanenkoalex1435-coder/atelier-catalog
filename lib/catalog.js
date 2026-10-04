const PASSPORT = { brand: 60, era: 40, origin: 60, condition: 60, measures: 200 };
export const PASSPORT_FIELDS = Object.keys(PASSPORT);

export function validateProduct(input) {
  const title = String(input?.title ?? '').trim();
  const description = String(input?.description ?? '').trim();
  const price = Number(input?.price);
  if (!title || title.length > 100) throw new Error('Название: от 1 до 100 символов.');
  if (!Number.isSafeInteger(price) || price <= 0 || price > 10_000_000) throw new Error('Цена: целое число больше нуля.');
  if (description.length > 1000) throw new Error('Описание: не больше 1000 символов.');
  const fields = { title, price, description };
  for (const [name, max] of Object.entries(PASSPORT)) {
    const value = String(input?.[name] ?? '').trim();
    if (value.length > max) throw new Error(`Поле «${name}» длиннее ${max} символов.`);
    fields[name] = value;
  }
  return fields;
}

export function validateNotes(input) {
  if (!Array.isArray(input) || input.length > 8) throw new Error('Детали: не больше 8 точек.');
  return input.map(note => {
    const x = Number(note?.x), y = Number(note?.y), text = String(note?.text ?? '').trim();
    if (!(x >= 0 && x <= 100 && y >= 0 && y <= 100)) throw new Error('Детали: точка вне фото.');
    if (!text || text.length > 80) throw new Error('Детали: текст от 1 до 80 символов.');
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, text };
  });
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
