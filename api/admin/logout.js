import { sessionCookie } from '../../lib/auth.js';

export default function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader('set-cookie', sessionCookie(''));
  return res.status(200).json({ ok: true });
}
