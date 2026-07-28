import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { comparePassword, hashPassword } from '../lib/password.js';
import { serializeUser } from '../lib/serialize.js';
import { signAccessToken } from '../utils/jwt.js';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Access token lifetime — kept in sync with JWT_EXPIRES_IN (10 days).
const ACCESS_MAX_AGE = 10 * 24 * 60 * 60 * 1000;

const cookieOpts = (maxAgeMs) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  maxAge: maxAgeMs,
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await comparePassword(password, user.passwordHash))) {
    throw new ApiError(401, 'Invalid email or password');
  }

  const accessToken = signAccessToken(user);

  res
    .cookie('accessToken', accessToken, cookieOpts(ACCESS_MAX_AGE))
    .json({
      success: true,
      message: 'Logged in',
      data: { user: serializeUser(user), accessToken },
    });
});

export const logout = asyncHandler(async (req, res) => {
  res.clearCookie('accessToken').json({ success: true, message: 'Logged out' });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: serializeUser(req.user) });
});

// Self-service profile update. Any logged-in user may edit their own
// display name, avatar and the optional public contact info (phone / email)
// that is shown alongside their articles. Email/role/password are not editable here.
export const updateMeSchema = z.object({
  name: z.string().min(1).optional(),
  avatar: z.string().optional(),
  phone: z.string().max(40).optional(),
  contactEmail: z.union([z.string().email(), z.literal('')]).optional(),
});

export const updateMe = asyncHandler(async (req, res) => {
  const data = {};
  for (const key of ['name', 'avatar', 'phone', 'contactEmail']) {
    if (req.body[key] !== undefined) data[key] = req.body[key];
  }
  // Editors may not change their own display name — only an admin can.
  if (req.user.role !== 'admin') delete data.name;
  const updated = await prisma.user.update({ where: { id: req.user.id }, data });
  res.json({ success: true, data: serializeUser(updated), message: 'Profile updated' });
});

// Self-service password change — requires current password + matching confirmation.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(6, 'New password must be at least 6 characters'),
    confirmPassword: z.string().min(1, 'Please confirm the new password'),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'New password and confirmation do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'New password must be different from the current password',
    path: ['newPassword'],
  });

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new ApiError(404, 'User not found');

  if (!(await comparePassword(currentPassword, user.passwordHash))) {
    throw new ApiError(400, 'موجودہ پاس ورڈ غلط ہے');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword) },
  });

  res.json({ success: true, message: 'پاس ورڈ کامیابی سے تبدیل ہو گیا' });
});
