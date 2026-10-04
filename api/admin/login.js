import { authConfigured, clearFailures, createSession, recordFailure, sameOrigin, sessionCookie, tooManyAttempts, verifyPassword } from '../../lib/auth.js';
import { timingSafeEqual } from 'node:crypto';

function sameText(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос отклонён.' });
  if (!authConfigured()) return res.status(503).json({ error: 'Вход ещё не настроен в Vercel.' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Слишком много попыток. Подождите 15 минут.' });
  const { login, password } = req.body || {};
  // Always verify the password so response time does not reveal whether the login exists.
  const passwordOk = verifyPassword(password ?? '', process.env.ADMIN_PASSWORD_HASH);
  const loginOk = sameText(login ?? '', process.env.ADMIN_LOGIN);
  if (!passwordOk || !loginOk) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Неверный логин или пароль.' });
  }
  clearFailures(ip);
  res.setHeader('set-cookie', sessionCookie(createSession(process.env.ADMIN_SESSION_SECRET)));
  return res.status(200).json({ ok: true });
}
