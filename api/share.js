// Link preview for /p/<id>: Telegram and other crawlers read the Open Graph tags, people are redirected to the catalog.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export default async function handler(req, res) {
  const id = String(req.query?.id ?? '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const origin = `${proto}://${req.headers.host}`;
  let product = null;
  if (/^[a-z0-9-]{1,60}$/.test(id)) {
    try {
      const response = await fetch(`${origin}/data/products.json`);
      if (response.ok) product = (await response.json()).find(item => item.id === id && item.active) || null;
    } catch { /* fall back to the plain site preview */ }
  }
  const photo = product && [...(product.images || []), product.image].find(src => /^\/images\/[a-z0-9.-]+$/.test(src || ''));
  const price = product ? `${new Intl.NumberFormat('ru-RU').format(product.price)} ₽` : '';
  const title = product ? `${product.title} — ${product.sold ? 'ушло' : price} · REWEAR VINTAGE` : 'REWEAR VINTAGE — винтаж в единственном экземпляре';
  const description = product ? ([product.brand, product.era, product.condition].filter(Boolean).join(' · ') || product.description || 'Винтаж в единственном экземпляре') : 'Каждая вещь одна. Паспорт, детали и дефекты на фото. Заказ в Telegram.';
  const target = product ? `/?product=${encodeURIComponent(id)}` : '/';
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=600');
  return res.status(200).send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>${escape(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="${product ? 'product' : 'website'}"><meta property="og:site_name" content="REWEAR VINTAGE">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${escape(origin + (photo || '/og.jpg'))}"><meta property="og:url" content="${escape(origin + (product ? `/p/${id}` : '/'))}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${escape(target)}"></head>
<body><p><a href="${escape(target)}">Открыть в каталоге</a></p><script>location.replace(${JSON.stringify(target)});</script></body></html>`);
}
