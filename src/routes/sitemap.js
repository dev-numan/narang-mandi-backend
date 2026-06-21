import { Router } from 'express';
import prisma from '../lib/prisma.js';

const router = Router();

// GET /sitemap.xml — dynamic sitemap of public URLs.
router.get('/sitemap.xml', async (req, res) => {
  const site = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim();
  const [articles, categories] = await Promise.all([
    prisma.article.findMany({ where: { status: 'published' }, select: { slug: true, updatedAt: true } }),
    prisma.category.findMany({ where: { isActive: true }, select: { slug: true } }),
  ]);

  const urls = [
    { loc: `${site}/`, priority: '1.0' },
    { loc: `${site}/about`, priority: '0.3' },
    { loc: `${site}/contact`, priority: '0.3' },
    { loc: `${site}/privacy`, priority: '0.3' },
    ...categories.map((c) => ({ loc: `${site}/category/${c.slug}`, priority: '0.6' })),
    ...articles.map((a) => ({
      loc: `${site}/article/${a.slug}`,
      lastmod: a.updatedAt?.toISOString(),
      priority: '0.8',
    })),
  ];

  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          `  <url><loc>${u.loc}</loc>${
            u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''
          }<priority>${u.priority}</priority></url>`
      )
      .join('\n') +
    '\n</urlset>';

  res.header('Content-Type', 'application/xml').send(xml);
});

export default router;
