import prisma from './prisma.js';

// Builds correct <head> metadata for a given SPA route so crawlers and social
// scrapers (which don't run JS) get the right title / description / Open Graph /
// JSON-LD for every URL — the same values the React app would set client-side.

const SITE_NAME = 'Narang Mandi';

export function siteBase() {
  const raw = process.env.PUBLIC_SITE_URL || process.env.CLIENT_URL || 'https://narangmandi.com';
  return raw.split(',')[0].trim().replace(/\/$/, '');
}

function esc(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DEFAULT_DESC =
  'نارنگ منڈی کی تازہ ترین خبریں، سیاست، کھیل، مقامی واقعات اور بہت کچھ۔ Narang Mandi — latest local news.';

// A static title/description table for non-detail routes.
const STATIC = {
  '/': { title: `${SITE_NAME} | نارنگ منڈی نیوز — تازہ ترین خبریں`, social: 'نارنگ منڈی نیوز — تازہ ترین خبریں', desc: DEFAULT_DESC },
  '/places': { title: `مشہور مقامات — ${SITE_NAME}`, desc: 'نارنگ منڈی کے مشہور مقامات، دکانیں اور خدمات۔' },
  '/trains': { title: `ٹرین اوقات — ${SITE_NAME}`, desc: 'نارنگ منڈی ریلوے اسٹیشن سے ٹرینوں کی آمد و رفتار کے اوقات۔' },
  '/community': { title: `کمیونٹی چیٹ — ${SITE_NAME}`, desc: 'نارنگ منڈی کمیونٹی فورم — مقامی گفتگو اور معلومات۔' },
  '/classifieds': { title: `اشتہارات — ${SITE_NAME}`, desc: 'نارنگ منڈی کے مقامی اشتہارات — خرید و فروخت، نوکریاں، گاڑیاں۔' },
  '/shops': { title: `دکانیں — ${SITE_NAME}`, social: 'نارنگ منڈی کی دکانیں', desc: 'نارنگ منڈی کی مقامی دکانیں — آن لائن خریداری اور ڈیلیوری۔' },
  '/about': { title: `ہمارے بارے میں — ${SITE_NAME}`, desc: 'نارنگ منڈی نیوز کے بارے میں معلومات۔' },
  '/contact': { title: `رابطہ — ${SITE_NAME}`, desc: 'نارنگ منڈی نیوز سے رابطہ کریں۔' },
  '/privacy': { title: `پرائیویسی پالیسی — ${SITE_NAME}`, desc: 'نارنگ منڈی نیوز کی پرائیویسی پالیسی۔' },
  '/search': { title: `تلاش — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true },
  '/cart': { title: `ٹوکری — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true },
  '/orders/track': { title: `آرڈر ٹریک کریں — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true },
};

// Returns { title, social, desc, image?, type?, canonical, noindex?, published?, modified?, jsonLd?[], status }
export async function metaForPath(pathname) {
  const base = siteBase();
  const path = pathname.replace(/\/+$/, '') || '/';
  const canonical = `${base}${path === '/' ? '/' : path}`;
  const out = (m) => ({ type: 'website', canonical, ...m });

  // Static routes
  if (STATIC[path]) return out(STATIC[path]);

  // /article/:slug
  let m = path.match(/^\/article\/([^/]+)$/);
  if (m) {
    const article = await prisma.article.findUnique({
      where: { slug: m[1] },
      include: { category: { select: { name: true, slug: true } }, author: { select: { name: true } } },
    });
    if (!article || article.status !== 'published') {
      return out({ title: `صفحہ نہیں ملا — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true, status: 404 });
    }
    const desc = article.excerpt || article.title;
    const published = (article.publishedAt || article.createdAt)?.toISOString();
    const modified = (article.updatedAt || article.publishedAt || article.createdAt)?.toISOString();
    return out({
      title: `${article.title} — ${SITE_NAME}`,
      social: article.title,
      desc,
      image: article.coverImage || undefined,
      type: 'article',
      published,
      modified,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'NewsArticle',
          headline: article.title,
          description: desc,
          image: article.coverImage ? [article.coverImage] : undefined,
          datePublished: published,
          dateModified: modified,
          author: article.author?.name
            ? { '@type': 'Person', name: article.author.name }
            : { '@type': 'Organization', name: SITE_NAME },
          publisher: {
            '@type': 'NewsMediaOrganization',
            name: SITE_NAME,
            logo: { '@type': 'ImageObject', url: `${base}/og-default.png` },
          },
          mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
          inLanguage: 'ur',
        },
      ],
    });
  }

  // /category/:slug
  m = path.match(/^\/category\/([^/]+)$/);
  if (m) {
    const cat = await prisma.category.findUnique({ where: { slug: m[1] } });
    if (!cat) return out({ title: `صفحہ نہیں ملا — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true, status: 404 });
    return out({
      title: `${cat.name} — ${SITE_NAME}`,
      social: cat.name,
      desc: `${cat.name} کی تازہ ترین خبریں — نارنگ منڈی۔`,
    });
  }

  // /shops/:slug/product/:productSlug
  m = path.match(/^\/shops\/([^/]+)\/product\/([^/]+)$/);
  if (m) {
    const product = await prisma.product.findUnique({
      where: { slug: m[2] },
      include: { shop: { select: { name: true, slug: true, isActive: true } } },
    });
    if (!product || !product.isActive || !product.shop?.isActive || product.shop.slug !== m[1]) {
      return out({ title: `صفحہ نہیں ملا — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true, status: 404 });
    }
    return out({
      title: `${product.name} — ${product.shop.name}`,
      social: product.name,
      desc: product.description || `${product.name} — ${product.shop.name} سے آرڈر کریں۔`,
      image: product.images?.[0] || undefined,
      type: 'product',
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Product',
          name: product.name,
          description: product.description || undefined,
          image: product.images?.length ? product.images : undefined,
          offers: {
            '@type': 'Offer',
            price: product.price,
            priceCurrency: 'PKR',
            // Inventory is not tracked, so an active product is always orderable.
            availability: 'https://schema.org/InStock',
            url: canonical,
          },
        },
      ],
    });
  }

  // /shops/:slug
  m = path.match(/^\/shops\/([^/]+)$/);
  if (m) {
    const shop = await prisma.shop.findUnique({ where: { slug: m[1] } });
    if (!shop || !shop.isActive) return out({ title: `صفحہ نہیں ملا — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true, status: 404 });
    return out({
      title: `${shop.name} — ${SITE_NAME}`,
      social: shop.name,
      desc: shop.description || `${shop.name} — نارنگ منڈی کی دکان سے آن لائن خریداری کریں۔`,
      image: shop.coverImage || shop.logo || undefined,
    });
  }

  // /community/:slug (thread) — indexable, but title unknown without lookup; keep generic
  m = path.match(/^\/community\/([^/]+)$/);
  if (m) {
    const thread = await prisma.thread.findUnique({ where: { slug: m[1] } });
    if (!thread) return out({ title: `صفحہ نہیں ملا — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true, status: 404 });
    return out({ title: `${thread.title} — ${SITE_NAME}`, social: thread.title, desc: thread.description || `${thread.title} — نارنگ منڈی کمیونٹی۔` });
  }

  // /classifieds/:slug
  m = path.match(/^\/classifieds\/([^/]+)$/);
  if (m) {
    const listing = await prisma.classified.findUnique({ where: { slug: m[1] } });
    if (!listing || listing.status !== 'approved') return out({ title: `صفحہ نہیں ملا — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true, status: 404 });
    return out({ title: `${listing.title} — ${SITE_NAME}`, social: listing.title, desc: listing.description || listing.title, image: listing.images?.[0] || undefined });
  }

  // Unknown route — let the SPA render, but keep it out of the index.
  return out({ title: `صفحہ نہیں ملا — ${SITE_NAME}`, desc: DEFAULT_DESC, noindex: true, status: 404 });
}

// Rewrites the built index.html <head> with the per-route metadata.
export function injectMeta(html, meta) {
  const base = siteBase();
  const image = meta.image || `${base}/og-default.png`;
  const social = meta.social || meta.title;

  let out = html;

  // <title>
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`);

  // Replace the content of a single meta by name/property, else no-op.
  const setMeta = (attr, key, value) => {
    const re = new RegExp(`(<meta\\s+${attr}=["']${key}["']\\s+content=["'])[\\s\\S]*?(["'][^>]*>)`, 'i');
    if (re.test(out)) out = out.replace(re, `$1${esc(value)}$2`);
    else out = out.replace('</head>', `    <meta ${attr}="${key}" content="${esc(value)}" />\n  </head>`);
  };

  setMeta('name', 'description', meta.desc || DEFAULT_DESC);
  setMeta('property', 'og:title', social);
  setMeta('property', 'og:description', meta.desc || DEFAULT_DESC);
  setMeta('property', 'og:type', meta.type || 'website');
  setMeta('property', 'og:url', meta.canonical);
  setMeta('property', 'og:image', image);
  setMeta('name', 'twitter:title', social);
  setMeta('name', 'twitter:description', meta.desc || DEFAULT_DESC);
  setMeta('name', 'twitter:image', image);

  // Canonical
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(out)) {
    out = out.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${esc(meta.canonical)}" />`);
  } else {
    out = out.replace('</head>', `    <link rel="canonical" href="${esc(meta.canonical)}" />\n  </head>`);
  }

  // Robots + article times + JSON-LD injected before </head>
  const extra = [];
  extra.push(`<meta name="robots" content="${meta.noindex ? 'noindex, follow' : 'index, follow'}" />`);
  if (meta.published) extra.push(`<meta property="article:published_time" content="${esc(meta.published)}" />`);
  if (meta.modified) extra.push(`<meta property="article:modified_time" content="${esc(meta.modified)}" />`);
  for (const block of meta.jsonLd || []) {
    extra.push(`<script type="application/ld+json">${JSON.stringify(block)}</script>`);
  }
  out = out.replace('</head>', `    ${extra.join('\n    ')}\n  </head>`);

  return out;
}
