import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { uniqueShortSlug } from '../utils/slugify.js';
import {
  serializeArticle,
  CATEGORY_BRIEF,
  AUTHOR_BRIEF,
} from '../lib/serialize.js';

export const articleSchema = z.object({
  title: z.string().min(1),
  slug: z.string().optional(),
  excerpt: z.string().optional().default(''),
  content: z.string().optional().default(''),
  coverImage: z.string().optional().default(''),
  images: z.array(z.string()).optional().default([]),
  category: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  status: z.enum(['draft', 'published']).optional().default('draft'),
  isCarousel: z.boolean().optional().default(false),
});

export const updateArticleSchema = articleSchema.partial();

const WITH_RELATIONS = { category: CATEGORY_BRIEF, author: AUTHOR_BRIEF };

// Editors are scoped to their own articles; admins see/manage everything.
const ownerWhere = (user) => (user.role === 'admin' ? {} : { authorId: user.id });
const canManage = (user, article) => user.role === 'admin' || article.authorId === user.id;

function clampPage(page, limit, fallbackLimit = 12) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(60, Math.max(1, parseInt(limit, 10) || fallbackLimit));
  return { p, l };
}

async function paginate(where, { page, limit, orderBy, fallbackLimit }) {
  const { p, l } = clampPage(page, limit, fallbackLimit);
  const [data, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy,
      skip: (p - 1) * l,
      take: l,
      include: WITH_RELATIONS,
    }),
    prisma.article.count({ where }),
  ]);
  return {
    data: data.map(serializeArticle),
    page: p,
    total,
    totalPages: Math.ceil(total / l) || 1,
  };
}

// GET /api/articles — public, published only
export const listArticles = asyncHandler(async (req, res) => {
  const where = { status: 'published' };

  if (req.query.category) {
    const cat = await prisma.category.findFirst({
      where: { OR: [{ slug: req.query.category }, { id: req.query.category }] },
      select: { id: true },
    });
    if (!cat) {
      return res.json({ success: true, data: [], page: 1, total: 0, totalPages: 1 });
    }
    where.categoryId = cat.id;
  }

  if (req.query.search) {
    const term = req.query.search;
    where.OR = [
      { title: { contains: term, mode: 'insensitive' } },
      { excerpt: { contains: term, mode: 'insensitive' } },
    ];
  }

  const result = await paginate(where, {
    page: req.query.page,
    limit: req.query.limit,
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ success: true, ...result });
});

// GET /api/articles/carousel
export const carouselArticles = asyncHandler(async (req, res) => {
  const data = await prisma.article.findMany({
    where: { status: 'published', isCarousel: true },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 8,
    include: { category: CATEGORY_BRIEF },
  });
  res.json({ success: true, data: data.map(serializeArticle) });
});

// GET /api/articles/breaking — headlines of up to 10 articles published in the last 24h
export const breakingArticles = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const data = await prisma.article.findMany({
    where: { status: 'published', publishedAt: { gte: since } },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 10,
    select: { id: true, title: true, slug: true },
  });
  res.json({ success: true, data: data.map(serializeArticle) });
});

// GET /api/articles/trending — "مقبول خبریں": latest 6 articles, titles only
export const trendingArticles = asyncHandler(async (req, res) => {
  const data = await prisma.article.findMany({
    where: { status: 'published' },
    orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 6,
    select: { id: true, title: true, slug: true },
  });
  res.json({ success: true, data: data.map(serializeArticle) });
});

// GET /api/articles/:slug — public single (read-only), with related.
// Views are counted separately via POST /:slug/view (de-duped per browser).
export const getArticleBySlug = asyncHandler(async (req, res) => {
  const article = await prisma.article.findFirst({
    where: { slug: req.params.slug, status: 'published' },
    include: WITH_RELATIONS,
  });
  if (!article) throw new ApiError(404, 'Article not found');

  const related = await prisma.article.findMany({
    where: {
      id: { not: article.id },
      status: 'published',
      categoryId: article.categoryId ?? undefined,
    },
    orderBy: { publishedAt: 'desc' },
    take: 4,
    include: { category: CATEGORY_BRIEF },
  });

  res.json({
    success: true,
    data: {
      article: serializeArticle(article),
      related: related.map(serializeArticle),
    },
  });
});

// Common crawler/preview/non-human user agents to skip when counting views.
const BOT_UA = /bot|crawl|spider|slurp|bing|google|baidu|yandex|duckduck|sogou|exabot|facebookexternalhit|facebot|whatsapp|telegram|twitterbot|linkedinbot|embedly|quora|pinterest|redditbot|preview|headless|lighthouse|pagespeed|gtmetrix|curl|wget|python-requests|axios|node-fetch|go-http|java\//i;

