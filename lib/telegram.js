import { parseProductFields } from './catalog.js';

export function isOwner(fromId, ownerId) {
  return Boolean(ownerId) && String(fromId) === String(ownerId);
}

export function parseCommand(text = '') {
  const value = text.trim();
  if (value === '/start' || value === '/help') return { type: 'help' };
  if (value === '/list') return { type: 'list' };
  if (value.startsWith('/add ')) return { type: 'add', fields: parseProductFields(value.slice(5)) };
  if (value.startsWith('/edit ')) {
    const separator = value.indexOf('|');
    if (separator < 0) throw new Error('Формат: /edit ID | Название | Цена | Описание');
    const id = value.slice(6, separator).trim();
    assertId(id);
    return { type: 'edit', id, fields: parseProductFields(value.slice(separator + 1)) };
  }
  for (const type of ['delete', 'hide', 'show']) {
    if (value.startsWith(`/${type} `)) {
      const id = value.slice(type.length + 2).trim();
      assertId(id);
      return { type, id };
    }
  }
  throw new Error('Неизвестная команда. Отправьте /help.');
}

function assertId(id) {
  if (!/^[a-z0-9-]{1,60}$/.test(id)) throw new Error('Неверный ID товара.');
}

export async function telegramCall(method, body, token) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram ${method} failed`);
  return result.result;
}
