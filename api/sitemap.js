import { publicProducts, siteOrigin } from '../lib/public-catalog.js';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

export default async function handler(req, res) {
  const origin = siteOrigin(req);
  const items = (await publicProducts(req)).filter(item => !item.sold);
  const urls = [`${origin}/`, ...items.map(item => `${origin}/p/${item.id}`)];
  res.setHeader('content-type', 'application/xml; charset=utf-8');
  res.setHeader('cache-control', 'public, s-maxage=600, stale-while-revalidate=3600');
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${escape(url)}</loc></url>`).join('\n')}\n</urlset>\n`);
}
