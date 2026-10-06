import { attemptsLeft, clearFailures, createSession, guardState, recordFailure, sameOrigin, sessionCookie, verifyPassword } from '../../lib/auth.js';
import { clientIp, ipAllowed, loadAccount } from '../../lib/account.js';
import { timingSafeEqual } from 'node:crypto';

function sameText(a, b) {
  const left = Buffer.from(String(a)), right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

const MESSAGES = {
  ip: minutes => `Слишком много неверных попыток с вашего IP. Попробуйте через ${minutes} мин.`,
  day: minutes => `Ваш IP заблокирован на сутки из-за многократных неверных попыток. Осталось ${Math.ceil(minutes / 60)} ч.`,
  global: minutes => `Вход временно закрыт из-за подозрительной активности. Попробуйте через ${minutes} мин.`,
};

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Запрос отклонён.' });
  const ip = clientIp(req);
  const account = await loadAccount({ fresh: true });
  if (!account) return res.status(503).json({ error: 'Вход ещё не настроен. На Vercel нужен GITHUB_TOKEN, на сервере — файл private/admin.json (scripts/reset-admin.mjs).' });
  const trusted = Boolean(account.allowedIps?.length) && ipAllowed(account, ip);
  const guard = await guardState(ip, { trusted });
  if (guard.blocked) return res.status(429).json({ error: MESSAGES[guard.reason](guard.minutes) });
  if (!ipAllowed(account, ip)) {
    await recordFailure(ip);
    return res.status(403).json({ error: `Вход с вашего IP (${ip}) запрещён настройками безопасности.` });
  }
  // every wrong attempt makes the next answer slower
  if (guard.delay) await new Promise(resolve => setTimeout(resolve, guard.delay));
  const { login, password } = req.body || {};
  // the password is always checked, so the response time does not reveal whether the login exists
  const passwordOk = verifyPassword(password ?? '', account.passwordHash);
  const loginOk = sameText(login ?? '', account.login);
  if (!passwordOk || !loginOk) {
    await recordFailure(ip);
    const left = await attemptsLeft(ip);
    return res.status(401).json({ error: left ? `Неверный логин или пароль. Осталось попыток: ${left}.` : 'Неверный логин или пароль. Вход с вашего IP заблокирован на 15 минут.' });
  }
  await clearFailures(ip);
  res.setHeader('set-cookie', sessionCookie(createSession(account.sessionSecret, Date.now(), account.version)));
  return res.status(200).json({ ok: true, mustChange: Boolean(account.mustChange) });
}
