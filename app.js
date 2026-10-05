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
  if (!zoom.hidden) { if (event.key === 'Escape') closeZoom(); return; }
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
const photosOf = product => (Array.isArray(product.images) && product.images.length ? product.images : product.image ? [product.image] : []).filter(src => /^\/images\/[a-z0-9.-]+$/.test(src));
// A hand-made 4:5 preview (product.preview) wins in the grid; otherwise the whole original is shown with object-fit: contain.
const previewOf = product => (/^\/images\/[a-z0-9./-]+\.(webp|png|jpg)$/.test(product.preview || '') ? product.preview : photosOf(product)[0]);

const hasCut = product => /^\/images\/[a-z0-9./-]+\.webp$/.test(product.preview || '');
function imageMarkup(product) {
  const src = previewOf(product);
  return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(product.title)}" loading="lazy" decoding="async">` : `<span class="placeholder">${hanger}</span>`;
}

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

function tileMarkup(product) {
  const status = product.sold ? '<span class="tag sold">Продано</span>' : product.reserved ? '<span class="tag">Бронь</span>' : '';
  const count = photosOf(product).length;
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
  const live = products.filter(product => !product.sold);
  toolbar.hidden = live.length < 2;
  if (toolbar.hidden) return;
  const groups = FILTER_GROUPS.map(([group, title]) => {
    const values = [...new Set(live.map(product => valueOf(product, group)).filter(Boolean))].sort((a, b) => group === 'era' ? Number(a) - Number(b) : a.localeCompare(b, 'ru', { numeric: true }));
    return { group, title, values };
  }).filter(({ values }) => values.length > 1);
  const active = groups.filter(({ group }) => filters[group]).length;
  const panel = filtersOpen && groups.length ? `<div class="filter-panel" id="filter-panel">${groups.map(({ group, title, values }) => `<div class="filter-group"><h3>${title}</h3><div class="chips" role="group" aria-label="${title}">${values.map(value => `<button class="chip" type="button" data-filter="${group}" data-value="${escapeHtml(value)}" aria-pressed="${String(filters[group] === value)}">${escapeHtml(labelOf(group, value))}</button>`).join('')}</div></div>`).join('')}${active ? '<button class="textlink" type="button" id="reset-filters">Сбросить фильтры</button>' : ''}</div>` : '';
  toolbar.innerHTML = `<div class="toolbar-row">${groups.length ? `<button class="tool" type="button" id="toggle-filters" aria-expanded="${String(filtersOpen)}" aria-controls="filter-panel">Фильтры${active ? `<span class="n">${active}</span>` : ''}</button>` : '<span></span>'}<label class="sort"><select id="sort" aria-label="Сортировка"><option value="new">Сначала новые</option><option value="asc">Сначала дешевле</option><option value="desc">Сначала дороже</option></select></label></div>${panel}`;
  toolbar.querySelector('#sort').value = filters.sort;
}

function renderProducts() {
  const sold = products.filter(product => product.sold), live = visibleProducts();
  const total = products.filter(product => !product.sold).length;
  grid.innerHTML = live.length ? live.map(tileMarkup).join('') : total ? '<p class="empty">Ничего не нашлось. <button class="textlink" type="button" id="reset-filters">Сбросить фильтры</button></p>' : '<p class="empty">Пока ничего нет. Загляните позже.</p>';
  archiveGrid.innerHTML = sold.map(tileMarkup).join('');
  document.querySelector('#archive').hidden = document.querySelector('#archive-link').hidden = !sold.length;
  document.querySelector('#catalog-count').textContent = total ? `${live.length === total ? '' : `${live.length} из `}${total} ${plural(total, 'вещь', 'вещи', 'вещей')}` : '';
  document.querySelector('#archive-count').textContent = sold.length ? `${sold.length} ${plural(sold.length, 'вещь', 'вещи', 'вещей')}` : '';
}

function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
}

function buyPanel(product, justAdded = false) {
  if (product.sold) return '<div class="buy"><p class="buy-note">Эта вещь уже ушла к новому владельцу.</p></div>';
  if (product.reserved) return '<div class="buy"><div class="buy-row"><span class="buy-price">' + currency(product.price) + '</span><button class="primary" type="button" disabled>Забронировано</button></div></div>';
  if (justAdded || cart.some(item => item.id === product.id)) return `<div class="buy"><p class="added">${justAdded ? 'Добавлено в корзину' : 'Уже в корзине'}</p><div class="buy-actions"><button class="primary" id="open-cart" type="button">Открыть корзину</button><button class="ghost" id="keep-looking" type="button">Продолжить</button></div></div>`;
  return `<div class="buy"><div class="buy-row"><span class="buy-price">${currency(product.price)}</span><button class="primary" id="add" type="button">В корзину</button></div></div>`;
}

