import { cutOut, kindForCategory } from './cutout.js';
const $ = id => document.getElementById(id);
const loginForm = $('login-form'), panel = $('panel'), list = $('list'), editor = $('editor'), notice = $('notice'), barActions = $('bar-actions');
const preview = $('preview'), stagePins = $('stage-pins'), pinList = $('pin-list'), strip = $('photo-strip'), pinSection = $('pin-section'), photoInput = $('photo-input');
const PASSPORT = ['category', 'size', 'brand', 'era', 'origin', 'condition', 'measures'];
const MAX_PHOTOS = 8;
// photos: [{ src }] where src is an existing /images path or a new JPEG data URL; notes point at a photo object so reordering keeps them attached
let products = [], editingId = null, photos = [], notes = [], selected = 0;
let cut = { path: '', data: '', changed: false, pending: null, busy: false };   // transparent preview: saved path, new data URL, or removal; pending = automatic result waiting for a decision
let autoTried = false;
let editorGeneration = 0, cutGeneration = 0;
let uploads = 0, mutating = false, saving = false, baseline = '', renderVersion = 0;
const saveDisabled = new Map();
function snapshot() {
  return JSON.stringify({ fields: ['title', 'price', 'description', ...PASSPORT].map(name => editor[name].value), photos: photos.map(p => p.src), notes: notes.map(n => [n.x, n.y, n.text, photos.indexOf(n.photo)]), preview: cut.data || cut.path, changed: cut.changed });
}
function dirty() { return !editor.hidden && (uploads > 0 || cut.busy || !!cut.pending || snapshot() !== baseline); }
function editorState() {
  $('save').disabled = uploads > 0 || cut.busy || !!cut.pending || saving || mutating;
  $('cancel').disabled = saving;
  $('cut-run').disabled = cut.busy || saving || !photos.length;
  $('photo-input').disabled = uploads > 0 || saving;
  for (const control of editor.querySelectorAll?.('input, textarea, select, button') || []) {
    if (['save', 'cancel', 'photo-input', 'cut-run'].includes(control.id)) continue;
    if (saving) { if (!saveDisabled.has(control)) saveDisabled.set(control, control.disabled); control.disabled = true; }
    else if (saveDisabled.has(control)) { control.disabled = saveDisabled.get(control); saveDisabled.delete(control); }
  }
  $('editor-state').textContent = saving ? 'Сохраняем…' : uploads ? 'Загружаем фото…' : cut.busy ? 'Обрабатываем обложку…' : cut.pending ? 'Проверьте обложку' : dirty() ? 'Есть несохранённые изменения' : '';
}
function leaveEditor(message = 'Изменения не сохранены. Закрыть редактор?') { return !saving && (!dirty() || confirm(message)); }
editor.addEventListener('input', editorState);
editor.addEventListener('change', editorState);
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => { if (dirty() || saving) { event.preventDefault(); event.returnValue = ''; } });

function invalidateEditor() {
  uploads = 0;
  editorGeneration++;
  cutGeneration++;
  cut = { ...cut, busy: false };
}
function closeEditor() { invalidateEditor(); editor.hidden = true; baseline = ""; }

const photosOf = product => (Array.isArray(product.images) && product.images.length ? product.images : product.image ? [product.image] : []);

function say(message, error = false) {
  notice.hidden = !message;
  notice.textContent = message || '';
  notice.classList.toggle('error', error);
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !path.endsWith('/login')) { showLogin(); throw new Error(''); }
  if (response.status === 403 && data.mustChange) { showAccount(true); throw new Error(''); }
  if (!response.ok) throw new Error(data.error || 'Ошибка запроса.');
  return data;
}

function showLogin() {
  closeEditor();
  panel.hidden = true; barActions.hidden = true; loginForm.hidden = false; $('account-form').hidden = true;
  loginForm.password.value = '';
}

