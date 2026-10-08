/* open on the hero: the browser must not restore an old scroll position (the catalog loads after the page and would push it down) */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
// section links must not leave "#catalog" in the address bar, otherwise the next visit opens the catalog instead of the hero
const SECTIONS = ['#catalog'];
const cleanUrl = () => history.replaceState(null, '', location.pathname + location.search);
if (SECTIONS.includes(location.hash)) cleanUrl();
scrollTo(0, 0);
document.addEventListener('click', event => {
  const link = event.target.closest('a[href^="#"]');
  const target = link && SECTIONS.includes(link.getAttribute('href')) && document.querySelector(link.getAttribute('href'));
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
});

const ADMIN_PREVIEW = new URLSearchParams(location.search).has('admin-preview') && window.parent !== window;
const PAGE = document.body.dataset.page || 'home';
const grid = document.querySelector('#product-grid');
const archiveGrid = document.querySelector('#archive-grid');
const sheet = document.querySelector('#sheet');
const sheetBody = document.querySelector('#sheet-body');
const sheetHead = document.querySelector('#sheet-head');
const scrim = document.querySelector('#scrim');
const cartCount = document.querySelector('#cart-count');
const currency = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const VINTAGE_NOTICE = 'Все представленные вещи — винтаж и возврату не подлежат. Перед заказом проверьте замеры, состояние и отметки о дефектах.';
const RETURN_NOTICE = 'Винтажные вещи возврату не подлежат. Перед заказом уточните состояние и замеры у продавца в Telegram.';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const isDesktop = matchMedia('(min-width: 720px)');
const hanger = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M32 22v-3a5 5 0 1 0-5-5"/><path d="M32 22 6 42a3 3 0 0 0 2 5.3h48a3 3 0 0 0 2-5.3z"/></svg>';

let products = [];
let catalogReady = false;
let cart = readCart();
let sellerTelegram = '';
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
const orderable = product => product && product.active && !product.sold && !product.reserved;
const cartTotal = () => cart.reduce((sum, item) => sum + (orderable(byId(item.id)) ? byId(item.id).price : 0), 0);

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

const focusableIn = root => [...root.querySelectorAll('button:not(:disabled), a[href]:not([aria-disabled="true"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0);
function containFocus(root, event) {
  const items = focusableIn(root), first = items[0], last = items.at(-1);
  if (!first) { event.preventDefault(); root.focus(); return; }
  if (!root.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault(); (event.shiftKey ? last : first).focus();
  }
}
const backgroundInert = new Map();
function syncModalBackground() {
  const active = sheetOpen || !zoom.hidden;
  for (const child of document.body.children) {
    if (child === sheet || child === scrim || child === zoom || child.tagName === 'SCRIPT') continue;
    if (active) { if (!backgroundInert.has(child)) backgroundInert.set(child, child.inert); child.inert = true; }
    else if (backgroundInert.has(child)) { child.inert = backgroundInert.get(child); backgroundInert.delete(child); }
  }
  sheet.inert = !zoom.hidden;
  document.body.style.overflow = active ? 'hidden' : '';
}
let sheetGeneration = 0, sheetRenderer, zoomSource, pendingSheetRenderer, historyClosing = false;
const modalLayer = () => history.state?.rewearModal || 0;
function pushLayer(layer) {
  history.pushState({ ...history.state, rewearModal: layer }, '', location.href);
}
function requestLayerClose() {
  if (ADMIN_PREVIEW && zoom.hidden) { window.parent.postMessage({type:'rewear-preview-close'}, location.origin); return; }
  if (historyClosing) return;
  if (modalLayer()) { historyClosing = true; history.back(); }
  else if (!zoom.hidden) hideZoom();
  else hideSheet();
}
function openSheet(render, fromHistory = false) {
  if (historyClosing && !fromHistory) { pendingSheetRenderer = render; return; }
  const opening = !sheetOpen;
  if (opening && !fromHistory) {
    // Keep an incoming product link visible while open; Back returns to the same page.
    const incoming = location.href, base = new URL(incoming);
    base.searchParams.delete('product');
    history.replaceState({ ...history.state, rewearModal: 0 }, '', base.href);
    history.pushState({ ...history.state, rewearModal: 1 }, '', incoming);
  }
  if (opening && sheet.hidden) previousFocus = document.activeElement;
  ++sheetGeneration;
  stopAnim?.();
  sheetRenderer = render;
  sheetBody.dataset.view = '';
  render();
  sheetBody.classList.remove('enter'); void sheetBody.offsetWidth; sheetBody.classList.add('enter');
  clearTimeout(openSheet.t); openSheet.t = setTimeout(() => sheetBody.classList.remove('enter'), 1000);
  sheet.hidden = false; scrim.hidden = false;
  sheet.setAttribute('aria-hidden', 'false');
  sheet.style.opacity = '1';
  sheetOpen = true;
  syncModalBackground();
  if (opening) setPos(reduceMotion.matches ? 0 : sheetSize());
  settle(0);
  const title = sheetBody.querySelector('#sheet-title');
  if (title) title.tabIndex = -1;
  (opening ? sheet.querySelector('#sheet-close') : title || sheet.querySelector('#sheet-close')).focus({ preventScroll: true });
}
function closeSheet(velocity = 0) {
  if (ADMIN_PREVIEW) { window.parent.postMessage({type:'rewear-preview-close'}, location.origin); return; }
  if (!sheetOpen) return;
  closeSheet.velocity = velocity;
  requestLayerClose();
}
function hideSheet() {
  if (!sheetOpen) return;
  sheetOpen = false;
  const generation = ++sheetGeneration;
  const finish = () => {
    if (generation !== sheetGeneration || sheetOpen) return;
    sheet.hidden = true; scrim.hidden = true; sheet.setAttribute('aria-hidden', 'true');
    syncModalBackground(); onSheetClosed();
    if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
  };
  if (reduceMotion.matches) { sheet.style.opacity = '0'; setTimeout(finish, 200); return; }
  settle(sheetSize(), closeSheet.velocity || 0, 1, finish);
  closeSheet.velocity = 0;
}
window.addEventListener('popstate', () => {
  historyClosing = false;
  const layer = modalLayer();
  if (layer < 2 && !zoom.hidden) hideZoom();
  if (layer < 1) hideSheet();
  else if (!sheetOpen && sheetRenderer) openSheet(sheetRenderer, true);
  if (layer === 2 && zoom.hidden && zoomSource) openZoom(...zoomSource, true);
  if (pendingSheetRenderer) {
    const render = pendingSheetRenderer; pendingSheetRenderer = null;
    openSheet(render);
  }
});

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
  const root = !zoom.hidden ? zoom : sheetOpen ? sheet : null;
  if (!root) return;
  if (event.key === 'Escape') { event.preventDefault(); requestLayerClose(); }
  if (event.key === 'Tab') containFocus(root, event);
});
document.addEventListener('focusin', event => {
  const root = !zoom.hidden ? zoom : sheetOpen ? sheet : null;
  if (root && !root.contains(event.target)) focusableIn(root)[0]?.focus({ preventScroll: true });
});
isDesktop.addEventListener('change', () => { if (sheetOpen) setPos(0); });

