import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { uniqueSlug } from '../utils/slugify.js';
import { serializeCategory } from '../lib/serialize.js';

export const categorySchema = z.object({
  name: z.string().min(1),
  slug: z.string().optional(),
  description: z.string().optional().default(''),
  order: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const listCategories = asyncHandler(async (req, res) => {
  const where = req.query.all === 'true' ? {} : { isActive: true };
  const categories = await prisma.category.findMany({
    where,
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ success: true, data: categories.map(serializeCategory) });
});

export const createCategory = asyncHandler(async (req, res) => {
  const slug = await uniqueSlug(prisma.category, req.body.slug || req.body.name);
  const category = await prisma.category.create({ data: { ...req.body, slug } });
  res.status(201).json({ success: true, data: serializeCategory(category), message: 'Category created' });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category) throw new ApiError(404, 'Category not found');
  const data = { ...req.body };
  if (data.slug && data.slug !== category.slug) {
    data.slug = await uniqueSlug(prisma.category, data.slug, category.id);
  }
  const updated = await prisma.category.update({ where: { id: category.id }, data });
  res.json({ success: true, data: serializeCategory(updated), message: 'Category updated' });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const category = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!category) throw new ApiError(404, 'Category not found');
  const count = await prisma.article.count({ where: { categoryId: category.id } });
  if (count > 0) {
    throw new ApiError(400, `Cannot delete: ${count} article(s) use this category`);
  }
  await prisma.category.delete({ where: { id: category.id } });
  res.json({ success: true, message: 'Category deleted' });
});
