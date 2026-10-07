import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function harness({ confirm = () => true } = {}) {
  const elements = new Map(), cuts = [], bitmaps = [], requests = [];
  function node() {
    return { hidden: false, value: '', checked: false, disabled: false, files: [], style: {}, listeners: {}, children: [],
      classList: { toggle() {} }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute() {}, focus() {}, scrollIntoView() {}, reset() {},
      querySelector() { return null; }, closest() { return this; },
      addEventListener(name, callback) { this.listeners[name] = callback; },
    };
  }
  function element(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }
  for (const id of ['editor', 'login-form', 'account-form']) {
    for (const field of ['title', 'price', 'description', 'category', 'size', 'brand', 'era', 'origin', 'condition', 'measures', 'login', 'password', 'password2', 'currentPassword', 'allowedIps']) element(id)[field] = node();
  }
  const context = vm.createContext({
    document: { getElementById: element, createElement(tag) {
      const el = node();
      if (tag === 'canvas') {
        el.getContext = () => ({ drawImage(bitmap) { el.bitmap = bitmap; } });
        el.toDataURL = type => 'data:' + type + ';base64,' + el.bitmap.tag;
      }
      return el;
    } },
    localStorage: { getItem: () => '0', setItem() {} },
    kindForCategory: () => 'clothing',
    cutOut(src, kind, progress) { const d = deferred(); cuts.push({ ...d, src, kind, progress }); return d.promise; },
    createImageBitmap(file) { const d = deferred(); bitmaps.push({ ...d, file }); return d.promise; },
    confirm,
    fetch(path, options) { const d = deferred(); requests.push({ ...d, path, options }); return d.promise; },
    console,
  });
  const source = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8')
    .replace(/^import[^\n]+\n/, '')
    .replace(/^load\(\);$/m, '');
  vm.runInContext(source + '\n globalThis.admin = { openEditor, runCut, mutate, dirty, render, seed: value => { products = value; render(); }, state: () => ({ cut, photos, selected }) };', context);
  return { admin: context.admin, elements, element, cuts, bitmaps, requests };
}
const product = id => ({ id, title: id, price: 100, images: ['/images/' + id + '.jpg'], preview: '/images/preview/' + id + '.webp', notes: [] });
const result = tag => ({ dataUrl: 'data:image/webp;base64,' + tag, problems: [] });
const bitmap = tag => ({ width: 100, height: 100, tag });

test('old cut completion and progress cannot alter a newly opened editor or its running cut', async () => {
  const h = harness(); h.admin.openEditor(product('a')); const a = h.admin.runCut();
  h.admin.openEditor(product('b')); const b = h.admin.runCut();
  h.cuts[1].progress('B is processing'); h.cuts[0].progress('stale A progress');
  assert.equal(h.element('cut-status').textContent, 'B is processing');
  h.cuts[0].resolve(result('A')); await a;
  assert.equal(h.admin.state().cut.data, '');
  assert.equal(h.admin.state().cut.path, '/images/preview/b.webp');
  assert.equal(h.admin.state().cut.busy, true);
  h.cuts[1].resolve(result('B')); await b;
  assert.equal(h.admin.state().cut.data, result('B').dataUrl);
  assert.equal(h.admin.state().cut.busy, false);
});

test('cut result is discarded if its source photo was removed while processing', async () => {
  const h = harness(); h.admin.openEditor(product('a')); const run = h.admin.runCut();
  // Removing the actual captured photo is equivalent to the strip remove control.
  h.admin.state().photos.splice(0, 1);
  h.cuts[0].resolve(result('removed')); await run;
  assert.equal(h.admin.state().cut.data, '');
  assert.equal(h.admin.state().cut.busy, false);
});

test('remove and cancel invalidate pending cut progress and results', async () => {
  for (const action of ['cut-remove', 'cancel']) {
    const h = harness(); h.admin.openEditor(product('a')); const run = h.admin.runCut();
    h.element(action).listeners.click();
    const before = h.element('cut-status').textContent;
    h.cuts[0].progress('stale progress'); h.cuts[0].resolve(result('stale')); await run;
    assert.equal(h.admin.state().cut.data, '');
    assert.equal(h.element('cut-status').textContent, before);
    assert.equal(h.admin.state().cut.busy, false);
  }
});