function productView(product) {
  return () => {
    sheet.classList.remove('narrow');
    sheetBody.className = 'sheet-body product';
    const photos = photosOf(product);
    const notes = Array.isArray(product.notes) ? product.notes : [];
    const description = !product.description ? '' : `<p class="sheet-desc">${escapeHtml(product.description)}</p>`;
    const rows = [['Категория', product.category], ['Размер', product.size], ['Бренд', product.brand], ['Эпоха', product.era], ['Происхождение', product.origin], ['Состояние', product.condition], ['Замеры, см', product.measures]].filter(([, value]) => value);
    const passport = rows.length ? `<h3 class="block-title">Паспорт вещи</h3><dl class="passport">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>` : '';
    const pinsFor = index => notes.map((note, i) => (note.img || 0) === index ? `<button class="pin${note.type === 'flaw' ? ' flaw' : ''}" type="button" data-note="${i}" style="left:${Number(note.x)}%;top:${Number(note.y)}%" aria-label="${note.type === 'flaw' ? 'Дефект' : 'Деталь'} ${i + 1}: ${escapeHtml(note.text)}">${i + 1}</button>` : '').join('');
    const slides = photos.length ? photos.map((src, i) => `<figure class="slide"><div class="pinbox"><img src="${escapeHtml(src)}" alt="${escapeHtml(product.title)}, фото ${i + 1} из ${photos.length}" data-zoom="${escapeHtml(src)}"${i ? ' loading="lazy"' : ''}>${pinsFor(i)}</div></figure>`).join('') : `<figure class="slide"><div class="pinbox empty"><span class="placeholder">${hanger}</span></div></figure>`;
    const dots = photos.length > 1 ? `<span class="counter" id="counter">1 / ${photos.length}</span><div class="dots">${photos.map((_, i) => `<button type="button" class="dot" data-slide="${i}" aria-label="Фото ${i + 1}" aria-current="${i === 0}"></button>`).join('')}</div>` : '';
    const tools = notes.length ? '<div class="gallery-tools"><button type="button" id="toggle-pins" aria-pressed="false">Показать детали</button></div>' : '';
    const noteList = notes.length ? `<h3 class="block-title">Детали и дефекты</h3><ol class="notes">${notes.map((note, i) => `<li><button class="note${note.type === 'flaw' ? ' flaw' : ''}" type="button" data-note="${i}" data-img="${note.img || 0}"><span>${i + 1}</span><b>${escapeHtml(note.text)}</b>${note.type === 'flaw' ? '<em>дефект</em>' : ''}</button></li>`).join('')}</ol>` : '';
    sheetBody.dataset.product = product.id;
    sheetBody.innerHTML = `<div class="gallery"><div class="slides" id="slides" tabindex="0" aria-label="Фото вещи, листайте вбок">${slides}</div>${dots}${tools}</div><div class="title-row"><h2 id="sheet-title">${escapeHtml(product.title)}</h2><button class="textlink share" type="button" data-share="${escapeHtml(product.id)}">Поделиться</button></div>${description}${passport}${noteList}${buyPanel(product)}`;
    const slidesEl = sheetBody.querySelector('#slides');
    slidesEl?.addEventListener('scroll', () => {
      const index = Math.round(slidesEl.scrollLeft / (slidesEl.clientWidth || 1));
      const counter = sheetBody.querySelector('#counter');
      if (counter) counter.textContent = `${index + 1} / ${photos.length}`;
      sheetBody.querySelectorAll('.dot').forEach((dot, i) => dot.setAttribute('aria-current', String(i === index)));
    }, { passive: true });
  };
}

