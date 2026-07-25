import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// Shop-online / driver lead-capture from the home-page banners.
export const registrationSchema = z.object({
  type: z.enum(['driver', 'shop']),
  name: z.string().trim().min(2).max(80),
  contact: z.string().trim().min(6).max(40),
  businessName: z.string().trim().max(120).optional().default(''),
  hasLicense: z.boolean().optional().default(false),
  image: z.string().trim().max(600).optional().default(''),
});

// Public: store a registration lead. Read by the admin at /admin/registrations.
export const createRegistration = asyncHandler(async (req, res) => {
  const { type, name, contact, businessName, hasLicense, image } = req.body;
  await prisma.registration.create({
    data: {
      type,
      name,
      contact,
      businessName: businessName || '',
      // A driving licence only makes sense for drivers.
      hasLicense: type === 'driver' ? !!hasLicense : false,
      image: image || '',
      ip: req.ip || '',
    },
  });
  res.status(201).json({ success: true, message: 'Registration received' });
});

// Admin: list registrations, newest first. Optional ?type=driver|shop filter.
export const listRegistrations = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const type = ['driver', 'shop'].includes(req.query.type) ? req.query.type : undefined;
  const where = type ? { type } : {};
  const [items, total, unread] = await Promise.all([
    prisma.registration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.registration.count({ where }),
    prisma.registration.count({ where: { ...where, isRead: false } }),
  ]);
  res.json({
    success: true,
    data: items.map((r) => ({ ...r, _id: r.id })),
    page,
    total,
    unread,
    totalPages: Math.ceil(total / limit),
  });
});

export const markRegistrationRead = asyncHandler(async (req, res) => {
  const updated = await prisma.registration.update({
    where: { id: req.params.id },
    data: { isRead: true },
  });
  res.json({ success: true, data: { ...updated, _id: updated.id } });
});

export const deleteRegistration = asyncHandler(async (req, res) => {
  await prisma.registration.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Registration deleted' });
});