test('uploaded preview for A is discarded after switching to editor B', async () => {
  const h = harness(); h.admin.openEditor(product('a'));
  h.element('cut-input').files = [{ name: 'a.png' }];
  const upload = h.element('cut-input').listeners.change();
  h.admin.openEditor(product('b')); h.bitmaps[0].resolve(bitmap('A')); await upload;
  assert.equal(h.admin.state().cut.path, '/images/preview/b.webp');
  assert.equal(h.admin.state().cut.data, '');
});

test('older preview upload cannot overwrite a newer successful preview in the same editor', async () => {
  const h = harness(); h.admin.openEditor(product('a'));
  h.element('cut-input').files = [{ name: 'old.png' }]; const old = h.element('cut-input').listeners.change();
  h.element('cut-input').files = [{ name: 'new.png' }]; const next = h.element('cut-input').listeners.change();
  h.bitmaps[1].resolve(bitmap('new')); await next;
  h.bitmaps[0].resolve(bitmap('old')); await old;
  assert.equal(h.admin.state().cut.data, result('new').dataUrl);
});

test('JPEG upload stops after editor switch and preserves a current editor upload', async () => {
  const h = harness(); h.admin.openEditor(product('a'));
  h.element('photo-input').files = [{ name: 'old-1.jpg' }, { name: 'old-2.jpg' }];
  const old = h.element('photo-input').listeners.change();
  h.admin.openEditor(product('b'));
  h.element('photo-input').files = [{ name: 'new.jpg' }]; const next = h.element('photo-input').listeners.change();
  h.bitmaps[1].resolve(bitmap('new')); await next;
  h.bitmaps[0].resolve(bitmap('old'));
  await new Promise(resolve => setImmediate(resolve));
  if (h.bitmaps[2]) h.bitmaps[2].resolve(bitmap('old-2'));
  await old;
  assert.equal(h.bitmaps.length, 2, 'stale batch must not continue converting its second file');
  assert.deepEqual(Array.from(h.admin.state().photos, p => p.src), ['/images/b.jpg', 'data:image/jpeg;base64,new']);
});

test('a current cut with warnings still waits for acceptance', async () => {
  const h = harness(); h.admin.openEditor(product('a')); const run = h.admin.runCut();
  h.cuts[0].resolve({ dataUrl: result('current').dataUrl, problems: ['Check edge'] }); await run;
  assert.equal(h.admin.state().cut.pending.dataUrl, result('current').dataUrl);
  h.element('cut-accept').listeners.click();
  assert.equal(h.admin.state().cut.data, result('current').dataUrl);
  assert.equal(h.admin.state().cut.pending, null);
});

for (const pendingIndex of [0, 1]) test(`save waits for JPEG ${pendingIndex + 1} in selected batch`, async () => {
  const h = harness(); h.admin.openEditor(null);
  h.element('editor').title.value = 'Shirt'; h.element('editor').price.value = '100';
  h.element('photo-input').files = [{ name: 'first.jpg' }, { name: 'second.jpg' }];
  const upload = h.element('photo-input').listeners.change();
  if (pendingIndex) { h.bitmaps[0].resolve(bitmap('first')); await new Promise(resolve => setImmediate(resolve)); }
  h.element('editor').listeners.submit({ preventDefault() {} });
  assert.equal(h.requests.length, 0, 'no request may omit a selected photo');
  assert.equal(h.element('save').disabled, true);
  h.bitmaps[pendingIndex].resolve(bitmap(pendingIndex ? 'second' : 'first'));
  if (!pendingIndex) { await new Promise(resolve => setImmediate(resolve)); h.bitmaps[1].resolve(bitmap('second')); }
  await upload;
  assert.equal(h.element('save').disabled, false);
  const save = h.element('editor').listeners.submit({ preventDefault() {} });
  assert.deepEqual(JSON.parse(h.requests[0].options.body).images, ['data:image/jpeg;base64,first', 'data:image/jpeg;base64,second']);
  h.requests[0].resolve({ ok: true, status: 200, json: async () => ({ products: [] }) }); await save;
});

test('catalog mutation excludes overlapping stale actions and permits the next action after completion', async () => {
  const h = harness();
  const first = h.admin.mutate('/api/admin/products?id=a', 'PUT', { reserved: true });
  const overlapPromise = h.admin.mutate('/api/admin/products?id=a', 'PUT', { sold: true });
  assert.equal(h.requests.length, 1);
  assert.equal(await overlapPromise, false);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve({ ok: true, status: 200, json: async () => ({ products: [] }) }); await first;
  const next = h.admin.mutate('/api/admin/products?id=a', 'PUT', { sold: true });
  assert.equal(h.requests.length, 2);
  h.requests[1].resolve({ ok: true, status: 200, json: async () => ({ products: [] }) }); await next;
});