/* ---------- catalog ---------- */
const previewData = src => ADMIN_PREVIEW && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(src || '');
const photosOf = product => (Array.isArray(product.images) && product.images.length ? product.images : product.image ? [product.image] : []).filter(src => typeof src === 'string' && (/^\/images\/[a-z0-9.-]+$/.test(src) || previewData(src)));
// A hand-made 4:5 preview (product.preview) wins in the grid; otherwise the whole original is shown with object-fit: contain.
const previewOf = product => ((/^\/images\/[a-z0-9./-]+\.(webp|png|jpg)$/.test(product.preview || '') || previewData(product.preview)) ? product.preview : photosOf(product)[0]);

const hasCut = product => /^\/images\/[a-z0-9./-]+\.(?:webp|png)$/.test(product.preview || '') || previewData(product.preview);
function imageMarkup(product) {
  const src = previewOf(product);
  return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.title)}" loading="lazy" decoding="async">` : `<span class="placeholder">${hanger}</span>`;
}

const CATEGORIES = ['Верхняя одежда', 'Штаны', 'Обувь', 'Аксессуары'];
const FILTER_GROUPS = [['category', 'Категория'], ['size', 'Размер'], ['brand', 'Бренд'], ['era', 'Эпоха']];
const filters = { category: '', size: '', brand: '', era: '', sort: 'new' };
let filtersOpen = false;
const decadeOf = value => {
  const match = String(value || '').match(/(\d{4}|\d{2})/);
  if (!match) return 0;
  let year = Number(match[1]);
  if (match[1].length === 2) year += year >= 40 ? 1900 : 2000;
  return Math.floor(year / 10) * 10;
};
const decadeLabel = decade => `${String(decade % 100).padStart(2, '0')}-е`;
const valueOf = (product, group) => group === 'era' ? (decadeOf(product.era) ? String(decadeOf(product.era)) : '') : String(product[group] || '');
const labelOf = (group, value) => group === 'era' ? decadeLabel(Number(value)) : value;

// items added through the admin carry createdAt; "Новое" for two weeks
const isNew = product => Boolean(product.createdAt) && Date.now() - Date.parse(product.createdAt) < 14 * 864e5;

function tileMarkup(product) {
  const status = product.sold ? '<span class="tag sold">Продано</span>' : product.reserved ? '<span class="tag">Бронь</span>' : isNew(product) ? '<span class="tag new">Новое</span>' : '';
  const count = photosOf(product).length + Number(hasCut(product));
  const size = product.size ? `<p class="tile-size">Размер: ${escapeHtml(product.size)}</p>` : '';
  const cond = product.condition ? `<p class="tile-cond">${escapeHtml(product.condition)}</p>` : '';
  return `<button class="tile" type="button" data-id="${escapeHtml(product.id)}"><div class="tile-image${hasCut(product) ? ' cut' : ''}">${imageMarkup(product)}${status}${count > 1 ? `<span class="count" aria-label="Фото: ${count}">${count} фото</span>` : ''}</div><div class="tile-meta"><h3 class="tile-title">${escapeHtml(product.title)}</h3>${size}<p class="tile-price">${currency(product.price)}</p>${cond}</div></button>`;
}

function visibleProducts() {
  const list = products.filter(product => !product.sold && FILTER_GROUPS.every(([group]) => !filters[group] || valueOf(product, group) === filters[group]));
  if (filters.sort === 'asc') list.sort((a, b) => a.price - b.price);
  if (filters.sort === 'desc') list.sort((a, b) => b.price - a.price);
  return list;
}