function showPanel() {
  loginForm.hidden = true; panel.hidden = false; barActions.hidden = false; $('account-form').hidden = true; $('open-account').hidden = false;
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
  const version = ++renderVersion;
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
    const guarded = (action, replacingEditor = false) => () => {
      const message = replacingEditor ? 'Изменения не сохранены. Закрыть редактор?' : 'В редакторе есть несохранённые изменения. Выполнить действие списка? Редактор останется открытым.';
      if (!mutating && !saving && version === renderVersion && leaveEditor(message)) action();
    };
    const put = body => mutate(`/api/admin/products?id=${product.id}`, 'PUT', body);
    const edit = button('Изменить', guarded(() => openEditor(product), true)); edit.disabled = mutating;
    const menu = document.createElement('details'); menu.className = 'item-more';
    const summary = document.createElement('summary'); summary.textContent = 'Ещё';
    const actions = document.createElement('div'); actions.className = 'extra-actions';
    actions.append(
      button(product.reserved ? 'Снять бронь' : 'Бронь', guarded(() => put({ reserved: !product.reserved }))),
      button(product.sold ? 'Вернуть в продажу' : 'Продано', guarded(() => put({ sold: !product.sold }))),
      button(product.active ? 'Скрыть' : 'Показать', guarded(() => put({ active: !product.active }))),
      button('Удалить', guarded(() => { if (confirm(`Удалить «${product.title}» навсегда?`)) mutate(`/api/admin/products?id=${product.id}`, 'DELETE'); }), 'danger')
    );
    for (const control of actions.children || []) control.disabled = mutating;
    menu.append(summary, actions); row.append(edit, menu);
    item.append(thumb, text, row);
    list.append(item);
  }
}

async function mutate(path, method, body) {
  if (mutating) return false;
  mutating = true; render(); editorState();
  say('Сохраняем…');
  try {
    products = (await api(path, { method, body: body && JSON.stringify(body) })).products;
    render();
    say('Сохранено.');
    return true;
  } catch (error) {
    if (error.message) say(error.message, true);
    return false;
  } finally { mutating = false; render(); editorState(); }
}

