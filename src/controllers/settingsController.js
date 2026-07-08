import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { serializeSettings } from '../lib/serialize.js';

export const settingsSchema = z.object({
  siteName: z.string().optional(),
  logo: z.string().optional(),
  tagline: z.string().optional(),
  socialLinks: z
    .object({
      facebook: z.string().optional(),
      youtube: z.string().optional(),
      twitter: z.string().optional(),
      whatsapp: z.string().optional(),
    })
    .optional(),
  contactEmail: z.string().optional(),
  breakingTicker: z.array(z.string()).optional(),
});

// Single settings row keyed by "site".
const WHATSAPP_URL = 'https://wa.me/923069761224';

async function getSingleton() {
  let settings = await prisma.settings.upsert({
    where: { key: 'site' },
    update: {},
    create: { key: 'site', siteName: 'Narang Mandi' },
  });
  const updates = {};
  if (settings.siteName !== 'Narang Mandi') updates.siteName = 'Narang Mandi';
  const links = settings.socialLinks || {};
  if (!links.whatsapp || links.whatsapp.includes('0000000000')) {
    updates.socialLinks = { ...links, whatsapp: WHATSAPP_URL };
  }
  if (Object.keys(updates).length > 0) {
    settings = await prisma.settings.update({
      where: { key: 'site' },
      data: updates,
    });
  }
  return settings;
}

export const getSettings = asyncHandler(async (req, res) => {
  const settings = await getSingleton();
  res.json({ success: true, data: serializeSettings(settings) });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const current = await getSingleton();
  let data = { ...req.body };
  // Editors may only manage the website's social media links. Strip everything
  // else so they can't change site name, logo, contact email, ticker, etc.
  if (req.user.role !== 'admin') {
    data = data.socialLinks ? { socialLinks: data.socialLinks } : {};
  }
  if (data.socialLinks) {
    data.socialLinks = { ...(current.socialLinks || {}), ...data.socialLinks };
  }
  // Brand name is fixed; ignore any custom value from the admin form.
  if (req.user.role === 'admin') {
    data.siteName = 'Narang Mandi';
  }
  const updated = await prisma.settings.update({ where: { key: 'site' }, data });
  res.json({ success: true, data: serializeSettings(updated), message: 'Settings updated' });
});
