import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { uniqueSlug } from '../utils/slugify.js';
import {
  serializeClassified,
  serializeClassifiedCategory,
  CLASSIFIED_CATEGORY_BRIEF,
} from '../lib/serialize.js';
import { uniqueNumericCode } from '../utils/code.js';
import { normalizePhone } from '../utils/phone.js';

const generateSaleCode = () => uniqueNumericCode(prisma.classified, 'saleCode');

// ---------- Classified Categories ----------

export const classifiedCategorySchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().default(''),
  slug: z.string().optional(),
  icon: z.string().optional().default(''),
  order: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const listClassifiedCategories = asyncHandler(async (req, res) => {
  const where = req.query.all === 'true' ? {} : { isActive: true };
  const categories = await prisma.classifiedCategory.findMany({
    where,
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  // Count only approved listings per category (for the public sidebar).
  const counts = await prisma.classified.groupBy({
    by: ['categoryId'],
    where: { status: 'approved' },
    _count: { _all: true },
  });
  const countMap = Object.fromEntries(counts.map((c) => [c.categoryId, c._count._all]));
  res.json({
    success: true,
    data: categories.map((c) => ({
      ...serializeClassifiedCategory(c),
      listingCount: countMap[c.id] || 0,
    })),
  });
});

export const createClassifiedCategory = asyncHandler(async (req, res) => {
  const slug = await uniqueSlug(prisma.classifiedCategory, req.body.slug || req.body.name);
  const category = await prisma.classifiedCategory.create({ data: { ...req.body, slug } });
  res
    .status(201)
    .json({ success: true, data: serializeClassifiedCategory(category), message: 'Category created' });
});

export const updateClassifiedCategory = asyncHandler(async (req, res) => {
  const category = await prisma.classifiedCategory.findUnique({ where: { id: req.params.id } });
  if (!category) throw new ApiError(404, 'Category not found');
  const data = { ...req.body };
  if (data.slug && data.slug !== category.slug) {
    data.slug = await uniqueSlug(prisma.classifiedCategory, data.slug, category.id);
  }
  const updated = await prisma.classifiedCategory.update({ where: { id: category.id }, data });
  res.json({ success: true, data: serializeClassifiedCategory(updated), message: 'Category updated' });
});

export const deleteClassifiedCategory = asyncHandler(async (req, res) => {
  const category = await prisma.classifiedCategory.findUnique({ where: { id: req.params.id } });
  if (!category) throw new ApiError(404, 'Category not found');
  const count = await prisma.classified.count({ where: { categoryId: category.id } });
  if (count > 0) throw new ApiError(400, `Cannot delete: ${count} listing(s) use this category`);
  await prisma.classifiedCategory.delete({ where: { id: category.id } });
  res.json({ success: true, message: 'Category deleted' });
});

// ---------- Listings ----------

// Public submission — title + category + phone required; lands as pending.
export const classifiedSubmitSchema = z.object({
  title: z.string().min(1).max(140),
  categoryId: z.string().min(1),
  phone: z.string().min(1).max(40),
  description: z.string().max(4000).optional().default(''),
  price: z.number().int().nonnegative().nullable().optional(),
  negotiable: z.boolean().optional().default(false),
  location: z.string().max(120).optional().default(''),
  contactName: z.string().max(60).optional().default(''),
  images: z.array(z.string().url()).max(5).optional().default([]),
  submittedBy: z.string().max(60).optional().default(''),
});

export const markSoldSchema = z.object({
  saleCode: z.string().regex(/^\d{6,8}$/, 'Valid sale code required'),
  phone: z.string().min(7).max(40),
});

// Admin create/update — everything editable.
export const classifiedAdminSchema = z.object({
  title: z.string().min(1),
  slug: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  description: z.string().optional().default(''),
  price: z.number().int().nonnegative().nullable().optional(),
  negotiable: z.boolean().optional(),
  location: z.string().optional().default(''),
  contactName: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  images: z.array(z.string()).optional(),
  isSold: z.boolean().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  submittedBy: z.string().optional().default(''),
});

// GET /api/classifieds — public, approved only, with category + search filters.
export const listClassifieds = asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  const where = { status: 'approved' };
  if (category) where.category = { slug: category };
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  const listings = await prisma.classified.findMany({
    where,
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
    // Available items first, then newest.
    orderBy: [{ isSold: 'asc' }, { createdAt: 'desc' }],
  });
  res.json({ success: true, data: listings.map(serializeClassified) });
});