test('a retained button from an old catalog snapshot cannot revert current status', async () => {
  const h = harness(); h.admin.seed([{ ...product('a'), active: true, reserved: false }]);
  const oldReserve = h.element('list').children[0].children[2].children[1].children[1].children[0];
  oldReserve.listeners.click();
  assert.equal(h.requests.length, 1);
  oldReserve.listeners.click();
  assert.equal(h.requests.length, 1, 'double click cannot send a second mutation');
  h.requests[0].resolve({ ok: true, status: 200, json: async () => ({ products: [{ ...product('a'), active: true, reserved: true }] }) });
  await new Promise(resolve => setImmediate(resolve));
  oldReserve.listeners.click();
  assert.equal(h.requests.length, 1, 'stale controls remain inert after completion');
  const currentReserve = h.element('list').children[0].children[2].children[1].children[1].children[0];
  currentReserve.listeners.click();
  assert.equal(JSON.parse(h.requests[1].options.body).reserved, false);
  h.requests[1].resolve({ ok: true, status: 200, json: async () => ({ products: [] }) });
  await new Promise(resolve => setImmediate(resolve));
});

test('dirty state tracks edits and approved cancel closes editor', () => {
  const h = harness(); h.admin.openEditor(product('a'));
  assert.equal(h.admin.dirty(), false);
  h.element('editor').title.value = 'Changed';
  assert.equal(h.admin.dirty(), true);
  h.element('cancel').listeners.click();
  assert.equal(h.element('editor').hidden, true);
});

test('cancel preserves unsaved editor when discard is declined', () => {
  const h = harness({ confirm: () => false }); h.admin.openEditor(product('a'));
  h.element('editor').title.value = 'Changed';
  h.element('cancel').listeners.click();
  assert.equal(h.element('editor').hidden, false);
  assert.equal(h.element('editor').title.value, 'Changed');
});

test('JPEG failure releases save guard and leaves editor available for retry', async () => {
  const h = harness(); h.admin.openEditor(null);
  h.element('photo-input').files = [{ name: 'bad.jpg' }];
  const upload = h.element('photo-input').listeners.change();
  assert.equal(h.element('save').disabled, true);
  h.bitmaps[0].reject(new Error('decode')); await upload;
  assert.equal(h.element('save').disabled, false);
  assert.equal(h.element('photo-input').disabled, false);
  assert.equal(h.element('editor').hidden, false);
  assert.match(h.element('notice').textContent, /Не удалось/);
});

test('pending custom preview triggers discard guard before decoding finishes', async () => {
  const h = harness({ confirm: () => false }); h.admin.openEditor(product('a'));
  h.element('cut-input').files = [{ name: 'preview.png' }];
  const upload = h.element('cut-input').listeners.change();
  assert.equal(h.admin.dirty(), true);
  h.element('cancel').listeners.click();
  assert.equal(h.element('editor').hidden, false);
  h.bitmaps[0].resolve(bitmap('new')); await upload;
});

test('cut result awaiting acceptance triggers discard guard', async () => {
  const h = harness({ confirm: () => false }); h.admin.openEditor(product('a'));
  const run = h.admin.runCut();
  h.cuts[0].resolve({ dataUrl: result('pending').dataUrl, problems: ['Check edge'] }); await run;
  assert.equal(h.admin.dirty(), true);
  h.element('cancel').listeners.click();
  assert.equal(h.element('editor').hidden, false);
  assert.equal(h.admin.state().cut.pending.dataUrl, result('pending').dataUrl);
});

test('defect coordinate controls accept fractional positions without rounding saved notes', () => {
  const h = harness();
  h.admin.openEditor({ ...product('a'), notes: [{ x: 42.35, y: 71.2, text: 'Wear', type: 'flaw', img: 0 }] });
  const coordinates = h.element('pin-list').children[0].children[4];
  assert.equal(coordinates.children[0].children[0].step, 'any');
  assert.equal(coordinates.children[0].children[0].value, 42.35);
  assert.equal(coordinates.children[1].children[0].step, 'any');
  assert.equal(coordinates.children[1].children[0].value, 71.2);
});
