import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

function siteBase() {
  const raw = process.env.PUBLIC_SITE_URL || process.env.CLIENT_URL || 'http://localhost:5173';
  return raw.split(',')[0].trim().replace(/\/$/, '');
}

function xmlEscape(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const iso = (d) => (d ? new Date(d).toISOString() : undefined);
// Never let one missing table / transient error break the whole sitemap.
const safe = (p) => p.then((r) => r).catch(() => []);

// GET /sitemap.xml — all public URLs (news, sections, listings, shops if present).
router.get('/sitemap.xml', async (req, res) => {
  const site = siteBase();

  const [articles, categories, classifieds] = await Promise.all([
    safe(prisma.article.findMany({ where: { status: 'published' }, select: { slug: true, updatedAt: true } })),
    safe(prisma.category.findMany({ where: { isActive: true }, select: { slug: true } })),
    safe(prisma.classified.findMany({ where: { status: 'approved' }, select: { slug: true, updatedAt: true } })),
  ]);

  // Shops/products only exist once the Dukanen tables are migrated.
  let shops = [];
  let products = [];
  if (prisma.shop && prisma.product) {
    [shops, products] = await Promise.all([
      safe(prisma.shop.findMany({ where: { isActive: true }, select: { slug: true, updatedAt: true } })),
      safe(
        prisma.product.findMany({
          where: { isActive: true, shop: { isActive: true } },
          select: { slug: true, updatedAt: true, shop: { select: { slug: true } } },
        })
      ),
    ]);
  }

  const urls = [
    { loc: `${site}/`, priority: '1.0' },
    { loc: `${site}/classifieds`, priority: '0.5' },
    { loc: `${site}/places`, priority: '0.5' },
    { loc: `${site}/trains`, priority: '0.5' },
    { loc: `${site}/community`, priority: '0.5' },
    { loc: `${site}/about`, priority: '0.3' },
    { loc: `${site}/contact`, priority: '0.3' },
    { loc: `${site}/privacy`, priority: '0.3' },
    { loc: `${site}/terms`, priority: '0.3' },
    ...categories.map((c) => ({ loc: `${site}/category/${c.slug}`, priority: '0.6' })),
    ...articles.map((a) => ({ loc: `${site}/article/${a.slug}`, lastmod: iso(a.updatedAt), priority: '0.8' })),
    ...classifieds.map((c) => ({ loc: `${site}/classifieds/${c.slug}`, lastmod: iso(c.updatedAt), priority: '0.4' })),
    ...shops.map((s) => ({ loc: `${site}/shops/${s.slug}`, lastmod: iso(s.updatedAt), priority: '0.6' })),
    ...products
      .filter((p) => p.shop?.slug)
      .map((p) => ({ loc: `${site}/shops/${p.shop.slug}/product/${p.slug}`, lastmod: iso(p.updatedAt), priority: '0.5' })),
  ];

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          `  <url><loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`
      )
      .join('\n') +
    '\n</urlset>';

  res.header('Content-Type', 'application/xml').send(xml);
});

// GET /news-sitemap.xml — Google News sitemap: published articles from last 2 days.
router.get('/news-sitemap.xml', async (req, res) => {
  const site = siteBase();
  const publicationName = process.env.NEWS_PUBLICATION_NAME || 'Narang Mandi';
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const articles = await safe(
    prisma.article.findMany({
      where: { status: 'published', publishedAt: { gte: twoDaysAgo } },
      select: { slug: true, title: true, publishedAt: true },
      orderBy: { publishedAt: 'desc' },
      take: 1000,
    })
  );

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n' +
    articles
      .filter((a) => a.publishedAt)
      .map(
        (a) =>
          `  <url><loc>${xmlEscape(`${site}/article/${a.slug}`)}</loc>` +
          `<news:news><news:publication><news:name>${xmlEscape(publicationName)}</news:name>` +
          `<news:language>ur</news:language></news:publication>` +
          `<news:publication_date>${new Date(a.publishedAt).toISOString()}</news:publication_date>` +
          `<news:title>${xmlEscape(a.title)}</news:title></news:news></url>`
      )
      .join('\n') +
    '\n</urlset>';

  res.header('Content-Type', 'application/xml').send(xml);
});

export default router;