// GET /api/classifieds/:slug — public detail.
export const getClassified = asyncHandler(async (req, res) => {
  const listing = await prisma.classified.findUnique({
    where: { slug: req.params.slug },
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
  });
  if (!listing || listing.status !== 'approved') throw new ApiError(404, 'Listing not found');
  res.json({ success: true, data: serializeClassified(listing) });
});

// POST /api/classifieds — public submission → pending.
export const submitClassified = asyncHandler(async (req, res) => {
  const exists = await prisma.classifiedCategory.findUnique({ where: { id: req.body.categoryId } });
  if (!exists) throw new ApiError(400, 'Invalid category');
  const slug = await uniqueSlug(prisma.classified, req.body.title);
  const saleCode = await generateSaleCode();
  const listing = await prisma.classified.create({
    data: { ...req.body, slug, saleCode, status: 'pending' },
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
  });
  res.status(201).json({
    success: true,
    data: serializeClassified(listing, { includeSaleCode: true }),
    message: 'شکریہ! آپ کا اشتہار موصول ہو گیا ہے اور منظوری کے بعد شائع کر دیا جائے گا۔',
  });
});

// POST /api/classifieds/mark-sold — owner marks listing sold with code + phone.
export const markSoldByCode = asyncHandler(async (req, res) => {
  const listing = await prisma.classified.findUnique({
    where: { saleCode: req.body.saleCode },
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
  });
  const invalidMsg = 'غلط کوڈ یا فون نمبر — دوبارہ کوشش کریں';
  if (!listing || listing.status !== 'approved') {
    throw new ApiError(404, invalidMsg);
  }
  if (normalizePhone(listing.phone) !== normalizePhone(req.body.phone)) {
    throw new ApiError(404, invalidMsg);
  }
  if (listing.isSold) {
    throw new ApiError(400, 'یہ اشتہار پہلے ہی فروخت شدہ قرار دیا جا چکا ہے');
  }
  const updated = await prisma.classified.update({
    where: { id: listing.id },
    data: { isSold: true },
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
  });
  res.json({
    success: true,
    data: serializeClassified(updated),
    message: 'مبارک ہو! آپ کی چیز فروخت شدہ قرار دے دی گئی ہے۔',
  });
});

// GET /api/admin/classifieds — admin, all statuses.
export const adminListClassifieds = asyncHandler(async (req, res) => {
  const { status, category } = req.query;
  const where = {};
  if (status) where.status = status;
  if (category) where.categoryId = category;
  const listings = await prisma.classified.findMany({
    where,
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json({ success: true, data: listings.map((l) => serializeClassified(l, { includeSaleCode: true })) });
});

export const createClassified = asyncHandler(async (req, res) => {
  const slug = await uniqueSlug(prisma.classified, req.body.slug || req.body.title);
  const saleCode = await generateSaleCode();
  const listing = await prisma.classified.create({
    data: { status: 'approved', ...req.body, slug, saleCode },
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
  });
  res.status(201).json({ success: true, data: serializeClassified(listing, { includeSaleCode: true }), message: 'Listing created' });
});

export const updateClassified = asyncHandler(async (req, res) => {
  const listing = await prisma.classified.findUnique({ where: { id: req.params.id } });
  if (!listing) throw new ApiError(404, 'Listing not found');
  const data = { ...req.body };
  if (data.slug && data.slug !== listing.slug) {
    data.slug = await uniqueSlug(prisma.classified, data.slug, listing.id);
  }
  const updated = await prisma.classified.update({
    where: { id: listing.id },
    data,
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
  });
  res.json({ success: true, data: serializeClassified(updated), message: 'Listing updated' });
});

// PATCH /api/admin/classifieds/:id/status — approve or reject.
export const setClassifiedStatus = asyncHandler(async (req, res) => {
  const status = req.body?.status;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    throw new ApiError(400, 'Invalid status');
  }
  const listing = await prisma.classified.findUnique({ where: { id: req.params.id } });
  if (!listing) throw new ApiError(404, 'Listing not found');
  const data = { status };
  if (status === 'approved' && !listing.saleCode) {
    data.saleCode = await generateSaleCode();
  }
  const updated = await prisma.classified.update({
    where: { id: listing.id },
    data,
    include: { category: CLASSIFIED_CATEGORY_BRIEF },
  });
  res.json({ success: true, data: serializeClassified(updated, { includeSaleCode: true }), message: `Listing ${status}` });
});

export const deleteClassified = asyncHandler(async (req, res) => {
  const listing = await prisma.classified.findUnique({ where: { id: req.params.id } });
  if (!listing) throw new ApiError(404, 'Listing not found');
  await prisma.classified.delete({ where: { id: listing.id } });
  res.json({ success: true, message: 'Listing deleted' });
});