function cartView() {
  cart = cart.filter(item => byId(item.id) && !byId(item.id).sold && !byId(item.id).reserved);
  sheet.classList.add('narrow');
  sheetBody.className = 'sheet-body';
  sheetBody.dataset.product = '';
  if (!cart.length) {
    sheetBody.innerHTML = '<h2 id="sheet-title">Корзина</h2><div class="empty-cart"><p>В корзине пока пусто. Выберите вещь в каталоге.</p><button class="primary" id="to-catalog" type="button">Перейти в каталог</button></div>';
    return;
  }
  const lines = cart.map(item => {
    const product = byId(item.id);
    const sub = [product.size && `Размер: ${product.size}`, product.brand, product.condition].filter(Boolean).join(' · ');
    return `<div class="cart-line"><div class="cart-thumb${hasCut(product) ? ' cut' : ''}">${imageMarkup(product)}</div><div><h3>${escapeHtml(product.title)}</h3>${sub ? `<p class="cart-sub">${escapeHtml(sub)}</p>` : ''}<button class="remove" type="button" data-remove="${escapeHtml(item.id)}">Убрать</button></div><strong>${currency(product.price)}</strong></div>`;
  }).join('');
  const link = sellerTelegram ? `https://t.me/${sellerTelegram}?text=${encodeURIComponent(buildMessage())}` : '#';
  sheetBody.innerHTML = `<h2 id="sheet-title">Корзина</h2><p class="cart-count">${cart.length} ${plural(cart.length, 'вещь', 'вещи', 'вещей')} · каждая в единственном экземпляре</p>${lines}<div class="total-row"><span>Итого</span><strong>${currency(cartTotal())}</strong></div><div class="buy"><a class="primary wide" id="telegram-order" href="${link}" target="_blank" rel="noopener noreferrer" aria-disabled="${String(!sellerTelegram)}">Оформить в Telegram</a><p class="hint">${sellerTelegram ? 'Откроется чат с готовым списком вещей. Оплату и доставку согласуем лично.' : 'Telegram продавца пока не настроен.'}</p></div>`;
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
function openZoom(src, alt) {
  zoomImg.src = src; zoomImg.alt = alt || '';
  zoomScroll.classList.remove('zoomed');
  zoom.hidden = false;
  zoom.querySelector('#zoom-close').focus({ preventScroll: true });
}
function closeZoom() { zoom.hidden = true; zoomImg.removeAttribute('src'); }
zoom.querySelector('#zoom-close').addEventListener('click', closeZoom);
zoomImg.addEventListener('click', event => {
  const zoomed = zoomScroll.classList.toggle('zoomed');
  if (zoomed) {
    const box = zoomImg.getBoundingClientRect();
    requestAnimationFrame(() => {
      zoomScroll.scrollLeft = Math.max(0, (zoomImg.offsetWidth - zoomScroll.clientWidth) * ((event.clientX - box.left) / (box.width || 1)));
      zoomScroll.scrollTop = Math.max(0, (zoomImg.offsetHeight - zoomScroll.clientHeight) * ((event.clientY - box.top) / (box.height || 1)));
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

sheetBody.addEventListener('click', event => {
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
    toggle.textContent = on ? 'Скрыть детали' : 'Показать детали';
    sheetBody.querySelectorAll('.pinbox').forEach(box => box.classList.toggle('pins-on', on));
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
      if (noteButton.classList.contains('note')) slideTo(noteButton.dataset.img);
    }
    return;
  }
  const photo = event.target.closest('[data-zoom]');
  if (photo) { openZoom(photo.dataset.zoom, photo.alt); return; }
  if (event.target.closest('#add')) {
    const id = sheetBody.dataset.product;
    if (!cart.some(item => item.id === id)) cart.push({ id });
    saveCart();
    sheetBody.querySelector('.buy').outerHTML = buyPanel(byId(id), true);
    sheetBody.querySelector('#open-cart')?.focus({ preventScroll: true });
    return;
  }
  if (event.target.closest('#open-cart')) { openSheet(cartView); return; }
  if (event.target.closest('#keep-looking')) { closeSheet(); return; }
  if (event.target.closest('#to-catalog')) { closeSheet(); document.querySelector('#catalog').scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth' }); return; }
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

async function init() {
  try {
    const config = await fetch('/config.json').then(response => response.json());
    sellerTelegram = /^[A-Za-z0-9_]{5,32}$/.test(config.sellerTelegram || '') ? config.sellerTelegram : '';
    const response = await fetch('/data/products.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Каталог недоступен.');
    products = (await response.json()).filter(product => product.active);
    renderToolbar(); renderProducts(); updateCount();
    document.querySelectorAll('[data-telegram]').forEach(link => { if (sellerTelegram) link.href = `https://t.me/${sellerTelegram}`; else link.hidden = true; });
    document.querySelector('#demo-note').hidden = !products.some(product => product.id.startsWith('demo-'));
    const selected = byId(new URLSearchParams(location.search).get('product'));
    if (selected) openSheet(productView(selected));
  } catch (error) {
    grid.innerHTML = `<p class="empty">${escapeHtml(error.message)} Попробуйте обновить страницу.</p>`;
  }
}
init();
