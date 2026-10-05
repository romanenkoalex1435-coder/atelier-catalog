// In-browser background removal for catalog previews. Runs once, when the owner adds an item (never on the public site).
// Model: ISNet (Apache-2.0, int8) served from /models, engine: onnxruntime-web (MIT) served from /vendor/ort. Photos never leave the browser.
// Nothing is repainted: the mask only decides which original pixels stay. Edges are not blurred, and a 1 px ring is dropped to avoid rug-coloured halos.

const MODEL_URL = '/models/isnet-general-use.int8.onnx';
const SIZE = 1024;
const FRAME = { w: 800, h: 1000 };
const KINDS = { top: ['w', 1], bottom: ['h', 1], accessory: ['max', 0.6] };
export const KIND_LABELS = { top: 'Рубашка, куртка, футболка', bottom: 'Брюки, джинсы', accessory: 'Обувь, аксессуар' };
export const kindForCategory = category => (category === 'Штаны' ? 'bottom' : category === 'Верхняя одежда' || !category ? 'top' : 'accessory');

let sessionPromise = null;

async function loadSession(onStatus) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    onStatus('Загружаем движок…');
    const ort = await import('/vendor/ort/ort.wasm.min.mjs');
    ort.env.wasm.wasmPaths = '/vendor/ort/';
    // single-threaded on purpose: multithreading needs cross-origin isolation and hung in testing; one cut takes about 10 s
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    const response = await fetch(MODEL_URL);
    if (!response.ok) throw new Error('Не удалось загрузить модель вырезки.');
    const total = Number(response.headers.get('content-length')) || 0;
    const reader = response.body.getReader();
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      if (total) onStatus(`Загружаем модель: ${Math.round(got / total * 100)}% (один раз, потом из памяти браузера)`);
    }
    const bytes = new Uint8Array(got); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    onStatus('Готовим модель…');
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return { ort, session };
  })();
  sessionPromise.catch(() => { sessionPromise = null; });
  return sessionPromise;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Не удалось открыть фото.'));
    image.src = src;
  });
}

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  return canvas;
}

// stretch to 1024x1024, scale by the max value, subtract the ImageNet mean (what the DIS / rembg pipeline does)
function preprocess(image) {
  const canvas = makeCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  let peak = 1e-6;
  for (let i = 0; i < data.length; i += 4) peak = Math.max(peak, data[i], data[i + 1], data[i + 2]);
  const plane = SIZE * SIZE, mean = [0.485, 0.456, 0.406], out = new Float32Array(3 * plane);
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    out[p] = data[i] / peak - mean[0];
    out[plane + p] = data[i + 1] / peak - mean[1];
    out[2 * plane + p] = data[i + 2] / peak - mean[2];
  }
  return out;
}

function maskToSize(raw, w, h) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < raw.length; i++) { if (raw[i] < lo) lo = raw[i]; if (raw[i] > hi) hi = raw[i]; }
  const small = makeCanvas(SIZE, SIZE), sctx = small.getContext('2d');
  const img = sctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < raw.length; i++) { const v = Math.round((raw[i] - lo) / (hi - lo + 1e-9) * 255); img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  sctx.putImageData(img, 0, 0);
  const big = makeCanvas(w, h), bctx = big.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  const px = bctx.getImageData(0, 0, w, h).data, mask = new Float32Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] / 255;
  return mask;
}

