import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { uniqueSlug } from '../utils/slugify.js';
import {
  serializePlace,
  serializePlaceCategory,
  PLACE_CATEGORY_BRIEF,
} from '../lib/serialize.js';

// ---------- Place Categories ----------

export const placeCategorySchema = z.object({
  name: z.string().min(1),
  nameEn: z.string().optional().default(''),
  slug: z.string().optional(),
  icon: z.string().optional().default(''),
  order: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const listPlaceCategories = asyncHandler(async (req, res) => {
  const where = req.query.all === 'true' ? {} : { isActive: true };
  const categories = await prisma.placeCategory.findMany({
    where,
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  // Attach an approved-place count so the public sidebar can show totals.
  const counts = await prisma.place.groupBy({
    by: ['categoryId'],
    where: { status: 'approved' },
    _count: { _all: true },
  });
  const countMap = Object.fromEntries(counts.map((c) => [c.categoryId, c._count._all]));
  res.json({
    success: true,
    data: categories.map((c) => ({
      ...serializePlaceCategory(c),
      placeCount: countMap[c.id] || 0,
    })),
  });
});

export const createPlaceCategory = asyncHandler(async (req, res) => {
  const slug = await uniqueSlug(prisma.placeCategory, req.body.slug || req.body.name);
  const category = await prisma.placeCategory.create({ data: { ...req.body, slug } });
  res
    .status(201)
    .json({ success: true, data: serializePlaceCategory(category), message: 'Place category created' });
});

export const updatePlaceCategory = asyncHandler(async (req, res) => {
  const category = await prisma.placeCategory.findUnique({ where: { id: req.params.id } });
  if (!category) throw new ApiError(404, 'Place category not found');
  const data = { ...req.body };
  if (data.slug && data.slug !== category.slug) {
    data.slug = await uniqueSlug(prisma.placeCategory, data.slug, category.id);
  }
  const updated = await prisma.placeCategory.update({ where: { id: category.id }, data });
  res.json({ success: true, data: serializePlaceCategory(updated), message: 'Place category updated' });
});

export const deletePlaceCategory = asyncHandler(async (req, res) => {
  const category = await prisma.placeCategory.findUnique({ where: { id: req.params.id } });
  if (!category) throw new ApiError(404, 'Place category not found');
  const count = await prisma.place.count({ where: { categoryId: category.id } });
  if (count > 0) {
    throw new ApiError(400, `Cannot delete: ${count} place(s) use this category`);
  }
  await prisma.placeCategory.delete({ where: { id: category.id } });
  res.json({ success: true, message: 'Place category deleted' });
});

// ---------- Places ----------

// Public submission: only name + category + Google Maps link are required.
export const placeSubmitSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string().min(1),
  googleMapsUrl: z.string().url('A valid Google Maps link is required'),
  address: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  submittedBy: z.string().optional().default(''),
});

// Admin create/update: everything is editable.
export const placeAdminSchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  address: z.string().optional().default(''),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  phone: z.string().optional().default(''),
  rating: z.number().nullable().optional(),
  ratingCount: z.number().int().nullable().optional(),
  hours: z.string().optional().default(''),
  googleMapsUrl: z.string().optional().default(''),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  submittedBy: z.string().optional().default(''),
});

// GET /api/places — public, approved only, with category + search filters.
export const listPlaces = asyncHandler(async (req, res) => {
  const { category, search } = req.query;
  const where = { status: 'approved' };
  if (category) where.category = { slug: category };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { address: { contains: search, mode: 'insensitive' } },
    ];
  }
  const places = await prisma.place.findMany({
    where,
    include: { category: PLACE_CATEGORY_BRIEF },
    orderBy: [{ name: 'asc' }],
  });
  res.json({ success: true, data: places.map(serializePlace) });
});

// POST /api/places — public submission, lands as pending.
export const submitPlace = asyncHandler(async (req, res) => {
  const exists = await prisma.placeCategory.findUnique({ where: { id: req.body.categoryId } });
  if (!exists) throw new ApiError(400, 'Invalid category');
  const slug = await uniqueSlug(prisma.place, req.body.name);
  const place = await prisma.place.create({
    data: { ...req.body, slug, status: 'pending' },
    include: { category: PLACE_CATEGORY_BRIEF },
  });
  res.status(201).json({
    success: true,
    data: serializePlace(place),
    message: 'شکریہ! آپ کی تجویز موصول ہو گئی ہے اور منظوری کے بعد شائع کر دی جائے گی۔',
  });
});

// GET /api/admin/places — admin, all statuses, optional status filter.
export const adminListPlaces = asyncHandler(async (req, res) => {
  const { status, category } = req.query;
  const where = {};
  if (status) where.status = status;
  if (category) where.categoryId = category;
  const places = await prisma.place.findMany({
    where,
    include: { category: PLACE_CATEGORY_BRIEF },
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json({ success: true, data: places.map(serializePlace) });
});

export const createPlace = asyncHandler(async (req, res) => {
  const slug = await uniqueSlug(prisma.place, req.body.slug || req.body.name);
  const place = await prisma.place.create({
    data: { status: 'approved', ...req.body, slug },
    include: { category: PLACE_CATEGORY_BRIEF },
  });
  res.status(201).json({ success: true, data: serializePlace(place), message: 'Place created' });
});

export const updatePlace = asyncHandler(async (req, res) => {
  const place = await prisma.place.findUnique({ where: { id: req.params.id } });
  if (!place) throw new ApiError(404, 'Place not found');
  const data = { ...req.body };
  if (data.slug && data.slug !== place.slug) {
    data.slug = await uniqueSlug(prisma.place, data.slug, place.id);
  }
  const updated = await prisma.place.update({
    where: { id: place.id },
    data,
    include: { category: PLACE_CATEGORY_BRIEF },
  });
  res.json({ success: true, data: serializePlace(updated), message: 'Place updated' });
});

// PATCH /api/admin/places/:id/status — approve or reject a submission.
export const setPlaceStatus = asyncHandler(async (req, res) => {
  const status = req.body?.status;
  if (!['pending', 'approved', 'rejected'].includes(status)) {
    throw new ApiError(400, 'Invalid status');
  }
  const place = await prisma.place.findUnique({ where: { id: req.params.id } });
  if (!place) throw new ApiError(404, 'Place not found');
  const updated = await prisma.place.update({
    where: { id: place.id },
    data: { status },
    include: { category: PLACE_CATEGORY_BRIEF },
  });
  res.json({ success: true, data: serializePlace(updated), message: `Place ${status}` });
});

export const deletePlace = asyncHandler(async (req, res) => {
  const place = await prisma.place.findUnique({ where: { id: req.params.id } });
  if (!place) throw new ApiError(404, 'Place not found');
  await prisma.place.delete({ where: { id: place.id } });
  res.json({ success: true, message: 'Place deleted' });
});
