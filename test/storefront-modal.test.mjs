import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness} from './helpers/storefront-harness.mjs';

test('view replacement focuses title and sheet isolates background', () => {
  const h=harness(); h.ui.openSheet(() => {}); assert.equal(h.document.activeElement,h.get('#sheet-close'));
  h.ui.openSheet(() => {}); assert.equal(h.document.activeElement,h.get('#sheet-title'));
  assert.equal(h.get('main').inert,true);
});
test('Tab recovers focus from outside a dialog and wraps both directions', () => {
  const h=harness(); h.ui.openSheet(() => {}); h.document.activeElement=h.get('header');
  let prevented=false; h.ui.containFocus(h.get('#sheet'),{ preventDefault() { prevented=true; }, shiftKey:false });
  assert.ok(prevented); assert.equal(h.document.activeElement,h.get('#sheet-close'));
  h.ui.containFocus(h.get('#sheet'),{ preventDefault() {}, shiftKey:true }); assert.equal(h.document.activeElement,h.get('#sheet-title'));
});
test('Back closes zoom before sheet; preserves incoming link and other query parameters', () => {
  const h=harness(); h.ui.openSheet(() => {}); h.get('#sheet-title').focus();
  assert.match(h.currentUrl(),/product=a/);
  h.ui.openZoom('/images/a.jpg','a'); assert.equal(h.get('#sheet').inert,true);
  h.history.back(); assert.equal(h.get('#zoom').hidden,true); assert.equal(h.document.activeElement,h.get('#sheet-title')); assert.equal(h.get('#sheet').hidden,false);
  h.history.back(); h.timers.forEach(fn => fn()); assert.equal(h.get('#sheet').hidden,true); assert.equal(h.get('main').inert,false);
  assert.equal(h.currentUrl(),'https://shop.test/?other=1');
});
test('reopening before reduced motion close timer prevents stale hide', () => {
  const h=harness(); h.ui.openSheet(() => {}); h.ui.closeSheet(); h.ui.openSheet(() => {});
  h.timers.forEach(fn => fn()); assert.equal(h.get('#sheet').hidden,false); assert.equal(h.get('main').inert,true);
});
test('filter rerender restores focused chip by group and value', () => {
  const h=harness(); h.get('#sort');
  // Locate actual toolbar id independently of markup changes.
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const id=source.match(/const toolbar = document.querySelector\('([^']+)'\)/)[1];
  const actual=h.get(id), old=h.get('old-chip'), replacement=h.get('new-chip');
  old.dataset=replacement.dataset={ filter:'category',value:'верх' }; actual.children=[old]; old.focus();
  Object.defineProperty(actual,'innerHTML',{ set() { actual.children=[replacement]; } });
  h.ui.setProducts([{ category:'верх' },{ category:'низ' }]); h.ui.renderToolbar(); assert.equal(h.document.activeElement,replacement);
});
test('zoom button toggles magnification and accessible pressed state with keyboard click', () => {
  const h=harness(); h.ui.openSheet(() => {}); h.ui.openZoom('/images/a.jpg','a');
  const toggle=h.get('#zoom-toggle');
  toggle.listeners.click({ detail:0 }); assert.equal(toggle.getAttribute('aria-pressed'),'true');
  assert.equal(toggle.getAttribute('aria-label'),'Уменьшить фото');
  toggle.listeners.click({ detail:0 }); assert.equal(toggle.getAttribute('aria-pressed'),'false');
});
test('Forward reopens sheet and zoom without adding entries', () => {
  const h=harness(); h.ui.openSheet(() => {}); h.ui.openZoom('/images/a.jpg','a');
  h.history.back(); h.history.back(); h.timers.forEach(fn => fn());
  const count=h.entries.length;
  h.history.forward(); assert.equal(h.get('#sheet').hidden,false);
  h.history.forward(); assert.equal(h.get('#zoom').hidden,false); assert.equal(h.entries.length,count);
});

test('replacing a sheet during entry resumes its spring', () => {
  const h=harness(undefined,{ reducedMotion:false });
  h.ui.openSheet(() => {}); const start=h.ui.position();
  h.ui.openSheet(() => {});
  assert.ok(h.frames.at(-1)); h.frames.at(-1)(16);
  assert.ok(h.ui.position() < start);
});
test('Forward during close preserves the external opener for final focus restoration', () => {
  const h=harness(), opener=h.document.activeElement;
  h.ui.openSheet(() => {}); h.history.back(); h.history.forward();
  h.timers.forEach(fn => fn()); h.history.back(); h.timers.forEach(fn => fn());
  assert.equal(h.document.activeElement,opener);
});
test('open request during asynchronous Back is reconciled after popstate', () => {
  const h=harness(undefined,{ deferredHistory:true }); let rendered=0;
  h.ui.openSheet(() => {}); h.ui.closeSheet(); h.ui.openSheet(() => rendered++);
  assert.equal(rendered,0);
  h.historyEvents.shift()(); h.timers.forEach(fn => fn());
  assert.equal(rendered,1); assert.equal(h.get('#sheet').hidden,false);
  assert.equal(h.history.state.rewearModal,1); assert.equal(h.get('main').inert,true);
});
test('CSS hidden controls are excluded from focus containment', () => {
  const h=harness(), hidden=h.get('hidden-pin'); hidden.getClientRects=() => [];
  h.get('#sheet').children.unshift(hidden); h.ui.openSheet(() => {}); h.get('header').focus();
  h.ui.containFocus(h.get('#sheet'),{ preventDefault() {},shiftKey:false });
  assert.equal(h.document.activeElement,h.get('#sheet-close'));
});
