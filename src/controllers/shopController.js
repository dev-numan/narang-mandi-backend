import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { hashPassword } from '../lib/password.js';
import { uniqueSlug } from '../utils/slugify.js';
import {
  serializeShop,
  serializeShopCategory,
  serializeProduct,
  serializeUser,
  SHOP_BRIEF,
  SHOP_CATEGORY_BRIEF,
} from '../lib/serialize.js';

// Resolve the shop owned by the logged-in shopkeeper. Admins don't own shops —
// they manage them from the super-admin panel — so this 404s for them.
async function getOwnerShop(req) {
  const shop = await prisma.shop.findFirst({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!shop) throw new ApiError(404, 'آپ کے ساتھ کوئی دکان منسلک نہیں ہے');
  return shop;
}

// ==================== PUBLIC ====================

// GET /api/shops — active shops, optional ?search=
export const listShops = asyncHandler(async (req, res) => {
  const { search } = req.query;
  const where = { isActive: true };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  const shops = await prisma.shop.findMany({
    where,
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    // Active only, so the number shown on a card matches what opening the shop
    // actually lists — and so a shop whose stock is all hidden cannot outrank
    // one with products on display.
    include: { _count: { select: { products: { where: { isActive: true } } } } },
  });

  // Sorted here rather than in the query: Prisma can order by a relation count
  // but not by a *filtered* one, and this endpoint returns every shop, so the
  // ordering is exact. Array.sort is stable, so shops with equal counts keep
  // the curated `order` the query already applied.
  const data = shops
    .map(serializeShop)
    .sort((a, b) => (b.productCount || 0) - (a.productCount || 0));

  res.json({ success: true, data });
});

// GET /api/shops/:slug — public shop profile + its active categories
export const getShop = asyncHandler(async (req, res) => {
  const shop = await prisma.shop.findUnique({
    where: { slug: req.params.slug },
    include: {
      categories: {
        where: { isActive: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
        include: { _count: { select: { products: { where: { isActive: true } } } } },
      },
    },
  });
  if (!shop || !shop.isActive) throw new ApiError(404, 'دکان نہیں ملی');
  res.json({ success: true, data: serializeShop(shop) });
});

// GET /api/shops/:slug/products — active products, ?category=&search=
export const listShopProducts = asyncHandler(async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { slug: req.params.slug } });
  if (!shop || !shop.isActive) throw new ApiError(404, 'دکان نہیں ملی');
  const { category, search } = req.query;
  const where = { shopId: shop.id, isActive: true };
  if (category) where.category = { slug: category };
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }
  const products = await prisma.product.findMany({
    where,
    include: { category: SHOP_CATEGORY_BRIEF },
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json({ success: true, data: products.map(serializeProduct) });
});

// GET /api/shops/:slug/products/:productSlug — public product detail
export const getShopProduct = asyncHandler(async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { slug: req.params.slug } });
  if (!shop || !shop.isActive) throw new ApiError(404, 'دکان نہیں ملی');
  const product = await prisma.product.findUnique({
    where: { slug: req.params.productSlug },
    include: { category: SHOP_CATEGORY_BRIEF, shop: SHOP_BRIEF },
  });
  if (!product || product.shopId !== shop.id || !product.isActive) {
    throw new ApiError(404, 'پروڈکٹ نہیں ملی');
  }
  res.json({ success: true, data: serializeProduct(product) });
});

// ==================== SHOPKEEPER (owner-scoped) ====================

// GET /api/shop-admin/shop
export const getMyShop = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  res.json({ success: true, data: serializeShop(shop) });
});

export const updateShopSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  logo: z.string().optional(),
  coverImage: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
});

// PUT /api/shop-admin/shop
export const updateMyShop = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const data = { ...req.body };
  if (data.name && data.name !== shop.name) {
    data.slug = await uniqueSlug(prisma.shop, data.name, shop.id);
  }
  const updated = await prisma.shop.update({ where: { id: shop.id }, data });
  res.json({ success: true, data: serializeShop(updated), message: 'دکان اپ ڈیٹ ہو گئی' });
});

// ---------- Shop categories (owner-scoped) ----------

