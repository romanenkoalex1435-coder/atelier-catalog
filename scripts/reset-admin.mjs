// Creates (or resets) the admin login with a one-time password that must be changed at the first sign-in.
//   node scripts/reset-admin.mjs [login]                    -> ./private/admin.json (commit it for the Vercel preview)
//   DATA_DIR=/var/rewear node scripts/reset-admin.mjs [login] -> on the server
// Use it to recover access if the password is forgotten or the IP allow-list locks you out.
import { randomBytes, randomInt } from 'node:crypto';
import { hashPassword } from '../lib/auth.js';
import { writePrivate } from '../lib/fs-store.js';

const login = process.argv[2] || 'rewear';
if (!/^[A-Za-z0-9._-]{3,40}$/.test(login)) { console.error('Логин: 3–40 символов, латиница, цифры, . _ -'); process.exit(1); }
const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const password = Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => alphabet[randomInt(alphabet.length)]).join('')).join('-');
await writePrivate('admin', {
  login,
  passwordHash: hashPassword(password),
  sessionSecret: randomBytes(32).toString('hex'),
  mustChange: true,
  allowedIps: [],
  version: randomBytes(8).toString('hex'),
  updatedAt: new Date().toISOString()
});
console.log(`Готово. Логин: ${login}\nВременный пароль: ${password}\nПри первом входе админка попросит задать свой логин и пароль.`);
