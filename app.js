const grid = document.querySelector('#product-grid');
const archiveGrid = document.querySelector('#archive-grid');
const grids = [grid, archiveGrid];
const sheet = document.querySelector('#sheet');
const sheetBody = document.querySelector('#sheet-body');
const sheetHead = document.querySelector('#sheet-head');
const scrim = document.querySelector('#scrim');
const cartCount = document.querySelector('#cart-count');
const currency = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const isDesktop = matchMedia('(min-width: 720px)');
const hanger = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M32 22v-3a5 5 0 1 0-5-5"/><path d="M32 22 6 42a3 3 0 0 0 2 5.3h48a3 3 0 0 0 2-5.3z"/></svg>';

let products = [];
let cart = readCart();
let sellerTelegram = '';
let view = null;
let previousFocus;

function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem('rewear-cart') || '[]');
    return Array.isArray(stored) ? [...new Set(stored.filter(item => typeof item.id === 'string').map(item => item.id))].map(id => ({ id })) : [];
  } catch { return []; }
}

function saveCart(deferCount = false) {
  try { localStorage.setItem('rewear-cart', JSON.stringify(cart)); } catch {}
  if (!deferCount) updateCount();
}

const byId = id => products.find(product => product.id === id);
const cartTotal = () => cart.reduce((sum, item) => sum + byId(item.id).price, 0);

