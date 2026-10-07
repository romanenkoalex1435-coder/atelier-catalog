'use strict';
// Compatible with Node 10's crypto API, used only during migration of a legacy account.
var crypto = require('crypto');
var input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) { input += chunk; if (input.length > 12000) process.exit(1); });
process.stdin.on('end', function () {
  try {
    var data = JSON.parse(input), parts = data.hash.split('$');
    if (typeof data.password !== 'string' || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(data.hash)) process.exit(1);
    var expected = Buffer.from(parts[2], 'hex');
    var actual = crypto.scryptSync(data.password, parts[1], 64);
    if (crypto.timingSafeEqual(expected, actual)) process.stdout.write('OK');
    else process.exitCode = 1;
  } catch (e) { process.exitCode = 1; }
});