/* ---------- editor ---------- */
function openEditor(product) {
  if (mutating || saving) return;
  invalidateEditor();
  editingId = product?.id ?? null;
  $('save').disabled = false;
  $('editor-title').textContent = product ? 'Изменить вещь' : 'Новая вещь';
  editor.title.value = product?.title ?? '';
  editor.price.value = product?.price ?? '';
  editor.description.value = product?.description ?? '';
  for (const name of PASSPORT) editor[name].value = product?.[name] ?? '';
  photos = product ? photosOf(product).map(src => ({ src })) : [];
  // only defects are used on the site; older "detail" pins are not loaded and are dropped on save
  notes = (product?.notes || []).filter(note => note.type === 'flaw').map(note => ({ x: note.x, y: note.y, text: note.text, type: 'flaw', photo: photos[note.img || 0] })).filter(note => note.photo);
  selected = 0;
  cut = { path: product?.preview || '', data: '', changed: false, pending: null, busy: false };
  autoTried = Boolean(product);
  $('cut-status').hidden = true;
  $('cut-kind').value = kindForCategory(product?.category);
  renderCut();
  renderPhotos();
  editor.hidden = false;
  baseline = snapshot(); editorState();
  editor.title.focus({ preventScroll: true });
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  editor.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

function say2(text) { const el = $('cut-status'); el.hidden = !text; el.textContent = text || ''; }

function renderCut() {
  const src = cut.pending?.dataUrl || cut.data || cut.path;
  const original = photos[selected]?.src || photos[0]?.src || '';
  $('cut-compare').hidden = !(src && original);
  if (src) $('cut-img').src = src;
  if (original) $('cut-orig').src = original;
  $('cut-caption').textContent = cut.pending ? 'Результат: проверьте края и детали' : 'Так вещь будет в каталоге';
  const problems = cut.pending?.problems || [];
  $('cut-problems').hidden = !problems.length;
  $('cut-problems').replaceChildren(...problems.map(text => Object.assign(document.createElement('li'), { textContent: text })));
  $('cut-run').hidden = Boolean(cut.pending);
  $('cut-run').disabled = cut.busy || saving || !photos.length;
  $('cut-run').textContent = cut.busy ? 'Вырезаем…' : (cut.data || cut.path ? 'Вырезать заново' : 'Вырезать автоматически');
  $('cut-accept').hidden = !cut.pending;
  $('cut-accept').textContent = problems.length ? 'Всё равно использовать' : 'Использовать это превью';
  $('cut-reject').hidden = !cut.pending;
  $('cut-remove').hidden = !(cut.data || cut.path) || Boolean(cut.pending);
  $('cut-add').hidden = Boolean(cut.pending);
  editorState();
}

async function runCut() {
  if (cut.busy || !photos.length) return;
  const generation = editorGeneration, operation = ++cutGeneration;
  const photo = photos[selected], src = photo.src, kind = $('cut-kind').value;
  const current = () => generation === editorGeneration && operation === cutGeneration;
  const currentSource = () => current() && photos[selected] === photo && photo.src === src;
  cut = { ...cut, busy: true, pending: null };
  renderCut();
  try {
    const result = await cutOut(src, kind, text => { if (currentSource()) say2(text); });
    if (!currentSource()) return;
    // a clean result is taken at once (still shown next to the original); one with warnings waits for the owner
    if (result.problems.length) { cut = { ...cut, pending: result }; say2('Есть замечания к вырезке: посмотрите на края и решите.'); }
    else { cut = { ...cut, data: result.dataUrl, changed: true, pending: null }; say2('Готово, замечаний нет. Всё равно сравните с оригиналом и нажмите «Сохранить».'); }
  } catch (error) {
    if (currentSource()) say2(`Не получилось вырезать: ${error.message || 'ошибка'}. Фото останется на ковре, или загрузите своё превью.`);
  } finally {
    if (current()) { cut = { ...cut, busy: false }; renderCut(); }
  }
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
  const generation = editorGeneration, operation = ++cutGeneration;
  const current = () => generation === editorGeneration && operation === cutGeneration;
  cut = { ...cut, busy: true, pending: null };
  renderCut();
  try {
    const data = await toTransparent(file);
    if (!current()) return;
    cut = { ...cut, data, changed: true, pending: null };
    say2('Своё превью загружено.');
  } catch { if (current()) say('Не удалось прочитать превью. Нужен PNG или WebP.', true); }
  finally { if (current()) { cut = { ...cut, busy: false }; renderCut(); } }
});
$('cut-remove').addEventListener('click', () => { cutGeneration++; cut = { path: '', data: '', changed: true, pending: null, busy: false }; say2(''); renderCut(); });
$('cut-run').addEventListener('click', runCut);
$('cut-accept').addEventListener('click', () => { cut = { ...cut, data: cut.pending.dataUrl, changed: true, pending: null }; say2('Превью принято. Нажмите «Сохранить».'); renderCut(); });
$('cut-reject').addEventListener('click', () => { cut = { ...cut, pending: null }; say2('Оставляем фото на ковре (или загрузите своё превью).'); renderCut(); });
$('cut-kind').addEventListener('change', () => { if (cut.data && !cut.path) say2('Тип вещи изменён: нажмите «Вырезать заново», чтобы применить масштаб.'); });
editor.category.addEventListener('change', () => { $('cut-kind').value = kindForCategory(editor.category.value); });
try { $('cut-auto').checked = localStorage.getItem('rewear-cut-auto') !== '0'; } catch {}
$('cut-auto').addEventListener('change', () => { try { localStorage.setItem('rewear-cut-auto', $('cut-auto').checked ? '1' : '0'); } catch {} });

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
  if (typeof renderCut === 'function') renderCut();
  if (photos.length) preview.src = photos[selected].src;
  renderNotes();
  editorState();
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
  const generation = editorGeneration, target = photos;
  const current = () => generation === editorGeneration && photos === target;
  if (!files.length) return;
  uploads++; editorState();
  let firstAdded = null;
  try {
  for (const file of files) {
    if (!current()) return;
    if (photos.length >= MAX_PHOTOS) break;
    try {
      const src = await toJpeg(file);
      if (!current()) return;
      if (photos.length >= MAX_PHOTOS) break;
      if (firstAdded === null) firstAdded = photos.length;
      photos.push({ src });
    } catch { if (current()) say('Не удалось прочитать одно из фото. Выберите JPEG или PNG.', true); }
  }
  if (!current()) return;
  if (firstAdded !== null) selected = firstAdded;
  renderPhotos();
  if ($('cut-auto').checked && !autoTried && !cut.data && !cut.path && photos.length) { autoTried = true; selected = 0; renderPhotos(); runCut(); }
  } finally { if (current()) { uploads--; editorState(); } }
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
    input.addEventListener('input', () => { note.text = input.value; editorState(); });
    const del = button('×', () => { notes.splice(i, 1); renderNotes(); editorState(); });
    del.setAttribute('aria-label', 'Убрать точку');
    row.append(num, input, del);
    const where = document.createElement('small'); where.textContent = `фото ${photos.indexOf(note.photo) + 1}`;
    row.append(where);
    const coordinates = document.createElement('div'); coordinates.className = 'pin-coordinates';
    for (const [key, title] of [['x', 'По горизонтали, %'], ['y', 'По вертикали, %']]) {
      const label = document.createElement('label'); label.textContent = title;
      const position = document.createElement('input'); position.type = 'number'; position.min = 0; position.max = 100; position.step = 'any'; position.value = note[key];
      position.addEventListener('input', () => { note[key] = Math.max(0, Math.min(100, Number(position.value))); renderPinPositions(); editorState(); });
      label.append(position); coordinates.append(label);
    }
    row.append(coordinates);
    return row;
  }));
}

