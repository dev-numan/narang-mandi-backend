import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const registerDeviceSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.string().max(20).optional().default('android'),
});

/**
 * POST /api/devices — register or refresh an FCM token.
 *
 * Called on every token refresh and again after login, so the same token can
 * arrive first anonymous and later owned. The upsert therefore always rewrites
 * `userId`: a device that logs in becomes a shopkeeper's, and a device that
 * logs out stops receiving that shopkeeper's orders.
 */
export const registerDevice = asyncHandler(async (req, res) => {
  const { token, platform } = req.body;
  const userId = req.user?.id ?? null;

  await prisma.deviceToken.upsert({
    where: { token },
    create: { token, platform, userId },
    update: { platform, userId },
  });

  res.status(204).end();
});
