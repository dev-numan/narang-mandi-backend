import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  message: z.string().trim().min(10).max(4000),
});

// Public: store a visitor's message. No email service is configured, so the
// message lands in Postgres and the admin reads it at /admin/messages.
export const createContactMessage = asyncHandler(async (req, res) => {
  const { name, email, message } = req.body;
  await prisma.contactMessage.create({
    data: { name, email, message, ip: req.ip || '' },
  });
  res.status(201).json({ success: true, message: 'Message received' });
});

// Admin: list messages, newest first.
export const listContactMessages = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const [items, total, unread] = await Promise.all([
    prisma.contactMessage.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contactMessage.count(),
    prisma.contactMessage.count({ where: { isRead: false } }),
  ]);
  res.json({
    success: true,
    data: items.map((m) => ({ ...m, _id: m.id })),
    page,
    total,
    unread,
    totalPages: Math.ceil(total / limit),
  });
});

export const markContactMessageRead = asyncHandler(async (req, res) => {
  const updated = await prisma.contactMessage.update({
    where: { id: req.params.id },
    data: { isRead: true },
  });
  res.json({ success: true, data: { ...updated, _id: updated.id } });
});

export const deleteContactMessage = asyncHandler(async (req, res) => {
  await prisma.contactMessage.delete({ where: { id: req.params.id } });
  res.json({ success: true, message: 'Message deleted' });
});