function renderPinPositions() { const pins = stagePins.children || []; let index = 0; for (const note of notes) if (note.photo === photos[selected]) { if (pins[index]) { pins[index].style.left = `${note.x}%`; pins[index].style.top = `${note.y}%`; } index++; } }
function addNote(x, y) {
  if (saving) return;
  if (!photos.length) return;
  if (notes.length >= 12) return say('Не больше 12 точек.', true);
  notes.push({ x, y, text: '', type: 'flaw', photo: photos[selected] });
  renderNotes(); editorState(); pinList.querySelector('li:last-child input')?.focus();
}
$('pin-add').addEventListener('click', () => addNote(50, 50));
preview.addEventListener('click', event => {
  if (notes.length >= 12) return say('Не больше 12 точек.', true);
  const box = preview.getBoundingClientRect();
  addNote(Math.round((event.clientX - box.left) / box.width * 1000) / 10, Math.round((event.clientY - box.top) / box.height * 1000) / 10);
});

editor.addEventListener('submit', async event => {
  event.preventDefault();
  if (uploads || saving || mutating) { say('Подождите, идёт загрузка или сохранение.', true); return; }
  if (cut.pending) { say('Сначала решите по превью: «Использовать» или «Оставить фото на ковре».', true); return; }
  if (cut.busy) { say('Подождите, идёт вырезка.', true); return; }
  const generation = editorGeneration;
  const save = $('save');
  saving = true; editorState();
  const body = { title: editor.title.value, price: Number(editor.price.value), description: editor.description.value, images: photos.map(photo => photo.src) };
  for (const name of PASSPORT) body[name] = editor[name].value;
  if (cut.changed) body.preview = cut.data;   // '' removes the preview
  body.notes = notes.filter(note => note.text.trim()).map(note => ({ x: note.x, y: note.y, text: note.text, type: note.type, img: photos.indexOf(note.photo) }));
  const ok = editingId
    ? await mutate(`/api/admin/products?id=${editingId}`, 'PUT', body)
    : await mutate('/api/admin/products', 'POST', body);
  saving = false;
  if (generation === editorGeneration) { if (ok) closeEditor(); editorState(); }
});

