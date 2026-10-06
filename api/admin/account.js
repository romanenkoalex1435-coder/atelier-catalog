// The signed-in owner can see the account and change the login, the password and the IP allow-list.
import { adminSession, clearFailures, createSession, guardState, hashPassword, recordFailure, sameOrigin, sessionCookie, verifyPassword } from '../../lib/auth.js';
import { clientIp, ipAllowed, newSessionSecret, passwordProblem, saveAccount, validIpPattern } from '../../lib/account.js';

const view = (account, ip) => ({ login: account.login, mustChange: Boolean(account.mustChange), allowedIps: account.allowedIps || [], ip, updatedAt: account.updatedAt || null });

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const account = await adminSession(req);
  if (!account) return res.status(401).json({ error: 'Войдите в админ-панель.' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос отклонён.' });
  const ip = clientIp(req);
  if (req.method === 'GET') return res.status(200).json(view(account, ip));
  if (req.method !== 'PUT') return res.status(405).end();

  const guard = await guardState(ip, { trusted: true });
  if (guard.blocked) return res.status(429).json({ error: `Слишком много неудачных попыток. Попробуйте через ${guard.minutes} мин.` });
  const body = req.body || {};
  if (!verifyPassword(body.currentPassword ?? '', account.passwordHash)) {
    await recordFailure(ip);
    return res.status(400).json({ error: 'Текущий пароль указан неверно.' });
  }
  await clearFailures(ip);

  const next = { ...account };
  const login = String(body.login ?? account.login).trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(login)) return res.status(400).json({ error: 'Логин: от 3 до 40 символов, латиница, цифры, точка, дефис, подчёркивание.' });
  next.login = login;

  const password = String(body.password ?? '');
  const passwordChanged = Boolean(password);
  if (passwordChanged) {
    const problem = passwordProblem(password, login);
    if (problem) return res.status(400).json({ error: problem });
    if (verifyPassword(password, account.passwordHash)) return res.status(400).json({ error: 'Новый пароль совпадает с текущим.' });
    next.passwordHash = hashPassword(password);
  } else if (account.mustChange) {
    return res.status(400).json({ error: 'Это временный пароль: задайте новый.' });
  }

  if ('allowedIps' in body) {
    const list = Array.isArray(body.allowedIps) ? [...new Set(body.allowedIps.map(item => String(item).trim()).filter(Boolean))] : null;
    if (!list || list.length > 20 || !list.every(validIpPattern)) return res.status(400).json({ error: 'Список IP: до 20 адресов вида 85.140.12.7 или 85.140.*.' });
    // never let the owner lock themselves out from where they are right now
    if (list.length && !ipAllowed({ allowedIps: list }, ip)) return res.status(400).json({ error: `Ваш текущий IP (${ip}) не входит в список: вы потеряете доступ. Добавьте его.` });
    next.allowedIps = list;
  }

  next.mustChange = false;
  if (passwordChanged || login !== account.login) next.sessionSecret = newSessionSecret();   // other devices are signed out
  let saved;
  try { saved = await saveAccount(next); }
  catch (error) {
    console.error('Account save failed:', error.message);
    return res.status(500).json({ error: process.env.STORAGE === 'fs' ? 'Не удалось сохранить на сервере. Проверьте права на папку данных.' : 'Не удалось сохранить: проверьте GITHUB_TOKEN в Vercel.' });
  }
  res.setHeader('set-cookie', sessionCookie(createSession(saved.sessionSecret, Date.now(), saved.version)));
  return res.status(200).json({ ...view(saved, ip), saved: true });
}