// POST /api/articles/:slug/view — increment view count (one call per browser).
export const recordView = asyncHandler(async (req, res) => {
  const ua = req.headers['user-agent'] || '';
  if (!ua || BOT_UA.test(ua)) {
    return res.json({ success: true, data: { counted: false } });
  }
  const result = await prisma.article.updateMany({
    where: { slug: req.params.slug, status: 'published' },
    data: { views: { increment: 1 } },
  });
  if (result.count === 0) throw new ApiError(404, 'Article not found');
  res.json({ success: true, data: { counted: true } });
});

// ---- Admin ----

// GET /api/admin/articles — all incl. drafts, with filters
export const adminListArticles = asyncHandler(async (req, res) => {
  const where = { ...ownerWhere(req.user) };
  if (req.query.status) where.status = req.query.status;
  if (req.query.category) where.categoryId = req.query.category;
  if (req.query.search) {
    where.title = { contains: req.query.search, mode: 'insensitive' };
  }

  const result = await paginate(where, {
    page: req.query.page,
    limit: req.query.limit,
    fallbackLimit: 15,
    orderBy: { createdAt: 'desc' },
  });
  res.json({ success: true, ...result });
});

// GET /api/admin/articles/:id — single (admin, any status)
export const adminGetArticle = asyncHandler(async (req, res) => {
  const article = await prisma.article.findUnique({
    where: { id: req.params.id },
    include: WITH_RELATIONS,
  });
  if (!article) throw new ApiError(404, 'Article not found');
  if (!canManage(req.user, article)) {
    throw new ApiError(403, 'You can only access your own articles');
  }
  res.json({ success: true, data: serializeArticle(article) });
});

// GET /api/admin/stats
export const adminStats = asyncHandler(async (req, res) => {
  const scope = ownerWhere(req.user); // editors see only their own totals
  const [total, published, drafts, categories, viewsAgg] = await Promise.all([
    prisma.article.count({ where: scope }),
    prisma.article.count({ where: { ...scope, status: 'published' } }),
    prisma.article.count({ where: { ...scope, status: 'draft' } }),
    prisma.category.count(),
    prisma.article.aggregate({ _sum: { views: true }, where: scope }),
  ]);
  res.json({
    success: true,
    data: {
      total,
      published,
      drafts,
      categories,
      totalViews: viewsAgg._sum.views || 0,
    },
  });
});

// POST /api/articles
export const createArticle = asyncHandler(async (req, res) => {
  const { category, slug: _ignoredSlug, ...body } = req.body;
  // Auto-generate a short, ASCII link instead of deriving it from the (long) title.
  const slug = await uniqueShortSlug(prisma.article);
  const article = await prisma.article.create({
    data: {
      ...body,
      slug,
      categoryId: category || null,
      authorId: req.user.id,
      publishedAt: body.status === 'published' ? new Date() : null,
    },
    include: WITH_RELATIONS,
  });
  res.status(201).json({ success: true, data: serializeArticle(article), message: 'Article created' });
});

// PUT /api/articles/:id
export const updateArticle = asyncHandler(async (req, res) => {
  const article = await prisma.article.findUnique({ where: { id: req.params.id } });
  if (!article) throw new ApiError(404, 'Article not found');
  if (!canManage(req.user, article)) {
    throw new ApiError(403, 'You can only edit your own articles');
  }

  const { category, slug: _ignoredSlug, ...rest } = req.body;
  const data = { ...rest };

  if (category !== undefined) data.categoryId = category || null;

  // The slug is a permanent short link — never regenerate it on edit, so
  // already-shared URLs keep working.
  delete data.slug;

  // Set publishedAt the first time it becomes published.
  if (data.status === 'published' && article.status !== 'published') {
    data.publishedAt = new Date();
  }

  const updated = await prisma.article.update({
    where: { id: article.id },
    data,
    include: WITH_RELATIONS,
  });
  res.json({ success: true, data: serializeArticle(updated), message: 'Article updated' });
});

// DELETE /api/articles/:id
export const deleteArticle = asyncHandler(async (req, res) => {
  const article = await prisma.article.findUnique({ where: { id: req.params.id } });
  if (!article) throw new ApiError(404, 'Article not found');
  if (!canManage(req.user, article)) {
    throw new ApiError(403, 'You can only delete your own articles');
  }
  await prisma.article.delete({ where: { id: article.id } });
  res.json({ success: true, message: 'Article deleted' });
});
