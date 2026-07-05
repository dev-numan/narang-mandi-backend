import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { hashPassword } from '../lib/password.js';
import { serializeUser } from '../lib/serialize.js';

export const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['admin', 'editor']).optional().default('editor'),
  canManageCategories: z.boolean().optional().default(false),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['admin', 'editor']).optional(),
  password: z.string().min(6).optional(),
  canManageCategories: z.boolean().optional(),
});

export const listUsers = asyncHandler(async (req, res) => {
  const users = await prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ success: true, data: users.map(serializeUser) });
});

export const createUser = asyncHandler(async (req, res) => {
  const email = req.body.email.toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) throw new ApiError(400, 'Email already in use');
  const user = await prisma.user.create({
    data: {
      name: req.body.name,
      email,
      role: req.body.role,
      canManageCategories: req.body.role === 'admin' ? true : !!req.body.canManageCategories,
      passwordHash: await hashPassword(req.body.password),
    },
  });
  res.status(201).json({ success: true, data: serializeUser(user), message: 'User created' });
});

export const updateUser = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new ApiError(404, 'User not found');
  const data = {};
  if (req.body.name) data.name = req.body.name;
  if (req.body.role) data.role = req.body.role;
  if (req.body.password) data.passwordHash = await hashPassword(req.body.password);
  if (req.body.canManageCategories !== undefined) {
    data.canManageCategories = req.body.canManageCategories;
  }
  // Admins always implicitly have full category access.
  if (req.body.role === 'admin') data.canManageCategories = true;
  const updated = await prisma.user.update({ where: { id: user.id }, data });
  res.json({ success: true, data: serializeUser(updated), message: 'User updated' });
});

export const deleteUser = asyncHandler(async (req, res) => {
  if (req.user.id === req.params.id) {
    throw new ApiError(400, 'You cannot delete your own account');
  }
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) throw new ApiError(404, 'User not found');
  await prisma.user.delete({ where: { id: user.id } });
  res.json({ success: true, message: 'User deleted' });
});