// Only groups that can actually narrow the list (2+ different values) are shown, so four items get a one-line toolbar.
function renderToolbar() {
  const toolbar = document.querySelector('#toolbar');
  const focused = document.activeElement;
  const restore = toolbar?.contains(focused) ? { id: focused.id, group: focused.dataset.filter, value: focused.dataset.value } : null;
  if (!toolbar) return;
  const live = products.filter(product => !product.sold);
  toolbar.hidden = live.length < 2;
  if (toolbar.hidden) return;
  const groups = FILTER_GROUPS.map(([group, title]) => {
    const present = new Set(live.map(product => valueOf(product, group)).filter(Boolean));
    // the four clothing groups are always shown (empty ones are dimmed); other groups only when there is something to choose between
    const values = group === 'category' ? CATEGORIES : [...present].sort((x, y) => group === 'era' ? Number(x) - Number(y) : x.localeCompare(y, 'ru', { numeric: true }));
    return { group, title, values, present };
  }).filter(({ group, values }) => group === 'category' || values.length > 1);
  const active = groups.filter(({ group }) => filters[group]).length;
  const panel = filtersOpen && groups.length ? `<div class="filter-panel" id="filter-panel">${groups.map(({ group, title, values, present }) => `<div class="filter-group"><h3>${title}</h3><div class="chips" role="group" aria-label="${title}">${values.map(value => `<button class="chip" type="button" data-filter="${group}" data-value="${escapeHtml(value)}"${present.has(value) || filters[group] === value ? '' : ' disabled'} aria-pressed="${String(filters[group] === value)}">${escapeHtml(labelOf(group, value))}</button>`).join('')}</div></div>`).join('')}${active ? '<button class="textlink" type="button" id="reset-filters">Сбросить фильтры</button>' : ''}</div>` : '';
  toolbar.innerHTML = `<div class="toolbar-row">${groups.length ? `<button class="tool" type="button" id="toggle-filters" aria-expanded="${String(filtersOpen)}" aria-controls="filter-panel">Фильтры${active ? `<span class="n">${active}</span>` : ''}</button>` : '<span></span>'}<label class="sort"><select id="sort" aria-label="Сортировка"><option value="new">Сначала новые</option><option value="asc">Сначала дешевле</option><option value="desc">Сначала дороже</option></select></label></div>${panel}`;
  toolbar.querySelector('#sort').value = filters.sort;
  if (restore) {
    const control = restore.group ? [...toolbar.querySelectorAll('[data-filter]')].find(el => el.dataset.filter === restore.group && el.dataset.value === restore.value) : toolbar.querySelector('#' + restore.id);
    (control || toolbar.querySelector('#toggle-filters'))?.focus({ preventScroll: true });
  }
}

function renderProducts() {
  const sold = products.filter(product => product.sold);
  const archiveLink = document.querySelector('#footer-archive');
  if (PAGE === 'sold') {
    archiveGrid.innerHTML = sold.length ? sold.map(tileMarkup).join('') : '<p class="empty">Пока ничего не продано.</p>';
    document.querySelector('#archive-count').textContent = sold.length ? `${sold.length} ${plural(sold.length, 'вещь', 'вещи', 'вещей')}` : '';
    return;
  }
  const live = visibleProducts(), total = products.filter(product => !product.sold).length;
  grid.innerHTML = live.length ? live.map(tileMarkup).join('') : total ? '<p class="empty">Ничего не нашлось. <button class="textlink" type="button" id="reset-filters">Сбросить фильтры</button></p>' : '<p class="empty">Пока ничего нет. Загляните позже.</p>';
  if (archiveLink) archiveLink.hidden = !sold.length;
  document.querySelector('#catalog-count').textContent = total ? `${live.length === total ? '' : `${live.length} из `}${total} ${plural(total, 'вещь', 'вещи', 'вещей')}` : '';
}

function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

function buyPanel(product, justAdded = false) {
  if (ADMIN_PREVIEW) return `<div class="buy"><span class="buy-price">${currency(product.price)}</span><p class="hint">Предпросмотр</p></div>`;
  if (product.sold) return '<div class="buy"><p class="buy-note">Эта вещь уже ушла к новому владельцу.</p></div>';
  if (product.reserved) return '<div class="buy"><div class="buy-row"><span class="buy-price">' + currency(product.price) + '</span><button class="primary" type="button" disabled>Забронировано</button></div></div>';
  if (justAdded || cart.some(item => item.id === product.id)) return `<div class="buy"><p class="added">${justAdded ? 'Добавлено в корзину' : 'Уже в корзине'}</p><div class="buy-actions"><button class="primary" id="open-cart" type="button">Открыть корзину</button><button class="ghost" id="keep-looking" type="button">Продолжить</button></div></div>`;
  return `<div class="buy"><div class="buy-row"><span class="buy-price">${currency(product.price)}</span><button class="primary" id="add" type="button">В корзину</button></div></div>`;
}

// up to four other pieces: same category first, then the newest
function relatedMarkup(product) {
  const live = ADMIN_PREVIEW ? [] : products.filter(item => item.id !== product.id && !item.sold && !item.reserved);
  const same = live.filter(item => product.category && item.category === product.category);
  const picks = [...same, ...live.filter(item => !same.includes(item))].slice(0, 4);
  if (!picks.length) return '';
  return `<h3 class="block-title">${picks.every(item => same.includes(item)) ? 'Ещё из этой категории' : 'Ещё вещи'}</h3><div class="related">${picks.map(tileMarkup).join('')}</div>`;
}

