const $ = id => document.getElementById(id);
const loginForm = $('login-form'), panel = $('panel'), list = $('list'), editor = $('editor'), notice = $('notice'), barActions = $('bar-actions');
const preview = $('preview');
let products = [], editingId = null, imageData = '';

function say(message, error = false) {
  notice.hidden = !message;
  notice.textContent = message || '';
  notice.classList.toggle('error', error);
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path.endsWith('/products')) { showLogin(); throw new Error(''); }
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса.');
  return data;
}

function showLogin() {
  panel.hidden = true; barActions.hidden = true; loginForm.hidden = false;
  loginForm.password.value = '';
}

function showPanel() {
  loginForm.hidden = true; panel.hidden = false; barActions.hidden = false;
  render();
}

function render() {
  list.replaceChildren();
  if (!products.length) {
    const empty = document.createElement('li');
    empty.className = 'fine';
    empty.textContent = 'Пока нет ни одной вещи.';
    list.append(empty);
  }
  for (const product of products) {
    const item = document.createElement('li');
    item.className = `item${product.active ? '' : ' off'}`;
    const thumb = document.createElement('img');
    thumb.className = 'thumb'; thumb.alt = ''; thumb.loading = 'lazy';
    if (product.image) thumb.src = product.image;
    const text = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = product.title;
    const meta = document.createElement('p'); meta.className = 'meta';
    meta.textContent = `${product.price.toLocaleString('ru-RU')} ₽ · ${product.active ? 'на сайте' : 'скрыто'}`;
    text.append(title, meta);
    const row = document.createElement('div'); row.className = 'row';
    row.append(
      button('Изменить', () => openEditor(product)),
      button(product.active ? 'Скрыть' : 'Показать', () => mutate(`/api/admin/products?id=${product.id}`, 'PUT', { active: !product.active })),
      button('Удалить', () => { if (confirm(`Удалить «${product.title}» навсегда?`)) mutate(`/api/admin/products?id=${product.id}`, 'DELETE'); }, 'danger')
    );
    item.append(thumb, text, row);
    list.append(item);
  }
}

function button(label, onClick, extra = '') {
  const el = document.createElement('button');
  el.type = 'button'; el.className = `btn ghost ${extra}`.trim(); el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

async function mutate(path, method, body) {
  say('');
  try {
    products = (await api(path, { method, body: body && JSON.stringify(body) })).products;
    render();
    say('Сохранено. Сайт обновится примерно через минуту.');
    return true;
  } catch (error) {
    if (error.message) say(error.message, true);
    return false;
  }
}

function openEditor(product) {
  editingId = product?.id ?? null; imageData = '';
  $('editor-title').textContent = product ? 'Изменить вещь' : 'Новая вещь';
  editor.title.value = product?.title ?? '';
  editor.price.value = product?.price ?? '';
  editor.description.value = product?.description ?? '';
  editor.photo.value = '';
  preview.hidden = !product?.image;
  if (product?.image) preview.src = product.image;
  editor.hidden = false;
  editor.title.focus();
  editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// Shrink to max 1600px JPEG in the browser: keeps requests small and the repo light.
async function toJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

editor.photo.addEventListener('change', async () => {
  const file = editor.photo.files[0];
  if (!file) return;
  try {
    imageData = await toJpeg(file);
    preview.src = imageData; preview.hidden = false;
  } catch {
    imageData = ''; editor.photo.value = '';
    say('Не удалось прочитать фото. Выберите JPEG или PNG.', true);
  }
});

editor.addEventListener('submit', async event => {
  event.preventDefault();
  const save = $('save');
  save.disabled = true;
  const body = { title: editor.title.value, price: Number(editor.price.value), description: editor.description.value };
  if (imageData) body.image = imageData;
  const ok = editingId
    ? await mutate(`/api/admin/products?id=${editingId}`, 'PUT', body)
    : await mutate('/api/admin/products', 'POST', body);
  save.disabled = false;
  if (ok) editor.hidden = true;
});

$('add').addEventListener('click', () => openEditor(null));
$('cancel').addEventListener('click', () => { editor.hidden = true; });

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  say('');
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ login: loginForm.login.value, password: loginForm.password.value }) });
    await load();
  } catch (error) {
    say(error.message, true);
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  products = []; editor.hidden = true; say(''); showLogin();
});

async function load() {
  try {
    products = (await api('/api/admin/products')).products;
    showPanel();
  } catch (error) {
    if (error.message) { showPanel(); say(error.message, true); }
  }
}
load();
