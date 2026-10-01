const grid = document.querySelector('#product-grid');
const filters = document.querySelector('#filters');
const drawer = document.querySelector('#cart-drawer');
const scrim = document.querySelector('#scrim');
const cartItems = document.querySelector('#cart-items');
const form = document.querySelector('#checkout-form');
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
    const stored = JSON.parse(localStorage.getItem('lineya-cart') || '[]');
    return Array.isArray(stored) ? stored.filter(item => typeof item.id === 'string' && typeof item.size === 'string' && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 10) : [];
  } catch { return []; }
}

function saveCart() {
  localStorage.setItem('lineya-cart', JSON.stringify(cart));
  renderCart();
}

function renderFilters() {
  const categories = ['Все', ...new Set(products.map(product => product.category))];
  filters.innerHTML = categories.map(name => `<button class="filter ${name === category ? 'active' : ''}" type="button" data-category="${escapeHtml(name)}" aria-pressed="${name === category}">${escapeHtml(name)}</button>`).join('');
}

function renderProducts() {
  const visible = products.filter(product => category === 'Все' || product.category === category);
  document.querySelector('#product-count').textContent = String(products.length).padStart(2, '0');
  grid.innerHTML = visible.length ? visible.map(product => {
    const image = /^\/images\/[a-z0-9.-]+$/.test(product.image || '') ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.title)}" loading="lazy">` : '<span class="image-placeholder">Фото появится здесь</span>';
    return `<article class="product-card" id="product-${escapeHtml(product.id)}"><div class="product-image">${image}${product.id.startsWith('demo-') ? '<span class="demo-tag">Пример</span>' : ''}</div><div class="product-meta"><h3>${escapeHtml(product.title)}</h3><strong>${currency(product.price)}</strong></div><p class="product-category">${escapeHtml(product.category)} · ${escapeHtml(product.description)}</p><div class="add-row"><select class="size-select" aria-label="Размер ${escapeHtml(product.title)}">${product.sizes.map(size => `<option value="${escapeHtml(size)}">${escapeHtml(size)}</option>`).join('')}</select><button class="add-button" type="button" data-id="${escapeHtml(product.id)}">Добавить в корзину ↗</button></div></article>`;
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
  form.querySelector('.submit-button').disabled = cart.length === 0;
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
  const button = event.target.closest('[data-id]');
  if (!button) return;
  const product = products.find(p => p.id === button.dataset.id);
  if (!product) return;
  const size = button.closest('.product-card').querySelector('select').value;
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
    const focusable = [...drawer.querySelectorAll('button:not(:disabled), input:not(.honeypot)')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!cart.length) return;
  const button = form.querySelector('.submit-button');
  button.disabled = true;
  status.textContent = 'Отправляем заказ…';
  status.className = 'form-status';
  try {
    const response = await fetch('/api/order', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ customer: form.customer.value.trim(), website: form.website.value, items: cart }) });
    const result = await response.json().catch(() => ({ error: 'Сервис заказов сейчас недоступен. Попробуйте позже.' }));
    if (!response.ok || !result.ok) throw new Error(result.error || 'Ошибка отправки.');
    cart = [];
    saveCart();
    status.textContent = 'Заявка отправлена. Продавец свяжется с вами по указанному контакту.';
    if (sellerTelegram) {
      const link = document.createElement('a');
      link.href = `https://t.me/${sellerTelegram}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = ' Открыть Telegram ↗';
      status.append(link);
    }
    status.className = 'form-status success';
    form.reset();
  } catch (error) {
    status.textContent = error.message;
    status.className = 'form-status error';
    button.disabled = false;
  }
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
