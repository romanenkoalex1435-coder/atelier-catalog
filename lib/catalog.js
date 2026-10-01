export function parseProductFields(input) {
  const [title, rawPrice, category, rawSizes, description, ...extra] = input.split('|').map(value => value.trim());
  const price = Number(rawPrice);
  const sizes = rawSizes?.split(',').map(size => size.trim()).filter(Boolean) ?? [];
  if (extra.length || !title || title.length > 100 || !Number.isSafeInteger(price) || price <= 0 || price > 10_000_000 || !category || category.length > 60 || !sizes.length || sizes.length > 20 || sizes.some(size => size.length > 20) || !description || description.length > 1000) {
    throw new Error('Формат: Название | Цена | Категория | Размеры через запятую | Описание');
  }
  return { title, price, category, sizes, description };
}

export function buildOrder(payload, products) {
  const customer = String(payload?.customer ?? '').trim();
  if (!customer || customer.length > 100 || !/^(?:@[A-Za-z0-9_]{5,32}|\+?[0-9 ()-]{7,25})$/.test(customer)) {
    throw new Error('Укажите Telegram @username или номер телефона.');
  }
  if (!Array.isArray(payload?.items) || !payload.items.length || payload.items.length > 20) {
    throw new Error('Корзина пуста или содержит слишком много товаров.');
  }
  const items = payload.items.map(item => {
    const product = products.find(p => p.id === item?.id && p.active);
    if (!product || !product.sizes.includes(item.size) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 10) {
      throw new Error('Товар, размер или количество больше недоступны. Обновите каталог.');
    }
    return { id: product.id, title: product.title, price: product.price, size: item.size, quantity: item.quantity };
  });
  return { customer, items, total: items.reduce((sum, item) => sum + item.price * item.quantity, 0) };
}

export function formatOrder(order, origin) {
  const lines = ['🛍 Новый заказ с сайта', `Контакт: ${order.customer}`, ''];
  for (const item of order.items) {
    lines.push(`• ${item.title} — ${item.size} × ${item.quantity} — ${item.price * item.quantity} ₽`);
    lines.push(`${origin}/?product=${encodeURIComponent(item.id)}`);
  }
  lines.push('', `Итого: ${order.total} ₽`, 'Оплата и доставка обсуждаются в переписке.');
  return lines.join('\n');
}