function updateCount() {
  const total = cart.length;
  const changed = cartCount.textContent !== String(total);
  cartCount.textContent = total;
  cartCount.hidden = total === 0;
  if (changed && total > 0 && !reduceMotion.matches) cartCount.animate([{ transform: 'scale(1.5)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2, 1.8, .4, 1)' });
}

/* ---------- spring (response / damping ratio, as in Apple's model) ---------- */
function spring(from, to, velocity, { response = .4, damping = 1 } = {}, onUpdate, onDone) {
  const stiffness = (2 * Math.PI / response) ** 2;
  const drag = 4 * Math.PI * damping / response;
  let x = from, v = velocity, last = performance.now(), raf;
  const step = now => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    v += (-stiffness * (x - to) - drag * v) * dt;
    x += v * dt;
    if (Math.abs(x - to) < .4 && Math.abs(v) < 8) { onUpdate(to); onDone?.(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

const project = (velocity, rate = .998) => (velocity / 1000) * rate / (1 - rate);
const rubberband = (over, dim, k = .55) => (over * dim * k) / (dim + k * Math.abs(over));

/* ---------- sheet ---------- */
let pos = 0;                // current offset from the open position, px
let sheetOpen = false;
let stopAnim = null;
const axis = () => isDesktop.matches ? 'x' : 'y';
const sheetSize = () => axis() === 'x' ? sheet.offsetWidth : sheet.offsetHeight;

function setPos(value) {
  pos = value;
  const size = sheetSize() || 1;
  sheet.style.transform = axis() === 'x' ? `translate3d(${value}px,0,0)` : `translate3d(0,${value}px,0)`;
  scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - value / size)));
}

function settle(target, velocity = 0, damping = 1, done) {
  stopAnim?.();
  if (reduceMotion.matches) { setPos(target); done?.(); return; }
  stopAnim = spring(pos, target, velocity, { response: .42, damping }, setPos, done);
}

function openSheet(render) {
  view = render;
  render();
  sheetBody.classList.remove('enter'); void sheetBody.offsetWidth; sheetBody.classList.add('enter');
  clearTimeout(openSheet.t); openSheet.t = setTimeout(() => sheetBody.classList.remove('enter'), 1000);
  if (!sheetOpen) {
    previousFocus = document.activeElement;
    sheet.hidden = false; scrim.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const start = reduceMotion.matches ? 0 : sheetSize();
    setPos(start);
    if (reduceMotion.matches) { sheet.style.opacity = '0'; requestAnimationFrame(() => { sheet.style.opacity = '1'; scrim.style.opacity = '1'; }); }
    sheetOpen = true;
    settle(0);
    sheet.querySelector('#sheet-close').focus({ preventScroll: true });
  }
}

function closeSheet(velocity = 0) {
  if (!sheetOpen) return;
  sheetOpen = false;
  document.body.style.overflow = '';
  const finish = () => { sheet.hidden = true; scrim.hidden = true; sheet.setAttribute('aria-hidden', 'true'); if (new URL(location).searchParams.has('product')) history.replaceState(null, '', location.pathname); previousFocus?.focus?.({ preventScroll: true }); };
  if (reduceMotion.matches) { sheet.style.opacity = '0'; setTimeout(finish, 200); return; }
  settle(sheetSize(), velocity, 1, finish);
}

/* drag to dismiss on mobile: 1:1 tracking, momentum projection, velocity hand-off */
let drag = null;
sheetHead.addEventListener('pointerdown', event => {
  if (axis() !== 'y' || event.target.closest('button')) return;
  stopAnim?.();
  sheetHead.setPointerCapture(event.pointerId);
  drag = { startY: event.clientY, startPos: pos, history: [{ y: event.clientY, t: event.timeStamp }] };
});
sheetHead.addEventListener('pointermove', event => {
  if (!drag) return;
  drag.history.push({ y: event.clientY, t: event.timeStamp });
  if (drag.history.length > 6) drag.history.shift();
  const delta = drag.startPos + event.clientY - drag.startY;
  setPos(delta >= 0 ? delta : -rubberband(-delta, 600));
});
const endDrag = event => {
  if (!drag) return;
  const first = drag.history[0], last = drag.history.at(-1);
  const velocity = last.t > first.t ? (last.y - first.y) / (last.t - first.t) * 1000 : 0;
  drag = null;
  if (pos + project(velocity) > sheetSize() * .5) closeSheet(velocity);
  else settle(0, velocity, Math.abs(velocity) > 300 ? .8 : 1);
};
sheetHead.addEventListener('pointerup', endDrag);
sheetHead.addEventListener('pointercancel', endDrag);

scrim.addEventListener('click', () => closeSheet());
document.querySelector('#sheet-close').addEventListener('click', () => closeSheet());
document.addEventListener('keydown', event => {
  if (!sheetOpen) return;
  if (event.key === 'Escape') closeSheet();
  if (event.key === 'Tab') {
    const focusable = [...sheet.querySelectorAll('button:not(:disabled), a[href]:not([aria-disabled="true"])')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
isDesktop.addEventListener('change', () => { if (sheetOpen) setPos(0); });

/* ---------- catalog ---------- */
function imageMarkup(product) {
  return /^\/images\/[a-z0-9.-]+$/.test(product.image || '') ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy">` : `<span class="placeholder">${hanger}</span>`;
}

function tileMarkup(product, index) {
  const sub = [product.era, product.condition].filter(Boolean).join(' · ');
  const demo = product.id.startsWith('demo-') ? '<span class="pill">Пример</span>' : '';
  return `<button class="tile${product.sold ? ' sold' : ''}" type="button" data-id="${escapeHtml(product.id)}"><div class="tile-image">${imageMarkup(product)}${demo}</div><div class="tile-meta"><h3>${escapeHtml(product.title)}</h3><span class="price">${product.sold ? 'Ушло' : currency(product.price)}</span>${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ''}</div></button>`;
}

function renderProducts() {
  const live = products.filter(product => !product.sold), sold = products.filter(product => product.sold);
  grid.innerHTML = live.length ? live.map(tileMarkup).join('') : '<p class="empty">Пока ничего нет. Загляните позже.</p>';
  archiveGrid.innerHTML = sold.map(tileMarkup).join('');
  document.querySelector('#archive').hidden = document.querySelector('#archive-link').hidden = !sold.length;
  document.querySelector('#catalog-count').textContent = live.length ? `${live.length} ${plural(live.length, 'вещь', 'вещи', 'вещей')} · 1 of 1` : '';
  document.querySelector('#archive-count').textContent = sold.length ? `ушло: ${sold.length}` : '';
}

function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

function productView(product) {
  return () => {
    const inCart = cart.some(item => item.id === product.id);
    const description = product.id.startsWith('demo-') || !product.description ? '' : `<p class="sheet-desc">${escapeHtml(product.description)}</p>`;
    const rows = [['Эпоха', product.era], ['Происхождение', product.origin], ['Состояние', product.condition], ['Замеры, см', product.measures]].filter(([, value]) => value);
    const passport = rows.length ? `<dl class="passport">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : '';
    let action;
    if (product.sold) action = '<button class="primary" type="button" aria-disabled="true" disabled><span>Ушло к новому владельцу</span></button>';
    else if (inCart) action = '<button class="primary" id="open-cart" type="button"><span>Уже в корзине</span><span>Открыть →</span></button>';
    else action = `<button class="primary" id="add" type="button"><span>Добавить в корзину</span><span>${currency(product.price)}</span></button>`;
    sheetBody.dataset.product = product.id;
    sheetBody.innerHTML = `<div class="sheet-image">${imageMarkup(product)}</div><h2 id="sheet-title">${escapeHtml(product.title)}</h2>${product.sold ? '' : `<p class="sheet-price">${currency(product.price)}</p>`}${description}${passport}${action}`;
  };
}

function cartView() {
  cart = cart.filter(item => byId(item.id) && !byId(item.id).sold);
  const lines = cart.map(item => {
    const product = byId(item.id);
    return `<div class="cart-line"><div><h3>${escapeHtml(product.title)}</h3><button class="remove" type="button" data-remove="${escapeHtml(item.id)}">Убрать</button></div><strong>${currency(product.price)}</strong></div>`;
  }).join('');
  const link = cart.length && sellerTelegram ? `https://t.me/${sellerTelegram}?text=${encodeURIComponent(buildMessage())}` : '#';
  const disabled = !cart.length || !sellerTelegram;
  sheetBody.dataset.product = '';
  sheetBody.innerHTML = `<h2 id="sheet-title">Корзина</h2>${cart.length ? lines : '<p class="empty-cart">Пока пусто. Выберите вещь в каталоге.</p>'}<div class="total-row"><span>Итого</span><strong>${currency(cartTotal())}</strong></div><a class="primary" id="telegram-order" href="${link}" target="_blank" rel="noopener noreferrer" aria-disabled="${disabled}">Написать в Telegram</a><p class="hint">${sellerTelegram ? 'Откроется Telegram с готовым сообщением: список вещей и ссылки. Мы ничего о вас не собираем. Оплата на сайте не проводится.' : 'Telegram продавца пока не настроен.'}</p>`;
}

function buildMessage() {
  const lines = cart.map((item, index) => {
    const product = byId(item.id);
    return `${index + 1}. ${product.title} — ${currency(product.price)}
${location.origin}/?product=${product.id}`;
  });
  return `Привет! Зашёл на сайт, очень круто, хочу эти вещи:\n\n${lines.join('\n\n')}\n\nИтого: ${currency(cartTotal())}\nКак можно оформить?`;
}

document.querySelector('main').addEventListener('click', event => {
  const tile = event.target.closest('[data-id]');
  const product = tile && byId(tile.dataset.id);
  if (product) openSheet(productView(product));
});

sheetBody.addEventListener('click', event => {
  if (event.target.closest('#add')) {
    const id = sheetBody.dataset.product;
    if (!cart.some(item => item.id === id)) cart.push({ id });
    const flew = flyToCart();
    saveCart(flew);
    closeSheet();
    return;
  }
  if (event.target.closest('#open-cart')) { openSheet(cartView); return; }
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    cart = cart.filter(item => item.id !== remove.dataset.remove);
    saveCart();
    cartView();
    return;
  }
  const order = event.target.closest('#telegram-order');
  if (order?.getAttribute('aria-disabled') === 'true') event.preventDefault();
});

document.querySelector('#cart-toggle').addEventListener('click', () => openSheet(cartView));

/* ---------- motion ---------- */
function splitHeading() {
  let c = 0;
  document.querySelectorAll('#page-title [data-w]').forEach(word => {
    const text = word.textContent;
    word.classList.add('word');
    word.setAttribute('aria-hidden', 'true');
    word.innerHTML = [...text].map(ch => `<span class="ch" style="--c:${c++}">${ch}</span>`).join('');
  });
}

function observeTiles() {
  const cols = () => isDesktop.matches ? (matchMedia('(min-width: 1100px)').matches ? 4 : 3) : 2;
  const io = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const tile = entry.target;
    io.unobserve(tile);
    tile.style.setProperty('--col', [...tile.parentElement.children].indexOf(tile) % cols());
    tile.classList.add('in');
    setTimeout(() => tile.classList.add('done'), 1300);
  }), { rootMargin: '0px 0px -8% 0px', threshold: .08 });
  document.querySelectorAll('.tile').forEach(tile => io.observe(tile));
}

/* the item flies from the sheet into the cart */
function flyToCart() {
  const source = sheet.querySelector('.sheet-image');
  if (!source || reduceMotion.matches) return false;
  const from = source.getBoundingClientRect(), to = document.querySelector('#cart-toggle').getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.className = 'fly';
  ghost.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px`;
  ghost.innerHTML = source.innerHTML;
  document.body.append(ghost);
  const scale = Math.min(34 / from.width, 34 / from.height);
  const dx = to.left + to.width / 2 - 17 - from.left, dy = to.top + to.height / 2 - 17 - from.top;
  ghost.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * .55}px, ${dy * .2 - 40}px) scale(${scale * 3})`, opacity: 1, offset: .55 },
    { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0 }
  ], { duration: 780, easing: 'cubic-bezier(.45, .05, .2, 1)', fill: 'forwards' }).onfinish = () => { ghost.remove(); updateCount(); };
  return true;
}

async function init() {
  try {
    const config = await fetch('/config.json').then(response => response.json());
    sellerTelegram = /^[A-Za-z0-9_]{5,32}$/.test(config.sellerTelegram || '') ? config.sellerTelegram : '';
    const response = await fetch('/data/products.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Каталог недоступен.');
    products = (await response.json()).filter(product => product.active);
    splitHeading(); renderProducts(); observeTiles(); updateCount();
    const selected = byId(new URLSearchParams(location.search).get('product'));
    if (selected) openSheet(productView(selected));
  } catch (error) {
    grid.innerHTML = `<p class="empty">${escapeHtml(error.message)} Попробуйте обновить страницу.</p>`;
  }
}
init();
