import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function harness(sourcePath = process.env.STOREFRONT_SOURCE || '../app.js', { deferredHistory = false, reducedMotion = true } = {}) {
  const nodes = new Map(), timers = [], listeners = {}, frames = [], historyEvents = [];
  let document;
  function node(id) {
    const attrs = {}, classes = new Set();
    return { id, hidden: false, inert: false, isConnected: true, dataset: {}, style: {}, tagName: 'DIV', children: [], offsetWidth: 400, offsetHeight: 600,
      textContent: '', listeners: {}, getClientRects: () => [{ width:400, height:600 }], getBoundingClientRect: () => ({ left:0, top:0, width:400, height:600 }),
      classList: { add: x => classes.add(x), remove: x => classes.delete(x), toggle(x) { if (classes.has(x)) { classes.delete(x); return false; } classes.add(x); return true; } },
      setAttribute: (k,v) => attrs[k] = v, getAttribute: k => attrs[k], removeAttribute: k => delete attrs[k],
      focus() { document.activeElement = this; },
      contains(el) { return this === el || this.children.includes(el); },
      closest() { return null; },
      querySelector(sel) { return nodes.get(sel) || null; }, querySelectorAll() { return this.children; },
      addEventListener(k,v) { this.listeners[k] = v; }, animate() {}, scrollIntoView() {},
    };
  }
  function get(sel) { if (!nodes.has(sel)) nodes.set(sel,node(sel.slice(1))); return nodes.get(sel); }
  document = { body: node('body'), activeElement: node('opener'), querySelector: get, querySelectorAll: () => [], addEventListener(k,v) { listeners[k] = v; } };
  document.body.dataset = {};
  const sheet = get('#sheet'), zoom = get('#zoom'), close = get('#sheet-close'), zclose = get('#zoom-close'), ztoggle = get('#zoom-toggle'), title = get('#sheet-title');
  sheet.hidden = zoom.hidden = true;
  sheet.children = [close,title]; zoom.children = [zclose,ztoggle];
  document.body.children = [get('main'),get('header'),sheet,zoom,get('#scrim')];
  let location = new URL('https://shop.test/?other=1&product=a');
  const entries = [{ state: null, url: location.href }]; let cursor=0;
  const history = { get state() { return entries[cursor].state; }, replaceState(state,_,url) { entries[cursor]={state,url}; location = new URL(url,location); }, pushState(state,_,url) { entries.splice(++cursor); entries[cursor]={state,url}; location=new URL(url,location); }, back() { cursor--; location=new URL(entries[cursor].url); (deferredHistory ? historyEvents.push(() => listeners.popstate()) : listeners.popstate()); }, forward() { cursor++; location=new URL(entries[cursor].url); (deferredHistory ? historyEvents.push(() => listeners.popstate()) : listeners.popstate()); } };
  const context = vm.createContext({ document, history, get location() { return location; }, window: { addEventListener(k,v) { listeners[k]=v; } }, URL, URLSearchParams, Intl, console, listeners, navigator: {}, matchMedia: () => ({ matches: reducedMotion, addEventListener() {} }), localStorage: { getItem: () => null, setItem() {} }, scrollTo() {}, requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame(id) { frames[id - 1] = null; }, performance: { now: () => 0 }, clearTimeout() {}, setTimeout(fn) { timers.push(fn); }, fetch() {} });
  let source = readFileSync(new URL(sourcePath,import.meta.url),'utf8').replace(/^init\(\);$/m,'');
  vm.runInContext(source + '\n globalThis.ui = { openSheet, closeSheet, openZoom, closeZoom, containFocus: typeof containFocus === "function" ? containFocus : (root, event) => listeners.keydown(event), renderToolbar, position: () => pos, setProducts: value => products = value };',context);
  return { ui:context.ui, get, document, history, timers, listeners, entries, frames, historyEvents, currentUrl: () => location.href };
}

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
