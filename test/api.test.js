import test from 'node:test';
import assert from 'node:assert/strict';
import botHandler from '../api/telegram.js';

function response() {
  return { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}

test('bot endpoint rejects requests without the webhook secret', async () => {
  const oldSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_WEBHOOK_SECRET = 'expected-secret';
  try {
    const res = response();
    await botHandler({ method: 'POST', headers: {}, body: {} }, res);
    assert.equal(res.code, 403);
  } finally {
    if (oldSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET; else process.env.TELEGRAM_WEBHOOK_SECRET = oldSecret;
  }
});
