/**
 * Create shopkeeper accounts for pending shop form registrations,
 * then write credentials + WhatsApp welcome links.
 *
 * Rules:
 * - One account per unique phone that does not yet own a shop.
 * - If the same phone registered again later with a clearly different
 *   business name, create an additional shop account.
 * - Exact duplicate form submits (same phone + same business) are skipped.
 *
 * Usage: node src/scripts/provision-pending-shops.js
 */
import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password.js';
import { uniqueSlug } from '../utils/slugify.js';
import { normalizePhone } from '../utils/phone.js';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const CUTOFF = new Date('2026-07-29T05:46:27.000Z'); // last row in registrations.xlsx

const WELCOME_TEMPLATE = (email, password) =>
  `السلام علیکم!

نارنگ منڈی ڈیجیٹل ہب میں آپ کو خوش آمدید۔

آپ کی آن لائن دکان کامیابی کے ساتھ تیار کر دی گئی ہے۔

ای میل:
${email}

پاس ورڈ:
${password}

شاپ ایڈمن پینل:
https://narangmandi.com/shop/admin

ہدایات:

اوپر دیئے گئے لنک پر کلک کریں۔
اپنے ای میل اور پاس ورڈ کے ذریعے لاگ اِن کریں۔
ایڈمن پینل سے آپ اپنی آن لائن دکان میں  کیٹیگریز(Categories) اور مصنوعات (Products) بآسانی شامل کر سکتے ہیں۔

اگر آپ کو کسی بھی قسم کی دشواری پیش آئے تو اسی واٹس ایپ نمبر پر ہمیں پیغام یا وائس نوٹ بھیج دیں۔ ہماری ٹیم آپ کی مدد کے لیے حاضر ہے۔

شکریہ!
نارنگ منڈی ڈیجیٹل ہب`;

const normPhone = (p) => normalizePhone(p);

function displayPhone(p) {
  const n = normPhone(p);
  if (!n) return '';
  return n.length === 10 ? `0${n}` : n;
}

function waPhone(p) {
  const n = normPhone(p);
  if (!n) return '';
  return n.length === 10 ? `92${n}` : n;
}

function genPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = 'Nm';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function asciiLocal(name) {
  const s = String(name || '')
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  // prefer first token if length >= 3, else join
  if (parts[0].length >= 3) return parts[0];
  return parts.join('').slice(0, 16) || null;
}

function shopNameFromReg(r) {
  const biz = String(r.businessName || '').trim();
  if (biz && !/^(no|n\/a|none|-)$/i.test(biz)) return biz;
  const name = String(r.name || '').trim();
  if (name) return name;
  return `Shop ${displayPhone(r.contact)}`;
}

