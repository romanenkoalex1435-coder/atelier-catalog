export function parseProductFields(input) {
  const [title, rawPrice, description, ...extra] = input.split('|').map(value => value.trim());
  const price = Number(rawPrice);
  if (extra.length || !title || title.length > 100 || !Number.isSafeInteger(price) || price <= 0 || price > 10_000_000 || !description || description.length > 1000) {
    throw new Error('Формат: Название | Цена | Описание');
  }
  return { title, price, description };
}
