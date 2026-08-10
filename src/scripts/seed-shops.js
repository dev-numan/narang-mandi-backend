import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { uniqueSlug } from '../utils/slugify.js';
import { hashPassword } from '../lib/password.js';

// A sample shop + shopkeeper + categories + products so the Dukanen feature is
// browsable right after a fresh setup. The admin creates real shops from /admin.
const SHOPKEEPER = {
  name: 'محمد علی',
  email: process.env.SEED_SHOP_EMAIL || 'shop@narangmandi.com',
  password: process.env.SEED_SHOP_PASSWORD || 'shop12345',
};

const SHOP = {
  name: 'علی جنرل اسٹور',
  description: 'روزمرہ کی ضروریات، کریانہ اور بہت کچھ',
  phone: '03001234567',
  whatsapp: '03001234567',
  address: 'مین بازار، نارنگ منڈی',
};

const CATEGORIES = [
  { name: 'کریانہ', nameEn: 'Grocery', order: 1 },
  { name: 'مشروبات', nameEn: 'Beverages', order: 2 },
  { name: 'بیکری', nameEn: 'Bakery', order: 3 },
];

const PRODUCTS = [
  { name: 'چاول (5 کلو)', price: 1200, cat: 'کریانہ' },
  { name: 'چینی (1 کلو)', price: 160, cat: 'کریانہ' },
  { name: 'کوکا کولا (1.5 لیٹر)', price: 150, cat: 'مشروبات' },
  { name: 'ڈبل روٹی', price: 130, cat: 'بیکری' },
];

async function run() {
  console.log('[seed-shops] creating sample shopkeeper + shop...');

  const email = SHOPKEEPER.email.toLowerCase();
  let owner = await prisma.user.findUnique({ where: { email } });
  if (owner) {
    // Refresh so re-running the seed is idempotent.
    await prisma.shop.deleteMany({ where: { ownerId: owner.id } });
    owner = await prisma.user.update({
      where: { id: owner.id },
      data: { name: SHOPKEEPER.name, role: 'shopkeeper', passwordHash: await hashPassword(SHOPKEEPER.password) },
    });
  } else {
    owner = await prisma.user.create({
      data: {
        name: SHOPKEEPER.name,
        email,
        role: 'shopkeeper',
        passwordHash: await hashPassword(SHOPKEEPER.password),
      },
    });
  }

  const shopSlug = await uniqueSlug(prisma.shop, SHOP.name);
  const shop = await prisma.shop.create({ data: { ...SHOP, slug: shopSlug, ownerId: owner.id } });

  const catByName = {};
  for (const c of CATEGORIES) {
    const slug = await uniqueSlug(prisma.shopCategory, c.name + '-' + shop.id.slice(0, 4));
    const created = await prisma.shopCategory.create({ data: { ...c, slug, shopId: shop.id } });
    catByName[c.name] = created.id;
  }

  for (const p of PRODUCTS) {
    const slug = await uniqueSlug(prisma.product, p.name + '-' + shop.id.slice(0, 4));
    await prisma.product.create({
      data: {
        name: p.name,
        slug,
        price: p.price,
        shopId: shop.id,
        categoryId: catByName[p.cat] || null,
      },
    });
  }

  console.log(`[seed-shops] shop "${shop.name}" with ${CATEGORIES.length} categories & ${PRODUCTS.length} products ✓`);
  console.log(`[seed-shops] shopkeeper login → ${email} / ${SHOPKEEPER.password}`);
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seed-shops] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
