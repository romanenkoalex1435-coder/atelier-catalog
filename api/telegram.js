import { getCatalog, saveCatalog, savePhoto } from '../lib/github.js';
import { isOwner, parseCommand, telegramCall } from '../lib/telegram.js';

const help = 'Команды:\n/add Название | Цена | Категория | Размеры через запятую | Описание — можно приложить фото\n/edit ID | Название | Цена | Категория | Размеры | Описание\n/delete ID\n/hide ID\n/show ID\n/list';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) return res.status(403).end();
  const message = req.body?.message;
  if (!message || !isOwner(message.from?.id, process.env.TELEGRAM_OWNER_ID)) return res.status(200).json({ ok: true });
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return res.status(503).json({ error: 'Bot token missing' });
  try {
    const command = parseCommand(message.text || message.caption || '');
    let reply = help;
    if (command.type !== 'help') {
      const { sha, products } = await getCatalog();
      if (command.type === 'list') {
        reply = products.length ? products.map(p => `${p.active ? '●' : '○'} ${p.id}: ${p.title} — ${p.price} ₽`).join('\n') : 'Каталог пуст.';
      } else if (command.type === 'add') {
        const id = `p-${req.body.update_id}`;
        if (products.some(p => p.id === id)) return res.status(200).json({ ok: true });
        let image = '';
        if (message.photo?.length) {
          const photo = message.photo.at(-1);
          if (photo.file_size > 5_000_000) throw new Error('Фото должно быть меньше 5 МБ.');
          const file = await telegramCall('getFile', { file_id: photo.file_id }, token);
          const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
          if (!response.ok) throw new Error('Не удалось скачать фото из Telegram.');
          const bytes = await response.arrayBuffer();
          await savePhoto(id, bytes, 'jpg');
          image = `/images/${id}.jpg`;
        }
        products.unshift({ id, ...command.fields, image, active: true });
        await saveCatalog(products, sha, `Add product ${id}`);
        reply = `Товар добавлен: ${id}. Сайт обновится после деплоя.`;
      } else {
        const index = products.findIndex(p => p.id === command.id);
        if (index < 0) throw new Error('Товар с таким ID не найден.');
        if (command.type === 'delete') products.splice(index, 1);
        if (command.type === 'hide') products[index].active = false;
        if (command.type === 'show') products[index].active = true;
        if (command.type === 'edit') Object.assign(products[index], command.fields);
        await saveCatalog(products, sha, `${command.type} product ${command.id}`);
        reply = `Готово: ${command.id}. Сайт обновится после деплоя.`;
      }
    }
    await telegramCall('sendMessage', { chat_id: message.chat.id, text: reply }, token);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Bot command failed:', error);
    await telegramCall('sendMessage', { chat_id: message.chat.id, text: `Ошибка: ${error.message}` }, token).catch(console.error);
    return res.status(200).json({ ok: true });
  }
}
