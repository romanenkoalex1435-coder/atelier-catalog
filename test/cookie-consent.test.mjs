import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function cookieHarness() {
  const listeners = [], values = new Map(), scripts = [];
  const consent = { hidden: false };
  const body = { dataset: {}, className: '', innerHTML: '', querySelector(selector) {
    const id = selector.slice(1);
    return this.innerHTML.includes(`id="${id}"`) ? { getAttribute: () => 'false' } : null;
  } };
  let closed = 0;
  const context = vm.createContext({
    document: { querySelector: () => consent, addEventListener: (_,fn) => listeners.push(fn), head: { append: script => scripts.push(script) }, createElement: () => ({}) },
    sheet: { classList: { add() {} } }, sheetBody: body, sheetOpen: true,
    localStorage: { getItem: key => values.get(key) || null, setItem: (key,value) => values.set(key,value) },
    window: {}, location: { reload() {} }, closeSheet: () => { closed++; }, openSheet: fn => fn(),
  });
  const source = readFileSync(new URL('../app.js',import.meta.url),'utf8');
  vm.runInContext(source.slice(source.indexOf('const CONSENT_KEY'),source.indexOf('async function init()')) + '\n globalThis.ui={cookieView,readConsent,setId: id => { metrikaId=id; }};',context);
  return { body, scripts, ui:context.ui, get closed() { return closed; }, click(action) {
    const target = { closest(selector) { return selector === '[data-consent]' ? { dataset: { consent:action } } : null; } };
    listeners.forEach(fn => fn({target}));
  } };
}
test('cookie details describe categories without individual switches or a save-selection action', () => {
  const h=cookieHarness(); h.ui.cookieView()();
  assert.doesNotMatch(h.body.innerHTML,/role="switch"|type="checkbox"|Сохранить выбор/);
  assert.match(h.body.innerHTML,/Необходимые/); assert.match(h.body.innerHTML,/Аналитика/);
});
test('accepting all enables described analytics once and closes the details', () => {
  const h=cookieHarness(); h.ui.setId('123456'); h.ui.cookieView()();
  assert.equal(h.scripts.length,0);
  h.click('accept'); assert.equal(h.ui.readConsent().analytics,true);
  assert.equal(h.scripts.length,1); assert.equal(h.closed,1);
  h.click('accept'); assert.equal(h.scripts.length,1);
});
test('refusing leaves analytics disabled and closes the details', () => {
  const h=cookieHarness(); h.ui.setId('123456'); h.ui.cookieView()();
  h.click('decline'); assert.equal(h.ui.readConsent().analytics,false);
  assert.equal(h.scripts.length,0); assert.equal(h.closed,1);
});