const smoothstep = (lo, hi, x) => { const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

// 4-connected components of a boolean mask: returns { labels, sizes } (labels start at 1)
function components(flags, w, h) {
  const labels = new Int32Array(flags.length), sizes = [0], stack = new Int32Array(flags.length);
  let count = 0;
  for (let start = 0; start < flags.length; start++) {
    if (!flags[start] || labels[start]) continue;
    count++; let size = 0, top = 0;
    stack[top++] = start; labels[start] = count;
    while (top) {
      const at = stack[--top]; size++;
      const x = at % w, y = (at / w) | 0;
      if (x > 0 && flags[at - 1] && !labels[at - 1]) { labels[at - 1] = count; stack[top++] = at - 1; }
      if (x < w - 1 && flags[at + 1] && !labels[at + 1]) { labels[at + 1] = count; stack[top++] = at + 1; }
      if (y > 0 && flags[at - w] && !labels[at - w]) { labels[at - w] = count; stack[top++] = at - w; }
      if (y < h - 1 && flags[at + w] && !labels[at + w]) { labels[at + w] = count; stack[top++] = at + w; }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

function dilate(flags, w, h, rounds) {
  let current = flags;
  for (let r = 0; r < rounds; r++) {
    const next = new Uint8Array(current);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (current[i]) continue;
      if ((x > 0 && current[i - 1]) || (x < w - 1 && current[i + 1]) || (y > 0 && current[i - w]) || (y < h - 1 && current[i + w])) next[i] = 1;
    }
    current = next;
  }
  return current;
}

function erode(flags, w, h, rounds) {
  const inverted = new Uint8Array(flags.length);
  for (let i = 0; i < flags.length; i++) inverted[i] = flags[i] ? 0 : 1;
  const grown = dilate(inverted, w, h, rounds);
  const out = new Uint8Array(flags.length);
  for (let i = 0; i < flags.length; i++) out[i] = grown[i] ? 0 : flags[i];
  return out;
}

// Checks that only warn: the owner always sees the result next to the original and decides.
function inspect(alpha, w, h) {
  const n = w * h, solid = new Uint8Array(n);
  let solidCount = 0;
  for (let i = 0; i < n; i++) if (alpha[i] > 0.5) { solid[i] = 1; solidCount++; }
  const problems = [];
  const share = solidCount / n;
  if (share < 0.08) problems.push(`вещь занимает только ${Math.round(share * 100)}% фото: похоже, она не найдена`);
  if (share > 0.85) problems.push(`«вещь» занимает ${Math.round(share * 100)}% фото: похоже, ковёр не отделился`);
  const comp = components(solid, w, h);
  const total = comp.sizes.slice(1).reduce((a, b) => a + b, 0), main = Math.max(0, ...comp.sizes.slice(1));
  if (total && main / total < 0.93) problems.push('вещь распалась на несколько крупных кусков');
  // holes: background reachable only from inside the item (a lost label, a pocket, a cut-through sleeve)
  const outside = new Uint8Array(n);
  for (let i = 0; i < n; i++) outside[i] = solid[i] ? 0 : 1;
  const edge = new Uint8Array(n);
  for (let x = 0; x < w; x++) { edge[x] = outside[x]; edge[(h - 1) * w + x] = outside[(h - 1) * w + x]; }
  for (let y = 0; y < h; y++) { edge[y * w] = outside[y * w]; edge[y * w + w - 1] = outside[y * w + w - 1]; }
  const reach = components(outside, w, h);
  const touching = new Set();
  for (let i = 0; i < n; i++) if (edge[i] && reach.labels[i]) touching.add(reach.labels[i]);
  let holes = 0;
  for (let i = 0; i < n; i++) if (outside[i] && !touching.has(reach.labels[i])) holes++;
  if (solidCount && holes / (solidCount + holes) > 0.0005) problems.push(`внутри вещи есть «дыра» (${holes} px): возможно, потеряна деталь`);
  // uncertain (half-transparent) patches deep inside the item
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = solid[i] || (outside[i] && !touching.has(reach.labels[i])) ? 1 : 0;
  const core = erode(filled, w, h, 4), soft = new Uint8Array(n);
  for (let i = 0; i < n; i++) soft[i] = core[i] && alpha[i] > 0.04 && alpha[i] < 0.96 ? 1 : 0;
  const patches = components(soft, w, h), worst = Math.max(0, ...patches.sizes.slice(1));
  if (worst > 120) problems.push(`внутри вещи есть мутное пятно (${worst} px): возможно, потеряна деталь`);
  return { problems, share };
}

export async function cutOut(src, kind, onStatus = () => {}) {
  const { ort, session } = await loadSession(onStatus);
  const image = await loadImage(src);
  const w = image.naturalWidth, h = image.naturalHeight;
  onStatus('Ищем вещь на фото…');
  await new Promise(resolve => setTimeout(resolve, 30));
  const input = new ort.Tensor('float32', preprocess(image), [1, 3, SIZE, SIZE]);
  const result = await session.run({ [session.inputNames[0]]: input });
  const raw = result[session.outputNames[0]].data;
  onStatus('Вырезаем…');
  await new Promise(resolve => setTimeout(resolve, 30));
  const mask = maskToSize(raw, w, h), n = w * h;
  const alpha = new Float32Array(n), binary = new Uint8Array(n);
  for (let i = 0; i < n; i++) { alpha[i] = smoothstep(0.35, 0.65, mask[i]); binary[i] = mask[i] > 0.5 ? 1 : 0; }
  // keep the main item and any other sizeable piece (e.g. a sleeve cut off by the mask); drop only tiny stray islands
  const comp = components(binary, w, h), keepFlags = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (comp.labels[i] && comp.sizes[comp.labels[i]] >= 0.002 * n) keepFlags[i] = 1;
  const near = dilate(keepFlags, w, h, 3);
  for (let i = 0; i < n; i++) if (!near[i]) alpha[i] = 0;
  const verdict = inspect(alpha, w, h);
  // anti-halo: drop the outermost 1 px ring (grayscale erosion), the usual place for rug-coloured fringes
  const trimmed = new Float32Array(alpha);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    trimmed[i] = Math.min(alpha[i], alpha[i - 1], alpha[i + 1], alpha[i - w], alpha[i + w]);
  }
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (trimmed[y * w + x] > 0.1) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) throw new Error('Вещь на фото не найдена.');
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const source = makeCanvas(w, h), sctx = source.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(image, 0, 0);
  const pixels = sctx.getImageData(0, 0, w, h);
  for (let i = 0; i < n; i++) pixels.data[i * 4 + 3] = Math.round(trimmed[i] * 255);
  sctx.putImageData(pixels, 0, 0);
  const [axis, ratio] = KINDS[kind] || KINDS.top;
  let scale = axis === 'w' ? FRAME.w * ratio / cw : axis === 'h' ? FRAME.h * ratio / ch : Math.min(FRAME.w, FRAME.h) * ratio / Math.max(cw, ch);
  scale = Math.min(scale, FRAME.w / cw, FRAME.h / ch);
  const out = makeCanvas(FRAME.w, FRAME.h), octx = out.getContext('2d');
  octx.imageSmoothingQuality = 'high';
  const dw = Math.max(1, Math.round(cw * scale)), dh = Math.max(1, Math.round(ch * scale));
  octx.drawImage(source, x0, y0, cw, ch, Math.round((FRAME.w - dw) / 2), Math.round((FRAME.h - dh) / 2), dw, dh);
  let dataUrl = out.toDataURL('image/webp', 0.92);
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = out.toDataURL('image/png');
  return { dataUrl, problems: verdict.problems, share: verdict.share, kb: Math.round(dataUrl.length * 0.75 / 1024) };
}
