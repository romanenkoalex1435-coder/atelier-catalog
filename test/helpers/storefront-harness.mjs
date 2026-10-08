import vm from 'node:vm';
import { readFileSync } from 'node:fs';

export function harness(sourcePath = process.env.STOREFRONT_SOURCE || '../../app.js', { deferredHistory = false, reducedMotion = true, previewMode = false } = {}) {
  const nodes = new Map(), timers = [], listeners = {}, frames = [], historyEvents = [], requests = [], messages = [];
  const parent = { postMessage(data, origin) { messages.push({data,origin}); } };
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
  let location = new URL('https://shop.test/?other=1&product=a' + (previewMode ? '&admin-preview=1' : ''));
  const entries = [{ state: null, url: location.href }]; let cursor=0;
  const history = { get state() { return entries[cursor].state; }, replaceState(state,_,url) { entries[cursor]={state,url}; location = new URL(url,location); }, pushState(state,_,url) { entries.splice(++cursor); entries[cursor]={state,url}; location=new URL(url,location); }, back() { cursor--; location=new URL(entries[cursor].url); (deferredHistory ? historyEvents.push(() => listeners.popstate()) : listeners.popstate()); }, forward() { cursor++; location=new URL(entries[cursor].url); (deferredHistory ? historyEvents.push(() => listeners.popstate()) : listeners.popstate()); } };
  const context = vm.createContext({ document, history, get location() { return location; }, window: { parent, addEventListener(k,v) { listeners[k]=v; } }, URL, URLSearchParams, Intl, console, listeners, navigator: {}, matchMedia: () => ({ matches: reducedMotion, addEventListener() {} }), localStorage: { getItem: () => null, setItem() {} }, scrollTo() {}, requestAnimationFrame(fn) { frames.push(fn); return frames.length; }, cancelAnimationFrame(id) { frames[id - 1] = null; }, performance: { now: () => 0 }, clearTimeout() {}, setTimeout(fn) { timers.push(fn); }, fetch(url, options) { let resolve, reject; const promise = new Promise((yes,no)=>{resolve=yes;reject=no;}); requests.push({url, options, resolve, reject}); return promise; } });
  let source = readFileSync(new URL(sourcePath,import.meta.url),'utf8').replace(/^[ \t]*init\(\);$/m,'');
  vm.runInContext(source + '\n globalThis.ui = { openSheet, closeSheet, openZoom, closeZoom, containFocus: typeof containFocus === "function" ? containFocus : (root, event) => listeners.keydown(event), renderToolbar, productView, cartView, openCart: typeof openCart === "function" ? openCart : undefined, refreshCart: typeof refreshCart === "function" ? refreshCart : undefined, prepareOrder: typeof prepareOrder === "function" ? prepareOrder : undefined, setCart: value => cart = value, getCart: () => cart, setSeller: value => sellerTelegram = value, position: () => pos, setProducts: value => { products = value; catalogReady = true; } };',context);
  return { requests, messages, parent, ui:context.ui, get, document, history, timers, listeners, entries, frames, historyEvents, currentUrl: () => location.href };
}

