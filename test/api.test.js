import test from 'node:test';
import assert from 'node:assert/strict';
import orderHandler from '../api/order.js';
import botHandler from '../api/telegram.js';

function response() {
  return { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}

test('order endpoint sends a validated order to the seller', async () => {
  const oldFetch = global.fetch;
  const oldToken = process.env.TELEGRAM_BOT_TOKEN;
  const oldOwner = process.env.TELEGRAM_OWNER_ID;
  const oldGithub = process.env.GITHUB_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_OWNER_ID = '123';
  delete process.env.GITHUB_TOKEN;
  let sent;
  global.fetch = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };
  try {
    const res = response();
    await orderHandler({ method: 'POST', headers: { host: 'example.com' }, body: { customer: '@buyer_name', items: [{ id: 'demo-01', size: 'M', quantity: 1 }] } }, res);
    assert.equal(res.code, 200);
    assert.equal(sent.body.chat_id, '123');
    assert.match(sent.body.text, /6[\s\u00a0]?900 ₽/);
    assert.match(sent.body.text, /example.com\/\?product=demo-01/);
  } finally {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = oldToken;
    if (oldOwner === undefined) delete process.env.TELEGRAM_OWNER_ID; else process.env.TELEGRAM_OWNER_ID = oldOwner;
    if (oldGithub === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = oldGithub;
  }
});

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