$('add').addEventListener('click', () => { if (leaveEditor()) openEditor(null); });
$('cancel').addEventListener('click', () => { if (leaveEditor()) closeEditor(); });

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  say('');
  try {
    const result = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ login: loginForm.login.value, password: loginForm.password.value }) });
    loginForm.password.value = '';
    if (result.mustChange) await showAccount(true); else await load();
  } catch (error) {
    say(error.message, true);
  }
});

$('logout').addEventListener('click', async () => {
  if (mutating || !leaveEditor()) return;
  closeEditor();
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  products = []; editor.hidden = true; say(''); showLogin();
});

async function load() {
  if (mutating || saving) return;
  const version = renderVersion;
  try {
    const result = await api('/api/admin/products');
    if (mutating || saving || version !== renderVersion) return;
    products = result.products;
    showPanel();
  } catch (error) {
    if (error.message) { showPanel(); say(error.message, true); }
  }
}
load();

/* ---------- account: login, password, IP allow-list ---------- */
const accountForm = $('account-form');
let forcedChange = false;

async function showAccount(forced = false) {
  if (!forced && (mutating || !leaveEditor())) return;
  closeEditor();
  forcedChange = forced;
  let info;
  try { info = await api('/api/admin/account'); } catch (error) { if (error.message) say(error.message, true); return; }
  loginForm.hidden = true; panel.hidden = true; accountForm.hidden = false;
  barActions.hidden = false;
  $('open-account').hidden = forced;
  $('account-title').textContent = forced ? 'Задайте свой логин и пароль' : 'Аккаунт';
  $('account-lead').textContent = forced ? 'Вы вошли по временному паролю. Придумайте свой логин и пароль: временный после этого перестанет работать.' : 'Для изменений нужен текущий пароль. Новый пароль завершит вход на других устройствах.';
  $('account-cancel').hidden = forced;
  accountForm.reset();
  accountForm.login.value = info.login;
  accountForm.password.required = forced;
  $('my-ip').textContent = info.ip;
  $('ip-only').checked = info.allowedIps.length > 0;
  accountForm.allowedIps.value = info.allowedIps.join('\n');
  $('ip-box').hidden = !info.allowedIps.length;
  say('');
  accountForm.currentPassword.focus();
}

$('ip-only').addEventListener('change', () => {
  $('ip-box').hidden = !$('ip-only').checked;
  if ($('ip-only').checked && !accountForm.allowedIps.value.trim()) accountForm.allowedIps.value = $('my-ip').textContent;
});
$('add-my-ip').addEventListener('click', () => {
  const ip = $('my-ip').textContent, lines = accountForm.allowedIps.value.split('\n').map(line => line.trim()).filter(Boolean);
  if (!lines.includes(ip)) lines.push(ip);
  accountForm.allowedIps.value = lines.join('\n');
});
$('open-account').addEventListener('click', () => showAccount(false));
$('account-cancel').addEventListener('click', () => load());

accountForm.addEventListener('submit', async event => {
  event.preventDefault();
  say('');
  const password = accountForm.password.value;
  if (password && password !== accountForm.password2.value) return say('Новые пароли не совпадают.', true);
  if (forcedChange && !password) return say('Задайте новый пароль.', true);
  const body = { currentPassword: accountForm.currentPassword.value, login: accountForm.login.value.trim(), allowedIps: $('ip-only').checked ? accountForm.allowedIps.value.split('\n').map(line => line.trim()).filter(Boolean) : [] };
  if (password) body.password = password;
  const save = $('account-save');
  save.disabled = true;
  try {
    await api('/api/admin/account', { method: 'PUT', body: JSON.stringify(body) });
    accountForm.reset();
    await load();
    say(password ? 'Сохранено. Новый пароль действует, на других устройствах нужно войти заново.' : 'Сохранено.');
  } catch (error) {
    if (error.message) say(error.message, true);
  } finally {
    save.disabled = false;
  }
});