export const shopCategorySchema = z.object({
  name: z.string().min(1).max(50, 'Category name is too long (max 50 characters)'),
  nameEn: z.string().optional().default(''),
  slug: z.string().optional(),
  order: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const listMyCategories = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const categories = await prisma.shopCategory.findMany({
    where: { shopId: shop.id },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  res.json({ success: true, data: categories.map(serializeShopCategory) });
});

export const createMyCategory = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const slug = await uniqueSlug(prisma.shopCategory, req.body.slug || req.body.name);
  const category = await prisma.shopCategory.create({
    data: { ...req.body, slug, shopId: shop.id },
  });
  res
    .status(201)
    .json({ success: true, data: serializeShopCategory(category), message: 'زمرہ بن گیا' });
});

export const updateMyCategory = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const category = await prisma.shopCategory.findUnique({ where: { id: req.params.id } });
  if (!category || category.shopId !== shop.id) throw new ApiError(404, 'زمرہ نہیں ملا');
  const data = { ...req.body };
  if (data.slug && data.slug !== category.slug) {
    data.slug = await uniqueSlug(prisma.shopCategory, data.slug, category.id);
  }
  const updated = await prisma.shopCategory.update({ where: { id: category.id }, data });
  res.json({ success: true, data: serializeShopCategory(updated), message: 'زمرہ اپ ڈیٹ ہو گیا' });
});

export const deleteMyCategory = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const category = await prisma.shopCategory.findUnique({ where: { id: req.params.id } });
  if (!category || category.shopId !== shop.id) throw new ApiError(404, 'زمرہ نہیں ملا');
  const count = await prisma.product.count({ where: { categoryId: category.id } });
  if (count > 0) throw new ApiError(400, `حذف نہیں ہو سکتا: اس زمرے میں ${count} پروڈکٹس ہیں`);
  await prisma.shopCategory.delete({ where: { id: category.id } });
  res.json({ success: true, message: 'زمرہ حذف ہو گیا' });
});

// ---------- Products (owner-scoped) ----------

// Must stay non-strict. Installed Android builds from before stock tracking was
// removed still send a `stock` key, and zod's default unknown-key stripping is
// the only reason those saves keep working — `.strict()` here would turn every
// product save from an old APK into a validation error.
export const productSchema = z.object({
  name: z.string().min(1).max(50, 'Product name is too long (max 50 characters)'),
  slug: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  description: z.string().optional().default(''),
  price: z.number().int().nonnegative().optional().default(0),
  images: z.array(z.string()).optional().default([]),
  isActive: z.boolean().optional().default(true),
});

export const listMyProducts = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const products = await prisma.product.findMany({
    where: { shopId: shop.id },
    include: { category: SHOP_CATEGORY_BRIEF },
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json({ success: true, data: products.map(serializeProduct) });
});

export const createMyProduct = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  if (req.body.categoryId) {
    const cat = await prisma.shopCategory.findUnique({ where: { id: req.body.categoryId } });
    if (!cat || cat.shopId !== shop.id) throw new ApiError(400, 'غلط زمرہ');
  }
  const slug = await uniqueSlug(prisma.product, req.body.slug || req.body.name);
  const product = await prisma.product.create({
    data: { ...req.body, slug, shopId: shop.id },
    include: { category: SHOP_CATEGORY_BRIEF },
  });
  res.status(201).json({ success: true, data: serializeProduct(product), message: 'پروڈکٹ بن گئی' });
});

export const updateMyProduct = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product || product.shopId !== shop.id) throw new ApiError(404, 'پروڈکٹ نہیں ملی');
  const data = { ...req.body };
  if (data.categoryId) {
    const cat = await prisma.shopCategory.findUnique({ where: { id: data.categoryId } });
    if (!cat || cat.shopId !== shop.id) throw new ApiError(400, 'غلط زمرہ');
  }
  if (data.slug && data.slug !== product.slug) {
    data.slug = await uniqueSlug(prisma.product, data.slug, product.id);
  }
  const updated = await prisma.product.update({
    where: { id: product.id },
    data,
    include: { category: SHOP_CATEGORY_BRIEF },
  });
  res.json({ success: true, data: serializeProduct(updated), message: 'پروڈکٹ اپ ڈیٹ ہو گئی' });
});

export const deleteMyProduct = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product || product.shopId !== shop.id) throw new ApiError(404, 'پروڈکٹ نہیں ملی');
  await prisma.product.delete({ where: { id: product.id } });
  res.json({ success: true, message: 'پروڈکٹ حذف ہو گئی' });
});

// ==================== SUPER-ADMIN ====================

