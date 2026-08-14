import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';

// Google Play reviewers need working logins for every gated panel, and they
// cannot create accounts or contact us for help. These three are deliberately
// scoped to one role each rather than reusing an admin login: admin passes all
// three gates but would also hand an outside reviewer user deletion and
// impersonation on the live database.
//
// Passwords are fixed rather than generated because Play reuses these details
// on every future update review — a rotating credential would silently break
// the next submission.
const REVIEWERS = [
  {
    key: 'shop',
    name: 'Play Review Shopkeeper',
    email: 'reviewer.shop@narangmandi.com',
    password: 'PlayReview!Shop2026',
    role: 'shopkeeper',
  },
  {
    key: 'editor',
    name: 'Play Review Editor',
    email: 'reviewer.editor@narangmandi.com',
    password: 'PlayReview!Edit2026',
    role: 'editor',
  },
  {
    key: 'driver',
    name: 'Play Review Driver',
    email: 'reviewer.driver@narangmandi.com',
    password: 'PlayReview!Ride2026',
    role: 'driver',
  },
];

const DEMO_PRODUCTS = [
  { name: 'چاول باسمتی — ۵ کلو', slug: 'play-demo-basmati-rice', price: 2500, stock: 40 },
  { name: 'چینی — ۱ کلو', slug: 'play-demo-sugar', price: 180, stock: 100 },
  { name: 'کوکنگ آئل — ۱ لیٹر', slug: 'play-demo-cooking-oil', price: 650, stock: 60 },
];

async function upsertReviewer({ name, email, password, role }) {
  const passwordHash = await hashPassword(password);
  // Update the hash on re-run so a rerun always restores the documented
  // password, even if someone changed it in the panel.
  return prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: { name, email, role, passwordHash },
  });
}

async function main() {
  const users = {};
  for (const r of REVIEWERS) {
    users[r.key] = await upsertReviewer(r);
    console.log(`user  ${r.email.padEnd(34)} role=${r.role}`);
  }

  // Without a shop the shop-admin panel 404s ("آپ کے ساتھ کوئی دکان منسلک نہیں
  // ہے"), which reads as a broken app to a reviewer.
  //
  // isActive stays false on purpose. The public marketplace filters on
  // `isActive: true`, so real customers never see this demo store or order
  // groceries that nobody will deliver; the owner panel looks the shop up by
  // ownerId with no isActive filter, so the reviewer still gets a fully
  // working panel.
  const shop = await prisma.shop.upsert({
    where: { slug: 'play-demo-store' },
    update: { ownerId: users.shop.id, isActive: false },
    create: {
      name: 'ڈیمو اسٹور',
      slug: 'play-demo-store',
      description: 'Demo shop used for Google Play review access.',
      phone: '+923001234567',
      address: 'Narang Mandi',
      ownerId: users.shop.id,
      isActive: false,
    },
  });
  console.log(`shop  ${shop.slug} -> ${shop.id}`);

  const category = await prisma.shopCategory.upsert({
    where: { slug: 'play-demo-grocery' },
    update: { shopId: shop.id },
    create: { shopId: shop.id, name: 'گروسری', nameEn: 'Grocery', slug: 'play-demo-grocery' },
  });

  for (const p of DEMO_PRODUCTS) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      update: { shopId: shop.id, categoryId: category.id, price: p.price, stock: p.stock },
      create: { ...p, shopId: shop.id, categoryId: category.id, isActive: true },
    });
  }
  console.log(`      ${DEMO_PRODUCTS.length} demo products`);

  // The driver panel throws a hard 404 ("ڈرائیور پروفائل نہیں ملا") for any
  // account without a Driver row, so the role alone is not enough.
  const driver = await prisma.driver.upsert({
    where: { userId: users.driver.id },
    update: { isActive: true, isVerified: true },
    create: {
      userId: users.driver.id,
      phone: '+923009876543',
      vehicleType: 'رکشہ',
      vehicleNumber: 'DEMO-0001',
      isActive: true,
      isVerified: true,
    },
  });
  console.log(`driver profile ${driver.id} active=${driver.isActive} verified=${driver.isVerified}`);

  console.log('\n--- paste into Play Console ---');
  for (const r of REVIEWERS) console.log(`${r.email}  ${r.password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