function productView(product) {
  return () => {
    sheet.classList.remove('narrow');
    sheetBody.className = 'sheet-body product';
    const originals = photosOf(product);
    // Clean cover first, then originals with their original defect associations.
    const cut = hasCut(product) ? previewOf(product) : '';
    const slideList = [...(cut ? [{ src: cut, cut: true }] : []), ...originals.map((src, i) => ({ src, index: i }))];
    const slideOffset = cut ? 1 : 0;
    const defects = (Array.isArray(product.notes) ? product.notes : []).filter(note => note.type === 'flaw');
    const description = !product.description ? '' : `<p class="sheet-desc">${escapeHtml(product.description)}</p>`;
    const summary = [product.size && `Размер: ${product.size}`, product.condition].filter(Boolean).map(escapeHtml).join(' · ');
    const rows = [['Категория', product.category], ['Размер', product.size], ['Бренд', product.brand], ['Эпоха', product.era], ['Происхождение', product.origin], ['Состояние', product.condition], ['Замеры, см', product.measures]].filter(([, value]) => value);
    const passport = rows.length ? `<h3 class="block-title">Паспорт вещи</h3><dl class="passport">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : '';
    const pinsFor = index => defects.map((note, i) => (note.img || 0) === index ? `<button class="pin flaw" type="button" data-note="${i}" style="left:${Number(note.x)}%;top:${Number(note.y)}%" aria-label="Дефект ${i + 1}: ${escapeHtml(note.text)}">${i + 1}</button>` : '').join('');
    const slides = slideList.length ? slideList.map((slide, n) => `<figure class="slide"><div class="pinbox${slide.cut ? ' cutbox' : ''}"><button class="photo-open" type="button" data-zoom="${escapeHtml(slide.src)}" aria-label="Открыть фото ${n + 1}: ${escapeHtml(product.title)}"><img src="${escapeHtml(slide.src)}" alt="${escapeHtml(product.title)}, ${n + 1} из ${slideList.length}"${n ? ' loading="lazy"' : ''}></button>${slide.cut ? '' : pinsFor(slide.index)}</div></figure>`).join('') : `<figure class="slide"><div class="pinbox empty"><span class="placeholder">${hanger}</span></div></figure>`;
    const dots = slideList.length > 1 ? `<span class="counter" id="counter">1 / ${slideList.length}</span><div class="dots">${slideList.map((_, i) => `<button type="button" class="dot" data-slide="${i}" aria-label="Фото ${i + 1}" aria-current="${i === 0}"></button>`).join('')}</div>` : '';
    const tools = defects.length && originals.length ? '<div class="gallery-tools"><button type="button" id="toggle-pins" aria-pressed="false">Показать дефекты</button></div>' : '';
    const noteList = defects.length ? `<h3 class="block-title">Дефекты</h3><ol class="notes">${defects.map((note, i) => `<li><button class="note flaw" type="button" data-note="${i}" data-img="${(note.img || 0) + slideOffset}"><span>${i + 1}</span><b>${escapeHtml(note.text)}</b></button></li>`).join('')}</ol>` : '';
    sheetBody.dataset.product = product.id;
    sheetBody.innerHTML = `<div class="gallery"><div class="slides" id="slides" tabindex="0" aria-label="Фото вещи, листайте вбок">${slides}</div>${dots}${tools}</div><div class="title-row"><h2 id="sheet-title">${escapeHtml(product.title)}</h2>${ADMIN_PREVIEW ? '' : `<button class="textlink share" type="button" data-share="${escapeHtml(product.id)}">Поделиться</button>`}</div>${summary ? `<p class="product-summary">${summary}</p>` : ''}${description}${passport}${noteList}<p class="hint vintage-terms">${escapeHtml(VINTAGE_NOTICE)}</p>${relatedMarkup(product)}${buyPanel(product)}`;
    const slidesEl = sheetBody.querySelector('#slides');
    slidesEl?.addEventListener('scroll', () => {
      const index = Math.round(slidesEl.scrollLeft / (slidesEl.clientWidth || 1));
      const counter = sheetBody.querySelector('#counter');
      if (counter) counter.textContent = `${index + 1} / ${slideList.length}`;
      sheetBody.querySelectorAll('.dot').forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    }, { passive: true });
  };
}

let catalogRequest = null, cartBusy = false, cartNotice = '', cartCopyText = '';
const lastKnownProducts = new Map();
async function fetchCatalog() {
  if (catalogRequest) return catalogRequest;
  catalogRequest = (async () => {
    const response = await fetch('/data/products.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Не удалось проверить наличие.');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Не удалось проверить наличие.');
    for (const product of products) lastKnownProducts.set(product.id, product);
    products = data.filter(product => product && product.active);
    catalogReady = true;
    for (const product of products) lastKnownProducts.set(product.id, product);
    renderToolbar(); renderProducts(); updateCount();
  })();
  try { await catalogRequest; } finally { catalogRequest = null; }
}
const cartSignature = () => JSON.stringify(cart.map(({id}) => { const p = byId(id); return [id, p?.price, p?.title, !!orderable(p)]; }));
async function refreshCart() {
  const before = cartSignature();
  await fetchCatalog();
  return before !== cartSignature();
}
function renderCurrentCart() {
  if (sheetOpen && sheetRenderer === cartView) {
    const focused = sheetBody.contains(document.activeElement) ? document.activeElement.id : '';
    cartView();
    if (focused) {
      const title = sheetBody.querySelector('#sheet-title'); if (title) title.tabIndex = -1;
      const target = sheetBody.querySelector('#' + focused);
      (target && !target.disabled ? target : title)?.focus({preventScroll:true});
    }
  }
}
async function openCart() {
  cartNotice = ''; cartCopyText = ''; cartBusy = true;
  openSheet(cartView);
  try { if (await refreshCart()) cartNotice = 'Наличие или цены обновились. Проверьте список перед заказом.'; }
  catch { cartNotice = 'Не удалось проверить наличие. Проверьте соединение и попробуйте ещё раз.'; }
  finally { cartBusy = false; renderCurrentCart(); }
}
async function prepareOrder() {
  if (cartBusy || ADMIN_PREVIEW) return null;
  const generation = sheetGeneration;
  cartBusy = true; cartNotice = ''; cartCopyText = ''; renderCurrentCart();
  try {
    const changed = await refreshCart();
    if (generation !== sheetGeneration || !cart.length) return null;
    if (cart.some(item => !orderable(byId(item.id)))) { cartNotice = 'Некоторые вещи уже недоступны. Уберите их из заказа.'; return null; }
    if (changed) { cartNotice = 'Наличие или цены изменились. Проверьте итог и нажмите оформить ещё раз.'; return null; }
    return sellerTelegram ? `https://t.me/${sellerTelegram}?text=${encodeURIComponent(buildMessage())}` : null;
  } catch { cartNotice = 'Не удалось проверить наличие. Проверьте соединение и попробуйте ещё раз.'; return null; }
  finally { cartBusy = false; renderCurrentCart(); }
}
function cartView() {
  sheet.classList.add('narrow'); sheetBody.className = 'sheet-body'; sheetBody.dataset.product = ''; sheetBody.dataset.view = 'cart';
  if (!catalogReady) {
    sheetBody.innerHTML = `<h2 id="sheet-title">Корзина</h2><p class="hint" role="status">${cartNotice || 'Проверяем наличие… Ваш список вещей сохранён.'}</p><button class="ghost" id="refresh-cart" type="button" ${cartBusy ? 'disabled' : ''}>Проверить ещё раз</button>`;
    return;
  }
  if (!cart.length) {
    sheetBody.innerHTML = '<h2 id="sheet-title">Корзина</h2><div class="empty-cart"><p>В корзине пока пусто. Выберите вещь в каталоге.</p><button class="primary" id="to-catalog" type="button">Перейти в каталог</button></div>';
    return;
  }
  const unavailable = cart.some(item => !orderable(byId(item.id)));
  const lines = cart.map(item => {
    const current = byId(item.id), product = current || lastKnownProducts.get(item.id) || {title:'Вещь больше недоступна',price:0};
    const reason = !current ? 'Больше не в продаже' : current.sold ? 'Продано' : current.reserved ? 'Забронировано' : '';
    const sub = [product.size && `Размер: ${product.size}`, product.brand, product.condition].filter(Boolean).join(' · ');
    return `<div class="cart-line${reason ? ' unavailable' : ''}"><div class="cart-thumb${hasCut(product) ? ' cut' : ''}">${imageMarkup(product)}</div><div><h3>${escapeHtml(product.title)}</h3>${sub ? `<p class="cart-sub">${escapeHtml(sub)}</p>` : ''}${reason ? `<p class="cart-unavailable">${reason}</p>` : ''}<button class="remove" type="button" data-remove="${escapeHtml(item.id)}">Убрать</button></div><strong>${reason ? '—' : currency(product.price)}</strong></div>`;
  }).join('');
  const disabled = !sellerTelegram || unavailable || cartBusy;
  sheetBody.innerHTML = `<h2 id="sheet-title">Корзина</h2><p class="cart-count">${cart.length} ${plural(cart.length, 'вещь', 'вещи', 'вещей')} · каждая в единственном экземпляре</p>${lines}<p class="cart-notice" role="status">${escapeHtml(cartBusy ? 'Проверяем наличие и цены…' : cartNotice || (unavailable ? 'Уберите недоступные вещи, чтобы оформить заказ.' : ''))}</p>${cartCopyText ? `<label class="copy-order-label" for="order-text">Текст заказа — выделите и скопируйте</label><textarea id="order-text" class="order-text" readonly rows="8">${escapeHtml(cartCopyText)}</textarea>` : ''}<div class="total-row"><span>Итого</span><strong>${currency(cartTotal())}</strong></div><p class="hint vintage-terms">${escapeHtml(VINTAGE_NOTICE)}</p><div class="buy"><button class="primary wide" id="telegram-order" type="button" aria-disabled="${disabled}" ${disabled ? 'disabled' : ''}>${cartBusy ? 'Проверяем…' : 'Оформить в Telegram'}</button><button class="ghost wide" id="copy-order" type="button" ${disabled ? 'disabled' : ''}>Скопировать заказ</button><p class="hint">${sellerTelegram ? 'Оплату и доставку согласуем лично в Telegram.' : 'Telegram продавца пока не настроен.'}</p></div>`;
}

