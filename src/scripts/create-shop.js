/**
 * Creates one shopkeeper account from a single registration.
 *
 * The bulk path is `provision-pending-shops.js`, which sweeps every shop
 * registration since a fixed cutoff. That is the wrong tool when one shopkeeper
 * has walked in and needs their login today: it would create ten accounts and
 * ten sets of credentials nobody is ready to send.
 *
 * Same conventions as the bulk script — `@narangmandi.com` email derived from
 * the owner's name, a generated password, and a click-to-send WhatsApp welcome
 * link — so the two cannot drift.
 *
 *   node src/scripts/create-shop.js --phone 03073216263
 *   node src/scripts/create-shop.js --phone 03073216263 --apply
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password.js';
import { uniqueSlug } from '../utils/slugify.js';
import { normalizePhone } from '../utils/phone.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const DOMAIN = 'narangmandi.com';
const PANEL_URL = `${process.env.PUBLIC_SITE_URL || 'https://www.narangmandi.com'}/shop/admin`;
const GUIDE_URL = `${process.env.PUBLIC_SITE_URL || 'https://www.narangmandi.com'}/shop/guide`;
const APP_URL = 'https://play.google.com/store/apps/details?id=com.narangmandi';

const WELCOME_TEMPLATE = (email, password) => `السلام علیکم!

نارنگ منڈی ڈیجیٹل ہب میں آپ کو خوش آمدید۔ آپ کی آن لائن دکان تیار ہو گئی ہے۔

ای میل:
${email}

پاس ورڈ:
${password}

شاپ ایڈمن پینل:
${PANEL_URL}

موبائل ایپ ڈاؤن لوڈ کریں:
${APP_URL}

تصویروں کے ساتھ مکمل گائیڈ:
${GUIDE_URL}

ہدایات:

1۔ اوپر دیئے گئے لنک پر کلک کریں اور اپنے ای میل اور پاس ورڈ سے لاگ اِن کریں۔
2۔ پہلے اپنے سامان کی کیٹیگریز بنائیں، جیسے بلب، تار، پنکھے۔
3۔ پھر مصنوعات شامل کریں — نام، قیمت اور تصویر کے ساتھ۔
4۔ گاہک آرڈر کرے گا تو آپ کو اطلاع مل جائے گی۔
5۔ سامان پہنچانے کے بعد آرڈر کو مکمل (fulfilled) کر دیں۔

نوٹ: ادائیگی ڈیلیوری کے وقت نقد ہوتی ہے۔

مزید معلومات کے لیے اسی پیغام کا جواب دیں۔ ہماری ٹیم آپ کی مدد کے لیے حاضر ہے۔

شکریہ!
نارنگ منڈی ڈیجیٹل ہب`;

function arg(flag) {
  const i = process.argv.indexOf(`--${flag}`);
  return i === -1 ? '' : String(process.argv[i + 1] || '').trim();
}

/// 2–9 only: 0/1 are misread as O/l when a password is read out loud.
function digits(n) {
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += String((bytes[i] % 8) + 2);
  return out;
}

/// Honorifics carry no identifying information — half the town would be `muhammad`.
const PREFIXES = new Set(['the', 'muhammad', 'mohammad', 'md', 'mr', 'rana', 'mian', 'ch', 'chaudhry']);

function asciiLocal(name) {
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return (tokens.filter((t) => !PREFIXES.has(t))[0] || tokens[0] || '').slice(0, 16);
}

const displayPhone = (p) => {
  const n = normalizePhone(p);
  return n && n.length === 10 ? `0${n}` : n;
};

/// wa.me wants E.164 without the +; shopkeepers write 03xxxxxxxxx.
const waPhone = (p) => {
  const n = normalizePhone(p);
  return n && n.length === 10 ? `92${n}` : n;
};

async function main() {
  const phoneArg = arg('phone');
  if (!phoneArg) {
    console.error('Usage: --phone 03073216263 [--apply]');
    process.exit(1);
  }
  const key = normalizePhone(phoneArg);

  const reg = (
    await prisma.registration.findMany({
      where: { type: 'shop' },
      orderBy: { createdAt: 'desc' },
    })
  ).find((r) => normalizePhone(r.contact) === key);

  if (!reg) {
    console.error(`No shop registration found for ${phoneArg}.`);
    process.exit(1);
  }

  const shopName = String(reg.businessName || reg.name || '').trim();

  // One person may run two businesses off one number, so a repeat phone is not
  // by itself an error — the bulk script makes the same distinction. Only an
  // exact repeat of the same business name is a duplicate form submit.
  const existing = await prisma.shop.findMany({
    select: { name: true, phone: true, owner: { select: { phone: true, email: true } } },
  });
  const sameNumber = existing.filter(
    (s) => normalizePhone(s.phone) === key || normalizePhone(s.owner?.phone) === key
  );
  const duplicate = sameNumber.find(
    (s) => s.name.trim().toLowerCase() === shopName.toLowerCase()
  );
  if (duplicate) {
    console.error(`"${shopName}" already exists on this number (${duplicate.owner?.email}).`);
    process.exit(1);
  }
  for (const s of sameNumber) {
    console.log(`note:     this number already owns "${s.name}" (${s.owner?.email}) — left untouched`);
  }

  const ownerName = String(reg.name || '').trim() || shopName;
  const phone = displayPhone(reg.contact);
  const base = asciiLocal(ownerName) || asciiLocal(shopName) || 'shop';

  let local = base;
  for (let n = 2; await prisma.user.findUnique({ where: { email: `${local}@${DOMAIN}` } }); n++) {
    local = `${base}${n}`;
  }
  const email = `${local}@${DOMAIN}`;
  const password = `${base}${digits(4)}`;
  const slug = await uniqueSlug(prisma.shop, shopName);

  console.log(`shop:     ${shopName}`);
  console.log(`owner:    ${ownerName}`);
  console.log(`phone:    ${phone}`);
  console.log(`slug:     ${slug}`);
  console.log(`email:    ${email}`);
  console.log(`password: ${password}`);
  console.log(`logo:     ${reg.image ? 'yes' : '—'}`);

  if (!APPLY) {
    console.log('\nDRY RUN — pass --apply to create.');
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: { name: ownerName, email, role: 'shopkeeper', passwordHash, phone },
    });
    await tx.shop.create({
      data: {
        name: shopName,
        slug,
        phone,
        whatsapp: phone,
        address: 'نارنگ منڈی',
        logo: reg.image || '',
        ownerId: owner.id,
        isActive: true,
      },
    });
  });

  const message = WELCOME_TEMPLATE(email, password);
  const waLink = `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(message)}`;

  // Appended, not overwritten: this file is the only record of credentials
  // already sent to other shopkeepers.
  const out = path.resolve(process.cwd(), '..', 'shop-accounts.json');
  const current = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { shops: [] };
  const shops = Array.isArray(current) ? current : current.shops || [];
  shops.push({ shopName, ownerName, phone, email, password, slug, waLink });
  fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), shops }, null, 2));

  console.log(`\nCreated. Credentials appended to ${out}`);
  console.log(`\nWhatsApp link:\n${waLink}`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
