const grid = document.querySelector('#product-grid');
const filters = document.querySelector('#filters');
const drawer = document.querySelector('#cart-drawer');
const scrim = document.querySelector('#scrim');
const cartItems = document.querySelector('#cart-items');
const orderLink = document.querySelector('#telegram-order');
const status = document.querySelector('#form-status');
const currency = value => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

let products = [];
let category = 'Все';
let cart = readCart();
let previousFocus;
let sellerTelegram = '';

function readCart() {
  try {
    const stored = JSON.parse(localStorage.getItem('rewear-cart') || '[]');
    return Array.isArray(stored) ? stored.filter(item => typeof item.id === 'string' && typeof item.size === 'string' && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 10) : [];
  } catch { return []; }
}

function saveCart() {
  localStorage.setItem('rewear-cart', JSON.stringify(cart));
  renderCart();
}

function renderFilters() {
  const categories = ['Все', ...new Set(products.map(product => product.category))];
  filters.innerHTML = categories.map(name => `<button class="filter ${name === category ? 'active' : ''}" type="button" data-category="${escapeHtml(name)}" aria-pressed="${name === category}">${escapeHtml(name)}</button>`).join('');
}

function renderProducts() {
  const visible = products.filter(product => category === 'Все' || product.category === category);
  document.querySelector('#product-count').textContent = String(visible.length);
  grid.innerHTML = visible.length ? visible.map(product => {
    const number = String(products.indexOf(product) + 1).padStart(2, '0');
    const image = /^\/images\/[a-z0-9.-]+$/.test(product.image || '') ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy">` : `<span class="image-placeholder"><b>№ ${number}</b><span>фото скоро</span></span>`;
    const sub = product.id.startsWith('demo-') ? product.category : `${product.category} · ${product.description}`;
    return `<article class="product" id="product-${escapeHtml(product.id)}"><div class="product-image">${image}</div><div class="product-head"><h3>${escapeHtml(product.title)}</h3><span class="price">${currency(product.price)}</span></div><p class="product-sub">${escapeHtml(sub)}</p><div class="sizes" role="group" aria-label="Размер: ${escapeHtml(product.title)}">${product.sizes.map((size, i) => `<button class="size" type="button" data-size="${escapeHtml(size)}" aria-pressed="${i === 0}">${escapeHtml(size)}</button>`).join('')}</div><button class="add-button" type="button" data-id="${escapeHtml(product.id)}">В корзину</button></article>`;
  }).join('') : '<p class="empty">В этой категории пока нет товаров.</p>';
}

function renderCart() {
  cart = cart.filter(item => products.some(product => product.id === item.id && product.sizes.includes(item.size)));
  const totalCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  document.querySelector('#cart-count').textContent = totalCount;
  const total = cart.reduce((sum, item) => sum + products.find(product => product.id === item.id).price * item.quantity, 0);
  document.querySelector('#cart-total').textContent = currency(total);
  cartItems.innerHTML = cart.length ? cart.map((item, index) => {
    const product = products.find(p => p.id === item.id);
    return `<div class="cart-item"><div><h3>${escapeHtml(product.title)}</h3><p>Размер ${escapeHtml(item.size)} · ${item.quantity} шт.</p><button class="remove" type="button" data-remove="${index}">Удалить</button></div><strong>${currency(product.price * item.quantity)}</strong></div>`;
  }).join('') : '<p class="empty">Пока пусто. Выберите вещи в каталоге.</p>';
  orderLink.setAttribute('aria-disabled', String(cart.length === 0 || !sellerTelegram));
  orderLink.href = cart.length && sellerTelegram ? `https://t.me/${sellerTelegram}?text=${encodeURIComponent(buildMessage())}` : '#';
  status.textContent = sellerTelegram ? '' : 'Telegram продавца пока не настроен.';
}

function buildMessage() {
  const lines = cart.map((item, index) => {
    const product = products.find(p => p.id === item.id);
    return `${index + 1}. ${product.title}, размер ${item.size}${item.quantity > 1 ? ` × ${item.quantity}` : ''} — ${currency(product.price * item.quantity)}\n${location.origin}/?product=${product.id}`;
  });
  const total = cart.reduce((sum, item) => sum + products.find(p => p.id === item.id).price * item.quantity, 0);
  return `Привет! Зашёл на сайт, очень круто, хочу эти вещи:\n\n${lines.join('\n\n')}\n\nИтого: ${currency(total)}\nКак можно оформить?`;
}

function openCart() {
  previousFocus = document.activeElement;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  scrim.hidden = false;
  document.body.style.overflow = 'hidden';
  document.querySelector('#cart-close').focus();
}

function closeCart() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  scrim.hidden = true;
  document.body.style.overflow = '';
  previousFocus?.focus();
}

filters.addEventListener('click', event => {
  const button = event.target.closest('[data-category]');
  if (!button) return;
  category = button.dataset.category;
  renderFilters();
  renderProducts();
});

grid.addEventListener('click', event => {
  const sizeButton = event.target.closest('[data-size]');
  if (sizeButton) {
    sizeButton.parentElement.querySelectorAll('.size').forEach(el => el.setAttribute('aria-pressed', String(el === sizeButton)));
    return;
  }
  const button = event.target.closest('[data-id]');
  if (!button) return;
  const product = products.find(p => p.id === button.dataset.id);
  if (!product) return;
  const size = button.closest('.product').querySelector('.size[aria-pressed="true"]').dataset.size;
  const existing = cart.find(item => item.id === product.id && item.size === size);
  if (existing) existing.quantity = Math.min(existing.quantity + 1, 10);
  else cart.push({ id: product.id, size, quantity: 1 });
  saveCart();
  openCart();
});

cartItems.addEventListener('click', event => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  cart.splice(Number(button.dataset.remove), 1);
  saveCart();
});

document.querySelector('#cart-toggle').addEventListener('click', openCart);
document.querySelector('#cart-close').addEventListener('click', closeCart);
scrim.addEventListener('click', closeCart);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && drawer.classList.contains('open')) closeCart();
  if (event.key === 'Tab' && drawer.classList.contains('open')) {
    const focusable = [...drawer.querySelectorAll('button:not(:disabled), a[href]:not([aria-disabled="true"])')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

orderLink.addEventListener('click', event => {
  if (orderLink.getAttribute('aria-disabled') === 'true') event.preventDefault();
});

async function init() {
  try {
    const config = await fetch('/config.json').then(response => response.json());
    sellerTelegram = /^[A-Za-z0-9_]{5,32}$/.test(config.sellerTelegram || '') ? config.sellerTelegram : '';
    const response = await fetch('/data/products.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Каталог недоступен.');
    products = (await response.json()).filter(product => product.active);
    renderFilters(); renderProducts(); renderCart();
    const selected = new URLSearchParams(location.search).get('product');
    if (selected) document.getElementById(`product-${selected}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    grid.innerHTML = `<p class="empty">${escapeHtml(error.message)} Попробуйте обновить страницу.</p>`;
  }
}
init();