function buildMessage() {
  const lines = cart.map((item, index) => {
    const product = byId(item.id);
    return `${index + 1}. ${product.title} — ${currency(product.price)}\n${location.origin}/p/${product.id}`;
  });
  return `Здравствуйте! Хочу приобрести следующие товары:\n\n${lines.join('\n\n')}\n\nИтого: ${currency(cartTotal())}`;
}

/* ---------- photo zoom (opens the original) ---------- */
const zoom = document.querySelector('#zoom'), zoomScroll = document.querySelector('#zoom-scroll'), zoomImg = document.querySelector('#zoom-img');
let zoomFocus;
function openZoom(src, alt, fromHistory = false) {
  zoomFocus = document.activeElement;
  zoomSource = [src, alt];
  if (!fromHistory) pushLayer(2);
  zoomImg.src = src; zoomImg.alt = alt || '';
  zoomScroll.classList.remove('zoomed');
  zoomToggle.setAttribute('aria-pressed', 'false');
  zoomToggle.setAttribute('aria-label', 'Приблизить фото');
  zoom.hidden = false;
  syncModalBackground();
  zoom.querySelector('#zoom-close').focus({ preventScroll: true });
}
function hideZoom() {
  zoom.hidden = true; zoomImg.removeAttribute('src'); syncModalBackground();
  if (zoomFocus?.isConnected) zoomFocus.focus({ preventScroll: true });
}
function closeZoom() { requestLayerClose(); }
zoom.querySelector('#zoom-close').addEventListener('click', closeZoom);
const zoomToggle = document.querySelector('#zoom-toggle');
zoomToggle.addEventListener('click', event => {
  const zoomed = zoomScroll.classList.toggle('zoomed');
  zoomToggle.setAttribute('aria-pressed', String(zoomed));
  zoomToggle.setAttribute('aria-label', zoomed ? 'Уменьшить фото' : 'Приблизить фото');
  if (zoomed) {
    const box = zoomImg.getBoundingClientRect();
    const x = event.detail ? (event.clientX - box.left) / (box.width || 1) : .5;
    const y = event.detail ? (event.clientY - box.top) / (box.height || 1) : .5;
    requestAnimationFrame(() => {
      zoomScroll.scrollLeft = Math.max(0, (zoomImg.offsetWidth - zoomScroll.clientWidth) * x);
      zoomScroll.scrollTop = Math.max(0, (zoomImg.offsetHeight - zoomScroll.clientHeight) * y);
    });
  }
});