// Creates the shopkeeper account + the shop together.
export const createShopSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  logo: z.string().optional().default(''),
  coverImage: z.string().optional().default(''),
  phone: z.string().optional().default(''),
  whatsapp: z.string().optional().default(''),
  address: z.string().optional().default(''),
  isActive: z.boolean().optional().default(true),
  isFeatured: z.boolean().optional().default(false),
  order: z.number().int().optional().default(0),
  // Owner credentials
  ownerName: z.string().min(1),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().min(6),
});

export const adminUpdateShopSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  logo: z.string().optional(),
  coverImage: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  address: z.string().optional(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  order: z.number().int().optional(),
});

// GET /api/admin/shops
export const adminListShops = asyncHandler(async (req, res) => {
  const shops = await prisma.shop.findMany({
    // Most products first so stocked shops surface above empty ones.
    orderBy: [{ products: { _count: 'desc' } }, { createdAt: 'desc' }],
    include: {
      owner: true,
      _count: { select: { products: true, orders: true } },
    },
  });
  res.json({ success: true, data: shops.map(serializeShop) });
});

// POST /api/admin/shops — create shopkeeper user + shop in one transaction
export const adminCreateShop = asyncHandler(async (req, res) => {
  const { ownerName, ownerEmail, ownerPassword, ...shopData } = req.body;
  const email = ownerEmail.toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new ApiError(400, 'یہ ای میل پہلے سے استعمال میں ہے');
  const slug = await uniqueSlug(prisma.shop, shopData.name);
  const passwordHash = await hashPassword(ownerPassword);

  const owner = await prisma.user.create({
    data: { name: ownerName, email, role: 'shopkeeper', passwordHash },
  });

  try {
    const shop = await prisma.shop.create({
      data: { ...shopData, slug, ownerId: owner.id },
      include: { owner: true, _count: { select: { products: true, orders: true } } },
    });
    if (shop.isFeatured) {
      await prisma.shop.updateMany({ where: { id: { not: shop.id } }, data: { isFeatured: false } });
    }
    res.status(201).json({ success: true, data: serializeShop(shop), message: 'دکان بن گئی' });
  } catch (err) {
    await prisma.user.delete({ where: { id: owner.id } }).catch(() => {});
    throw err;
  }
});

// PUT /api/admin/shops/:id
export const adminUpdateShop = asyncHandler(async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { id: req.params.id } });
  if (!shop) throw new ApiError(404, 'دکان نہیں ملی');
  const data = { ...req.body };
  if (data.name && data.name !== shop.name) {
    data.slug = await uniqueSlug(prisma.shop, data.name, shop.id);
  }
  // Only one shop can be featured on the home page at a time.
  if (data.isFeatured === true) {
    await prisma.shop.updateMany({ where: { id: { not: shop.id } }, data: { isFeatured: false } });
  }
  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data,
    include: { owner: true, _count: { select: { products: true, orders: true } } },
  });
  res.json({ success: true, data: serializeShop(updated), message: 'دکان اپ ڈیٹ ہو گئی' });
});

// PATCH /api/admin/shops/:id/status — activate / suspend
export const adminSetShopStatus = asyncHandler(async (req, res) => {
  const isActive = req.body?.isActive;
  if (typeof isActive !== 'boolean') throw new ApiError(400, 'Invalid status');
  const shop = await prisma.shop.findUnique({ where: { id: req.params.id } });
  if (!shop) throw new ApiError(404, 'دکان نہیں ملی');
  const updated = await prisma.shop.update({
    where: { id: shop.id },
    data: { isActive },
    include: { owner: true, _count: { select: { products: true, orders: true } } },
  });
  res.json({ success: true, data: serializeShop(updated), message: isActive ? 'دکان فعال' : 'دکان معطل' });
});

// DELETE /api/admin/shops/:id — removes shop (cascades categories/products) and its owner account
export const adminDeleteShop = asyncHandler(async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { id: req.params.id } });
  if (!shop) throw new ApiError(404, 'دکان نہیں ملی');
  const orderCount = await prisma.order.count({ where: { shopId: shop.id } });
  if (orderCount > 0) {
    throw new ApiError(400, `حذف نہیں ہو سکتا: اس دکان کے ${orderCount} آرڈرز موجود ہیں۔ پہلے دکان معطل کریں۔`);
  }
  await prisma.shop.delete({ where: { id: shop.id } });
  const others = await prisma.shop.count({ where: { ownerId: shop.ownerId } });
  if (others === 0) {
    await prisma.user.delete({ where: { id: shop.ownerId } });
  }
  res.json({ success: true, message: 'دکان حذف ہو گئی' });
});
