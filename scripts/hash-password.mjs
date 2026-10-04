// Usage: node scripts/hash-password.mjs
// Prints ADMIN_PASSWORD_HASH and a random ADMIN_SESSION_SECRET for Vercel. Nothing is stored or sent.
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { hashPassword } from '../lib/auth.js';

const rl = createInterface({ input: process.stdin, output: process.stdout });
const password = await rl.question('Новый пароль (минимум 12 символов): ');
rl.close();
if (password.length < 12) { console.error('Слишком короткий пароль.'); process.exit(1); }
console.log(`\nADMIN_PASSWORD_HASH=${hashPassword(password)}`);
console.log(`ADMIN_SESSION_SECRET=${randomBytes(32).toString('hex')}`);
console.log('ADMIN_LOGIN=<придумайте логин>\n\nДобавьте три переменные в Vercel (Production) и сделайте Redeploy.');
