import slugifyLib from 'slugify';
import { randomBytes } from 'crypto';

// A short, URL-safe, ASCII slug (e.g. "a1b2c3d4"). Used for article links so the
// URL never depends on the (long, URL-encoded) Urdu title.
export function shortId(len = 8) {
  return Array.from(randomBytes(len), (b) => (b % 36).toString(36)).join('');
}

// Generate a short slug that is unique against a Prisma delegate.
export async function uniqueShortSlug(delegate, len = 8) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const candidate = shortId(len);
    const exists = await delegate.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!exists) return candidate;
  }
}

// Urdu titles often contain no latin chars; slugify would yield "". In that
// case we fall back to a transliteration-free unique-ish slug.
export function makeSlug(input) {
  const base = slugifyLib(String(input || ''), {
    lower: true,
    strict: true,
    locale: 'ur',
    trim: true,
  });
  if (base) return base;
  // Fallback: keep urdu/word chars, replace spaces with dashes.
  const fallback = String(input || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .toLowerCase();
  return fallback || 'post';
}

// Ensure uniqueness against a Prisma delegate (excluding an optional id).
// `delegate` is e.g. prisma.article or prisma.category.
export async function uniqueSlug(delegate, desired, excludeId = null) {
  const slug = makeSlug(desired);
  let candidate = slug;
  let i = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where = { slug: candidate };
    if (excludeId) where.id = { not: excludeId };
    const exists = await delegate.findFirst({ where, select: { id: true } });
    if (!exists) return candidate;
    candidate = `${slug}-${i++}`;
  }
}
