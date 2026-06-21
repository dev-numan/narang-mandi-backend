import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { comparePassword } from '../lib/password.js';
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
