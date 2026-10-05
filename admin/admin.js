const $ = id => document.getElementById(id);
const loginForm = $('login-form'), panel = $('panel'), list = $('list'), editor = $('editor'), notice = $('notice'), barActions = $('bar-actions');
const preview = $('preview'), stagePins = $('stage-pins'), pinList = $('pin-list'), strip = $('photo-strip'), pinSection = $('pin-section'), photoInput = $('photo-input');
const PASSPORT = ['category', 'size', 'brand', 'era', 'origin', 'condition', 'measures'];
const MAX_PHOTOS = 8;
// photos: [{ src }] where src is an existing /images path or a new JPEG data URL; notes point at a photo object so reordering keeps them attached
let products = [], editingId = null, photos = [], notes = [], selected = 0;
let cut = { path: '', data: '', changed: false };   // transparent preview: current path, or a new data URL, or removal

const photosOf = product => (Array.isArray(product.images) && product.images.length ? product.images : product.image ? [product.image] : []);

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

function button(label, onClick, extra = '') {
  const el = document.createElement('button');
  el.type = 'button'; el.className = `btn ghost ${extra}`.trim(); el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

function statusOf(product) {
  if (!product.active) return 'скрыто';
  if (product.sold) return 'продано (архив)';
  if (product.reserved) return 'бронь';
  return 'в продаже';
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
    if (product.preview || product.image) thumb.src = product.preview || product.image;
    const text = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = product.title;
    const meta = document.createElement('p'); meta.className = 'meta';
    meta.textContent = `${product.price.toLocaleString('ru-RU')} ₽ · ${statusOf(product)} · фото: ${photosOf(product).length}`;
    text.append(title, meta);
    const row = document.createElement('div'); row.className = 'row';
    const put = body => mutate(`/api/admin/products?id=${product.id}`, 'PUT', body);
    row.append(
      button('Изменить', () => openEditor(product)),
      button(product.reserved ? 'Снять бронь' : 'Бронь', () => put({ reserved: !product.reserved })),
      button(product.sold ? 'Вернуть в продажу' : 'Продано', () => put({ sold: !product.sold })),
      button(product.active ? 'Скрыть' : 'Показать', () => put({ active: !product.active })),
      button('Удалить', () => { if (confirm(`Удалить «${product.title}» навсегда?`)) mutate(`/api/admin/products?id=${product.id}`, 'DELETE'); }, 'danger')
    );
    item.append(thumb, text, row);
    list.append(item);
  }
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

/* ---------- editor ---------- */
function openEditor(product) {
  editingId = product?.id ?? null;
  $('editor-title').textContent = product ? 'Изменить вещь' : 'Новая вещь';
  editor.title.value = product?.title ?? '';
  editor.price.value = product?.price ?? '';
  editor.description.value = product?.description ?? '';
  for (const name of PASSPORT) editor[name].value = product?.[name] ?? '';
  photos = product ? photosOf(product).map(src => ({ src })) : [];
  // only defects are used on the site; older "detail" pins are not loaded and are dropped on save
  notes = (product?.notes || []).filter(note => note.type === 'flaw').map(note => ({ x: note.x, y: note.y, text: note.text, type: 'flaw', photo: photos[note.img || 0] })).filter(note => note.photo);
  selected = 0;
  cut = { path: product?.preview || '', data: '', changed: false };
  renderCut();
  renderPhotos();
  editor.hidden = false;
  editor.title.focus();
  editor.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderCut() {
  const src = cut.data || cut.path;
  $('cut-thumb').hidden = !src;
  if (src) $('cut-img').src = src;
  $('cut-remove').hidden = !src;
  $('cut-add').firstChild.textContent = src ? 'Заменить превью' : 'Загрузить PNG или WebP';
}

// keeps transparency: WebP where the browser can encode it, PNG otherwise; max 1000 px on the long side
async function toTransparent(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const webp = canvas.toDataURL('image/webp', 0.9);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
}

$('cut-input').addEventListener('change', async () => {
  const file = $('cut-input').files[0];
  $('cut-input').value = '';
  if (!file) return;
  try { cut = { ...cut, data: await toTransparent(file), changed: true }; renderCut(); }
  catch { say('Не удалось прочитать превью. Нужен PNG или WebP.', true); }
});
$('cut-remove').addEventListener('click', () => { cut = { path: '', data: '', changed: true }; renderCut(); });

function renderPhotos() {
  selected = Math.min(selected, Math.max(photos.length - 1, 0));
  strip.replaceChildren(...photos.map((photo, i) => {
    const li = document.createElement('li');
    li.className = i === selected ? 'on' : '';
    const pick = document.createElement('button');
    pick.type = 'button'; pick.className = 'photo-pick'; pick.setAttribute('aria-label', `Фото ${i + 1}${i === 0 ? ' (обложка)' : ''}`);
    const img = document.createElement('img'); img.src = photo.src; img.alt = '';
    pick.append(img);
    pick.addEventListener('click', () => { selected = i; renderPhotos(); });
    const tools = document.createElement('div'); tools.className = 'photo-tools';
    const move = (label, delta) => { const el = button(label, () => { const j = i + delta; [photos[i], photos[j]] = [photos[j], photos[i]]; selected = j; renderPhotos(); }); el.setAttribute('aria-label', delta < 0 ? 'Сдвинуть влево' : 'Сдвинуть вправо'); el.disabled = i + delta < 0 || i + delta >= photos.length; return el; };
    const del = button('×', () => { notes = notes.filter(note => note.photo !== photo); photos.splice(i, 1); renderPhotos(); });
    del.setAttribute('aria-label', 'Убрать фото');
    tools.append(move('←', -1), move('→', 1), del);
    li.append(pick, tools);
    return li;
  }));
  $('photo-input').closest('label').hidden = photos.length >= MAX_PHOTOS;
  pinSection.hidden = !photos.length;
  if (photos.length) preview.src = photos[selected].src;
  renderNotes();
}

// Shrink to max 1600px JPEG in the browser: keeps requests small and the repo light.
async function toJpeg(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.82);
}

photoInput.addEventListener('change', async () => {
  const files = [...photoInput.files].slice(0, MAX_PHOTOS - photos.length);
  photoInput.value = '';
  for (const file of files) {
    try { photos.push({ src: await toJpeg(file) }); }
    catch { say('Не удалось прочитать одно из фото. Выберите JPEG или PNG.', true); }
  }
  selected = Math.max(photos.length - files.length, 0);
  renderPhotos();
});

function renderNotes() {
  const current = photos[selected];
  stagePins.replaceChildren(...notes.map((note, i) => {
    if (note.photo !== current) return '';
    const pin = document.createElement('span');
    pin.className = 'apin flaw'; pin.textContent = i + 1;
    pin.style.left = `${note.x}%`; pin.style.top = `${note.y}%`;
    return pin;
  }).filter(Boolean));
  pinList.replaceChildren(...notes.map((note, i) => {
    const row = document.createElement('li');
    const num = document.createElement('span'); num.className = 'num flaw'; num.textContent = i + 1;
    const input = document.createElement('input');
    input.value = note.text; input.maxLength = 80; input.placeholder = 'Что за дефект? Например: пятно у манжеты';
    input.setAttribute('aria-label', `Подпись точки ${i + 1} (фото ${photos.indexOf(note.photo) + 1})`);
    input.addEventListener('input', () => { note.text = input.value; });
    const del = button('×', () => { notes.splice(i, 1); renderNotes(); });
    del.setAttribute('aria-label', 'Убрать точку');
    row.append(num, input, del);
    const where = document.createElement('small'); where.textContent = `фото ${photos.indexOf(note.photo) + 1}`;
    row.append(where);
    return row;
  }));
}

preview.addEventListener('click', event => {
  if (notes.length >= 12) return say('Не больше 12 точек.', true);
  const box = preview.getBoundingClientRect();
  notes.push({ x: Math.round((event.clientX - box.left) / box.width * 1000) / 10, y: Math.round((event.clientY - box.top) / box.height * 1000) / 10, text: '', type: 'flaw', photo: photos[selected] });
  renderNotes();
  pinList.querySelector('li:last-child input')?.focus();
});

editor.addEventListener('submit', async event => {
  event.preventDefault();
  const save = $('save');
  save.disabled = true;
  const body = { title: editor.title.value, price: Number(editor.price.value), description: editor.description.value, images: photos.map(photo => photo.src) };
  for (const name of PASSPORT) body[name] = editor[name].value;
  if (cut.changed) body.preview = cut.data;   // '' removes the preview
  body.notes = notes.filter(note => note.text.trim()).map(note => ({ x: note.x, y: note.y, text: note.text, type: note.type, img: photos.indexOf(note.photo) }));
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