function sameBiz(a, b) {
  const n = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  const x = n(a);
  const y = n(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

async function nextEmail(base, used) {
  let local = base || 'shop';
  local = local.replace(/[^a-z0-9]/g, '').slice(0, 24) || 'shop';
  let candidate = `${local}@narangmandi.com`;
  let i = 2;
  while (used.has(candidate) || (await prisma.user.findUnique({ where: { email: candidate } }))) {
    candidate = `${local}${i}@narangmandi.com`;
    i += 1;
  }
  used.add(candidate);
  return candidate;
}

function pickCandidates(regs, shops) {
  const shopByPhone = new Map();
  for (const s of shops) {
    const p = normPhone(s.phone || s.owner?.phone);
    if (!p) continue;
    if (!shopByPhone.has(p)) shopByPhone.set(p, []);
    shopByPhone.get(p).push(s);
  }

  // Only consider regs after the previous export cutoff
  const after = regs.filter((r) => new Date(r.createdAt) > CUTOFF);

  // Group by phone, chronological
  const byPhone = new Map();
  for (const r of after) {
    const p = normPhone(r.contact);
    if (!p || p.length < 10) continue;
    if (!byPhone.has(p)) byPhone.set(p, []);
    byPhone.get(p).push(r);
  }

  const toCreate = [];

  for (const [phone, list] of byPhone) {
    // Deduplicate exact same business submits — keep first of each biz cluster
    const uniqueRegs = [];
    for (const r of list) {
      const biz = shopNameFromReg(r);
      const dup = uniqueRegs.find((u) => sameBiz(shopNameFromReg(u), biz));
      if (!dup) uniqueRegs.push(r);
    }

    const existing = shopByPhone.get(phone) || [];

    if (existing.length === 0) {
      // No shop yet → create for first unique business (and any later different biz)
      for (const r of uniqueRegs) {
        toCreate.push(r);
      }
    } else {
      // Phone already has shop(s) → only create if a later reg has a different business name
      for (const r of uniqueRegs) {
        const biz = shopNameFromReg(r);
        const matchesExisting = existing.some((s) => sameBiz(s.name, biz));
        if (!matchesExisting) toCreate.push(r);
      }
    }
  }

  // Stable order by createdAt
  toCreate.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  return toCreate;
}

async function main() {
  const [regs, shops, users] = await Promise.all([
    prisma.registration.findMany({
      where: { type: 'shop' },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.shop.findMany({
      select: {
        name: true,
        phone: true,
        owner: { select: { phone: true, email: true } },
      },
    }),
    prisma.user.findMany({
      where: { email: { endsWith: '@narangmandi.com' } },
      select: { email: true },
    }),
  ]);

  const usedEmails = new Set(users.map((u) => u.email.toLowerCase()));
  const candidates = pickCandidates(regs, shops);

  if (!candidates.length) {
    console.log('No pending shop registrations to provision.');
    return;
  }

  console.log(`Provisioning ${candidates.length} shop account(s)...\n`);

  const created = [];

  for (const r of candidates) {
    const ownerName = String(r.name || '').trim() || shopNameFromReg(r);
    const shopName = shopNameFromReg(r);
    const phone = displayPhone(r.contact);
    const password = genPassword();
    const local = asciiLocal(ownerName) || asciiLocal(shopName) || 'shop';
    const email = await nextEmail(local, usedEmails);
    const passwordHash = await hashPassword(password);
    const slug = await uniqueSlug(prisma.shop, shopName);

    const owner = await prisma.user.create({
      data: {
        name: ownerName,
        email,
        role: 'shopkeeper',
        passwordHash,
        phone,
      },
    });

    try {
      const shop = await prisma.shop.create({
        data: {
          name: shopName,
          slug,
          phone,
          whatsapp: phone,
          address: 'نارنگ منڈی',
          logo: r.image || '',
          ownerId: owner.id,
          isActive: true,
        },
      });
      const waText = WELCOME_TEMPLATE(email, password);
      const waLink = `https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(waText)}`;
      created.push({
        name: ownerName,
        phone,
        shopName,
        email,
        password,
        image: r.image || '',
        status: 'created',
        date: r.createdAt.toISOString().replace('T', ' ').slice(0, 19),
        registrationId: r.id,
        shopId: shop.id,
        waLink,
      });
      console.log(`✓ ${shopName} → ${email} / ${password} (${phone})`);
    } catch (err) {
      await prisma.user.delete({ where: { id: owner.id } }).catch(() => {});
      console.error(`✗ Failed ${shopName}:`, err.message);
    }
  }

  // Write outputs
  const outJson = path.join(ROOT, 'registrations-new-batch.json');
  fs.writeFileSync(outJson, JSON.stringify(created, null, 2), 'utf8');

  const waMd = path.join(ROOT, 'whatsapp-links-new.md');
  const lines = [
    '# WhatsApp Welcome Links — New Shopkeepers',
    '',
    `Generated: ${new Date().toISOString().slice(0, 10)}`,
    `Total: ${created.length}`,
    '',
    'Click a link to open WhatsApp with the welcome message pre-filled (email + password included).',
    '',
    '---',
    '',
  ];
  created.forEach((c, i) => {
    lines.push(`${i + 1}. **${c.name}** (${c.phone}) — [${c.shopName}](${c.waLink})`);
  });
  lines.push('');
  fs.writeFileSync(waMd, lines.join('\n'), 'utf8');

  // CSV for easy Excel append
  const csvPath = path.join(ROOT, 'registrations-new-batch.csv');
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csvRows = [
    ['Name', 'Category', 'Phone', 'Shop Name', 'Email', 'Password', 'Image', 'Image URL', 'Status', 'Date', 'WhatsApp Link']
      .map(esc)
      .join(','),
    ...created.map((c) =>
      [
        c.name,
        'Shop',
        c.phone,
        c.shopName,
        c.email,
        c.password,
        c.image ? 'yes' : '—',
        c.image,
        c.status,
        c.date,
        c.waLink,
      ]
        .map(esc)
        .join(','),
    ),
  ];
  fs.writeFileSync(csvPath, csvRows.join('\n') + '\n', 'utf8');

  console.log(`\nDone. Created ${created.length} accounts.`);
  console.log(`- ${outJson}`);
  console.log(`- ${waMd}`);
  console.log(`- ${csvPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
