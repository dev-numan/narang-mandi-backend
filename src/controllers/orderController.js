import { z } from 'zod';
import prisma, { runTransaction } from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { serializeOrder, SHOP_BRIEF } from '../lib/serialize.js';

async function generateOrderNumber() {
  for (let attempt = 0; attempt < 25; attempt++) {
    const orderNumber = String(Math.floor(10000000 + Math.random() * 90000000));
    const exists = await prisma.order.findUnique({ where: { orderNumber } });
    if (!exists) return orderNumber;
  }
  throw new ApiError(500, 'Could not generate order number');
}

// Compare phones regardless of +92 / 0 prefix formatting.
function normalizePhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

async function getOwnerShop(req) {
  const shop = await prisma.shop.findFirst({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: 'asc' },
  });
  if (!shop) throw new ApiError(404, 'آپ کے ساتھ کوئی دکان منسلک نہیں ہے');
  return shop;
}

// ==================== PUBLIC ====================

export const placeOrderSchema = z.object({
  customerName: z.string().min(1).max(80),
  customerPhone: z.string().min(7).max(40),
  address: z.string().min(1).max(400),
  note: z.string().max(1000).optional().default(''),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1),
});

// POST /api/shops/:slug/orders — guest checkout for a single shop
export const placeOrder = asyncHandler(async (req, res) => {
  const shop = await prisma.shop.findUnique({ where: { slug: req.params.slug } });
  if (!shop || !shop.isActive) throw new ApiError(404, 'دکان نہیں ملی');

  const { customerName, customerPhone, address, note, items } = req.body;
  const orderNumber = await generateOrderNumber();

  const productIds = items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  const lineItems = [];
  let total = 0;
  for (const { productId, quantity } of items) {
    const product = byId[productId];
    if (!product || product.shopId !== shop.id || !product.isActive) {
      throw new ApiError(400, 'کچھ پروڈکٹس دستیاب نہیں ہیں');
    }
    if (quantity > product.stock) {
      throw new ApiError(400, `"${product.name}" کے لیے ناکافی اسٹاک (دستیاب: ${product.stock})`);
    }
    const lineTotal = product.price * quantity;
    total += lineTotal;
    lineItems.push({
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal,
    });
  }

  const order = await runTransaction(async (tx) => {
    for (const { productId, quantity } of items) {
      const updated = await tx.product.updateMany({
        where: {
          id: productId,
          shopId: shop.id,
          isActive: true,
          stock: { gte: quantity },
        },
        data: { stock: { decrement: quantity } },
      });
      if (updated.count !== 1) {
        throw new ApiError(400, 'کچھ پروڈکٹس دستیاب نہیں ہیں');
      }
    }

    return tx.order.create({
      data: {
        orderNumber,
        shopId: shop.id,
        customerName,
        customerPhone,
        address,
        note,
        total,
        items: { create: lineItems },
      },
      include: { items: true, shop: SHOP_BRIEF },
    });
  });

  res.status(201).json({
    success: true,
    data: serializeOrder(order),
    message: `شکریہ! آپ کا آرڈر موصول ہو گیا ہے۔ آرڈر نمبر: ${order.orderNumber}`,
  });
});

export const lookupOrderSchema = z.object({
  orderNumber: z.string().regex(/^\d{6,8}$/, 'Valid order number required'),
  phone: z.string().min(7).max(40),
});

// POST /api/shops/orders/lookup — track an order by number + phone
export const lookupOrder = asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { orderNumber: req.body.orderNumber },
    include: { items: true, shop: SHOP_BRIEF },
  });
  const invalidMsg = 'غلط آرڈر نمبر یا فون نمبر';
  if (!order) throw new ApiError(404, invalidMsg);
  if (normalizePhone(order.customerPhone) !== normalizePhone(req.body.phone)) {
    throw new ApiError(404, invalidMsg);
  }
  res.json({ success: true, data: serializeOrder(order) });
});

// ==================== SHOPKEEPER (owner-scoped) ====================

// GET /api/shop-admin/orders — optional ?status=
export const listMyOrders = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const where = { shopId: shop.id };
  if (req.query.status) where.status = req.query.status;
  const orders = await prisma.order.findMany({
    where,
    include: { items: true },
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json({ success: true, data: orders.map(serializeOrder) });
});

// GET /api/shop-admin/orders/:id
export const getMyOrder = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!order || order.shopId !== shop.id) throw new ApiError(404, 'آرڈر نہیں ملا');
  res.json({ success: true, data: serializeOrder(order) });
});

// PATCH /api/shop-admin/orders/:id/status
export const setOrderStatus = asyncHandler(async (req, res) => {
  const status = req.body?.status;
  if (!['pending', 'processing', 'fulfilled', 'cancelled'].includes(status)) {
    throw new ApiError(400, 'Invalid status');
  }
  const shop = await getOwnerShop(req);
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order || order.shopId !== shop.id) throw new ApiError(404, 'آرڈر نہیں ملا');
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status },
    include: { items: true },
  });
  res.json({ success: true, data: serializeOrder(updated), message: 'آرڈر اپ ڈیٹ ہو گیا' });
});

// GET /api/shop-admin/stats
export const shopStats = asyncHandler(async (req, res) => {
  const shop = await getOwnerShop(req);
  const [statusGroups, productCount, lowStock, revenue] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      where: { shopId: shop.id },
      _count: { _all: true },
    }),
    prisma.product.count({ where: { shopId: shop.id } }),
    prisma.product.count({ where: { shopId: shop.id, stock: { lte: 3 } } }),
    prisma.order.aggregate({
      where: { shopId: shop.id, status: 'fulfilled' },
      _sum: { total: true },
    }),
  ]);
  const byStatus = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));
  const totalOrders = statusGroups.reduce((sum, g) => sum + g._count._all, 0);
  res.json({
    success: true,
    data: {
      totalOrders,
      pending: byStatus.pending || 0,
      processing: byStatus.processing || 0,
      fulfilled: byStatus.fulfilled || 0,
      cancelled: byStatus.cancelled || 0,
      productCount,
      lowStock,
      revenue: revenue._sum.total || 0,
    },
  });
});
