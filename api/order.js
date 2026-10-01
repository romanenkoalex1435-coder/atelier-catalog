import localProducts from '../data/products.json' with { type: 'json' };
import { buildOrder, formatOrder } from '../lib/catalog.js';
import { getCatalog } from '../lib/github.js';
import { telegramCall } from '../lib/telegram.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Метод не поддерживается.' });
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_OWNER_ID) return res.status(503).json({ error: 'Приём заказов пока не настроен.' });
  if (req.body?.website) return res.status(200).json({ ok: true });
  try {
    const products = process.env.GITHUB_TOKEN && process.env.GITHUB_REPO ? (await getCatalog()).products : localProducts;
    const order = buildOrder(req.body, products);
    const origin = process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`;
    await telegramCall('sendMessage', { chat_id: process.env.TELEGRAM_OWNER_ID, text: formatOrder(order, origin) }, process.env.TELEGRAM_BOT_TOKEN);
    return res.status(200).json({ ok: true });
  } catch (error) {
    const invalid = /^(Укажите|Корзина|Товар)/.test(error.message);
    console.error('Order failed:', error);
    return res.status(invalid ? 400 : 502).json({ error: invalid ? error.message : 'Не удалось отправить заказ. Попробуйте позже.' });
  }
}
