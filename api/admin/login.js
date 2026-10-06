import { attemptsLeft, clearFailures, createSession, minutesUntilUnlock, recordFailure, sameOrigin, sessionCookie, tooManyAttempts, verifyPassword } from '../../lib/auth.js';
import { clientIp, ipAllowed, loadAccount } from '../../lib/account.js';
import { timingSafeEqual } from 'node:crypto';

function sameText(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос отклонён.' });
  const ip = clientIp(req);
  if (tooManyAttempts(ip)) return res.status(429).json({ error: `Слишком много неудачных попыток с вашего IP. Попробуйте через ${minutesUntilUnlock(ip)} мин.` });
  const account = await loadAccount({ fresh: true });
  if (!account) return res.status(503).json({ error: 'Вход ещё не настроен. На Vercel нужен GITHUB_TOKEN, на сервере — файл private/admin.json (scripts/reset-admin.mjs).' });
  if (!ipAllowed(account, ip)) {
    recordFailure(ip);
    return res.status(403).json({ error: `Вход с вашего IP (${ip}) запрещён настройками безопасности.` });
  }
  const { login, password } = req.body || {};
  // the password is always checked, so the response time does not reveal whether the login exists
  const passwordOk = verifyPassword(password ?? '', account.passwordHash);
  const loginOk = sameText(login ?? '', account.login);
  if (!passwordOk || !loginOk) {
    recordFailure(ip);
    const left = attemptsLeft(ip);
    return res.status(401).json({ error: left ? `Неверный логин или пароль. Осталось попыток: ${left}.` : 'Неверный логин или пароль. Вход с вашего IP заблокирован на 15 минут.' });
  }
  clearFailures(ip);
  res.setHeader('set-cookie', sessionCookie(createSession(account.sessionSecret, Date.now(), account.version)));
  return res.status(200).json({ ok: true, mustChange: Boolean(account.mustChange) });
}