/* ---------- events ---------- */
document.querySelector('main').addEventListener('click', event => {
  if (event.target.closest('#toggle-filters')) { filtersOpen = !filtersOpen; renderToolbar(); return; }
  const chip = event.target.closest('[data-filter]');
  if (chip) {
    const group = chip.dataset.filter;
    filters[group] = filters[group] === chip.dataset.value ? '' : chip.dataset.value;
    renderToolbar(); renderProducts();
    return;
  }
  if (event.target.closest('#reset-filters')) { for (const [group] of FILTER_GROUPS) filters[group] = ''; renderToolbar(); renderProducts(); return; }
  const tile = event.target.closest('[data-id]');
  const product = tile && byId(tile.dataset.id);
  if (product) openSheet(productView(product));
});

document.querySelector('main').addEventListener('change', event => {
  if (event.target.id !== 'sort') return;
  filters.sort = event.target.value;
  renderProducts();
});

const slideTo = index => {
  const slidesEl = sheetBody.querySelector('#slides');
  slidesEl?.scrollTo({ left: Number(index) * slidesEl.clientWidth, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
};

sheetBody.addEventListener('click', async event => {
  const related = event.target.closest('.related [data-id]');
  if (related && byId(related.dataset.id)) { openSheet(productView(byId(related.dataset.id))); sheetBody.scrollTop = 0; return; }
  const dot = event.target.closest('[data-slide]');
  if (dot) { slideTo(dot.dataset.slide); return; }
  const share = event.target.closest('[data-share]');
  if (share) {
    const url = `${location.origin}/p/${share.dataset.share}`;
    const title = byId(share.dataset.share)?.title || 'REWEAR';
    if (navigator.share) navigator.share({ title, url }).catch(() => {});
    else navigator.clipboard?.writeText(url).then(() => { share.textContent = 'Ссылка скопирована'; setTimeout(() => { share.textContent = 'Поделиться'; }, 1800); }).catch(() => {});
    return;
  }
  const toggle = event.target.closest('#toggle-pins');
  if (toggle) {
    const on = toggle.getAttribute('aria-pressed') !== 'true';
    toggle.setAttribute('aria-pressed', String(on));
    toggle.textContent = on ? 'Скрыть дефекты' : 'Показать дефекты';
    sheetBody.querySelectorAll('.pinbox').forEach(box => box.classList.toggle('pins-on', on));
    // defects are marked on the originals: jump to the first photo that has a pin
    const slidesEl = sheetBody.querySelector('#slides');
    const first = sheetBody.querySelector('.note');
    if (on && slidesEl && first) {
      const current = Math.round(slidesEl.scrollLeft / (slidesEl.clientWidth || 1));
      const hasPin = sheetBody.querySelectorAll('.slide')[current]?.querySelector('.pin');
      if (!hasPin) slideTo(first.dataset.img);
    }
    return;
  }
  const noteButton = event.target.closest('[data-note]');
  if (noteButton) {
    const was = noteButton.classList.contains('on');
    sheetBody.querySelectorAll('[data-note]').forEach(el => el.classList.remove('on'));
    if (!was) {
      sheetBody.querySelectorAll(`[data-note="${noteButton.dataset.note}"]`).forEach(el => el.classList.add('on'));
      const toggleEl = sheetBody.querySelector('#toggle-pins');
      if (toggleEl && toggleEl.getAttribute('aria-pressed') !== 'true') toggleEl.click();
      if (noteButton.classList.contains('note')) {
        slideTo(noteButton.dataset.img);
        sheetBody.scrollTo({ top: 0, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
        sheetBody.querySelector('#slides')?.focus({ preventScroll: true });
      }
    }
    return;
  }
  const photo = event.target.closest('[data-zoom]');
  if (photo) { openZoom(photo.dataset.zoom, photo.querySelector('img')?.alt); return; }
  if (event.target.closest('#add')) {
    const id = sheetBody.dataset.product;
    if (!cart.some(item => item.id === id)) cart.push({ id });
    saveCart();
    sheetBody.querySelector('.buy').outerHTML = buyPanel(byId(id), true);
    sheetBody.querySelector('#open-cart')?.focus({ preventScroll: true });
    return;
  }
  if (event.target.closest('#open-cart') || event.target.closest('#refresh-cart')) { await openCart(); return; }
  if (event.target.closest('#keep-looking')) { closeSheet(); return; }
  if (event.target.closest('#to-catalog')) { closeSheet(); const catalog = document.querySelector('#catalog'); if (catalog) catalog.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' }); else location.href = '/'; return; }
  const remove = event.target.closest('[data-remove]');
  if (remove) {
    cart = cart.filter(item => item.id !== remove.dataset.remove);
    cartCopyText = ''; cartNotice = '';
    saveCart();
    const index = [...sheetBody.querySelectorAll('[data-remove]')].indexOf(remove);
    cartView();
    const remaining = [...sheetBody.querySelectorAll('[data-remove]')];
    (remaining[Math.min(index, remaining.length - 1)] || sheetBody.querySelector('#to-catalog'))?.focus({ preventScroll: true });
    return;
  }
  const order = event.target.closest('#telegram-order'), copy = event.target.closest('#copy-order');
  if (order || copy) {
    event.preventDefault();
    const href = await prepareOrder();
    if (!href) return;
    if (order) location.assign(href);
    else {
      try { await navigator.clipboard.writeText(buildMessage()); cartNotice = 'Заказ скопирован. Отправьте его продавцу в Telegram.'; }
      catch { cartCopyText = buildMessage(); cartNotice = 'Браузер не разрешил копирование. Скопируйте текст ниже вручную.'; }
      renderCurrentCart();
      if (cartCopyText) { const field = sheetBody.querySelector('#order-text'); field?.focus(); field?.select(); }
    }
  }
});


/* ---------- FAQ ---------- */
const FAQ = [
  ['Как заказать?', 'Добавьте вещи в корзину и нажмите «Оформить в Telegram»: откроется чат с готовым списком вещей и ссылками. Мы подтвердим наличие и договоримся о деталях.'],
  ['Что значит «в одном экземпляре»?', 'Каждая вещь винтажная и существует в единственном экземпляре. Когда вещь уходит, она переезжает в раздел «Проданное».'],
  ['Что значит «Бронь»?', 'Вещь придержана за покупателем. Пока бронь не снята, заказать её нельзя.'],
  ['Как выбрать размер?', 'В паспорте вещи указаны замеры в сантиметрах. Сравните их с вашей любимой вещью, а не ориентируйтесь на размер на бирке: у винтажа он часто отличается от современного.'],
  ['Что такое дефекты на фото?', 'Мы честно отмечаем потёртости, пятна и следы ремонта. В карточке есть оригинальные фото и список дефектов. Нажмите на дефект, чтобы перейти к нужному снимку.'],
  ['Оплата и доставка?', 'Согласуем лично в Telegram.'],
  ['Вещи винтажные?', VINTAGE_NOTICE],
  ['Можно вернуть вещь?', RETURN_NOTICE],
  ['Какие данные вы собираете?', 'Корзина и выбор аналитики сохраняются локально в вашем браузере. При оформлении список выбранных вещей передаётся в Telegram. Яндекс Метрика загружается только при настроенном счётчике и вашем согласии; она собирает статистику посещений. Изменить согласие можно по ссылке «Cookie».']
];
function faqView() {
  sheet.classList.add('narrow');
  sheetBody.className = 'sheet-body';
  sheetBody.dataset.product = '';
  sheetBody.innerHTML = `<h2 id="sheet-title">FAQ</h2><div class="faq">${FAQ.map(([q, answer]) => `<details><summary>${escapeHtml(q)}</summary><p>${escapeHtml(answer)}</p></details>`).join('')}</div><div class="buy"><a class="primary wide" data-telegram href="${sellerTelegram ? `https://t.me/${sellerTelegram}` : '#'}" target="_blank" rel="noopener noreferrer" aria-disabled="${String(!sellerTelegram)}">Задать вопрос в Telegram</a></div>`;
}

document.addEventListener('click', event => {
  const go = event.target.closest('[data-go]');
  if (!go) return;
  if (go.dataset.go === 'faq') { event.preventDefault(); openSheet(faqView); }
  if (go.dataset.go === 'cookies') { event.preventDefault(); openCookieSettings(); }
});

document.querySelector('#cart-btn').addEventListener('click', openCart);

/* ---------- cookies and analytics consent ---------- */
// Choice lives in localStorage ({ analytics, at }). Yandex Metrica loads only after "Принять" and only if a counter id is set in config.json.
const CONSENT_KEY = 'rewear-consent';
const consentBox = document.querySelector('#consent');
let metrikaId = '', metrikaLoaded = false, consentPending = false;

function readConsent() {
  try { const value = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null'); return value && typeof value.analytics === 'boolean' ? value : null; } catch { return null; }
}

function loadMetrika() {
  if (metrikaLoaded || !metrikaId) return;
  metrikaLoaded = true;
  window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
  window.ym.l = Date.now();
  const script = document.createElement('script');
  script.async = true; script.src = 'https://mc.yandex.ru/metrika/tag.js';
  document.head.append(script);
  window.ym(Number(metrikaId), 'init', { clickmap: true, trackLinks: true, accurateTrackBounce: true });
}

function saveConsent(analytics) {
  const wasOn = readConsent()?.analytics;
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ analytics, at: new Date().toISOString() })); } catch {}
  consentBox.hidden = true;
  consentPending = false;
  if (analytics) loadMetrika();
  // an already running counter cannot be unloaded from the page; a reload starts the site without it
  else if (wasOn && metrikaLoaded) location.reload();
}

function cookieView() {
  return () => {
    sheet.classList.add('narrow');
    sheetBody.className = 'sheet-body';
    sheetBody.dataset.product = '';
    sheetBody.innerHTML = `<h2 id="sheet-title">Cookie и аналитика</h2>
      <div id="cookie-info">
        <section class="cookie-option"><h3>Необходимые</h3><p>Хранят корзину и ваше согласие в браузере. Нужны для работы сайта и используются всегда.</p></section>
        <section class="cookie-option"><h3>Аналитика</h3><p>Яндекс Метрика собирает статистику посещений: какие страницы и вещи открывают и с каких устройств. Данные обрабатывает ООО «Яндекс». Счётчик загружается только после вашего согласия.${metrikaId ? '' : ' Сейчас аналитика ещё не подключена: ваше решение сохранится.'}</p></section>
      </div>
      <p class="cookie-note">Нажимая «Принять всё», вы соглашаетесь на использование всех описанных выше технологий. Отказ оставит только необходимое для работы сайта. Решение можно изменить по ссылке «Cookie» внизу страницы.</p>
      <div class="buy"><div class="consent-actions"><button class="consent-btn" type="button" data-consent="decline">Отказаться</button><button class="consent-btn primary-c" type="button" data-consent="accept">Принять всё</button></div></div>`;
  };
}

function openCookieSettings() {
  consentBox.hidden = true;
  openSheet(cookieView());
}

function onSheetClosed() {
  if (consentPending && !readConsent()) consentBox.hidden = false;
}

function setupConsent(config) {
  metrikaId = /^\d{5,12}$/.test(String(config.yandexMetrika || '')) ? String(config.yandexMetrika) : '';
  const choice = readConsent();
  if (choice?.analytics) loadMetrika();
  consentPending = !choice;
  consentBox.hidden = Boolean(choice);
}

document.addEventListener('click', event => {
  const action = event.target.closest('[data-consent]')?.dataset.consent;
  if (!action) return;
  if (action === 'details') { openCookieSettings(); return; }
  saveConsent(action === 'accept');
  if (sheetOpen && sheetBody.querySelector('#cookie-info')) closeSheet();
});

async function init() {
  try {
    const config = await fetch('/config.json').then(response => response.json());
    sellerTelegram = /^[A-Za-z0-9_]{5,32}$/.test(config.sellerTelegram || '') ? config.sellerTelegram : '';
    await fetchCatalog();
    renderCurrentCart();
    const channel = /^[A-Za-z0-9_]{5,32}$/.test(config.telegramChannel || '') ? config.telegramChannel : '';
    // the footer Telegram link leads to the shop channel; without one it falls back to the seller's chat
    const channelLink = document.querySelector('#footer-channel');
    if (channel || sellerTelegram) channelLink.href = `https://t.me/${channel || sellerTelegram}`;
    channelLink.hidden = !channel && !sellerTelegram;
    setupConsent(config);
    document.querySelectorAll('[data-telegram]').forEach(link => { if (sellerTelegram) link.href = `https://t.me/${sellerTelegram}`; else link.hidden = true; });
    scrollTo(0, 0);
    const selected = byId(new URLSearchParams(location.search).get('product'));
    if (selected) openSheet(productView(selected));
  } catch (error) {
    const targetGrid = PAGE === 'sold' ? archiveGrid : grid;
    if (targetGrid) targetGrid.innerHTML = `<p class="empty">${escapeHtml(error.message)} Попробуйте обновить страницу.</p>`;
  }
}
if (ADMIN_PREVIEW) {
  document.body.classList.add('admin-preview');
  window.addEventListener('message', event => {
    if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== 'rewear-admin-preview') return;
    const product = event.data.product;
    if (!product || typeof product.title !== 'string' || !Number.isFinite(product.price)) return;
    products = [product]; catalogReady = true;
    openSheet(productView(product));
  });
  window.parent.postMessage({type:'rewear-preview-ready'}, location.origin);
} else {
  init();
}

/* ---------- hero: sunlight gliding over the rug (phones for now) ---------- */
(() => {
  const video = document.querySelector('#hero-video');
  if (!video || ADMIN_PREVIEW) return;
  const phone = matchMedia('(max-width: 719px)');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const lean = navigator.connection?.saveData;
  if (!phone.matches || calm.matches || lean) return;
  video.poster = '/images/hero-mobile-poster.webp';
  video.src = '/video/hero-mobile.mp4';
  video.hidden = false;
  // play only while the hero is on screen, and never fail loudly if the browser blocks autoplay (the poster stays)
  const io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) video.play().catch(() => {});
    else video.pause();
  }, { threshold: .15 });
  io.observe(video);
})();
