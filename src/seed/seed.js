import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { uniqueSlug } from '../utils/slugify.js';

const CATEGORIES = [
  { name: 'سیاست', slug: 'politics', description: 'ملکی و مقامی سیاسی خبریں', order: 1 },
  { name: 'کھیل', slug: 'sports', description: 'کرکٹ، فٹبال اور دیگر کھیل', order: 2 },
  { name: 'مقامی خبریں', slug: 'local', description: 'نارنگ منڈی کی مقامی خبریں', order: 3 },
  { name: 'کاروبار', slug: 'business', description: 'معیشت اور کاروباری خبریں', order: 4 },
  { name: 'تعلیم', slug: 'education', description: 'تعلیمی خبریں اور اطلاعات', order: 5 },
  { name: 'صحت', slug: 'health', description: 'صحت سے متعلق خبریں', order: 6 },
];

const IMG = (seed) => `https://picsum.photos/seed/${seed}/1200/700`;

const TITLES = {
  politics: [
    'ضلعی انتظامیہ کا اہم اجلاس، ترقیاتی منصوبوں کا جائزہ',
    'بلدیاتی نمائندوں کی شہر میں صفائی مہم کی نگرانی',
  ],
  sports: [
    'نارنگ منڈی الیون نے فائنل میں شاندار کامیابی حاصل کر لی',
    'نوجوان کھلاڑیوں کے لیے کرکٹ ٹرائلز کا اعلان',
  ],
  local: [
    'شہر کی مرکزی سڑک کی تعمیر نو کا کام مکمل',
    'مقامی بازار میں اشیائے خوردونوش کی قیمتوں میں کمی',
  ],
  business: [
    'مقامی تاجروں کا کاروباری سرگرمیوں پر اطمینان کا اظہار',
    'نئی صنعتی یونٹ سے روزگار کے مواقع پیدا ہوں گے',
  ],
  education: [
    'سرکاری اسکولوں میں نئے تعلیمی سال کا آغاز',
    'طلبہ کے لیے مفت کتب کی تقسیم کا منصوبہ',
  ],
  health: [
    'ضلعی ہسپتال میں نئے شعبے کا افتتاح',
    'شہر میں مفت طبی کیمپ کا انعقاد',
  ],
};

function contentFor(title) {
  return `<h2>${title}</h2><p>یہ ایک <strong>نمونہ مضمون</strong> ہے جس میں رِچ ٹیکسٹ ایڈیٹر کی صلاحیتوں کا مظاہرہ کیا گیا ہے۔ اس میں <em>ترچھا</em> متن، فہرستیں اور دیگر عناصر شامل ہیں۔</p><ul><li>پہلا نکتہ</li><li>دوسرا نکتہ</li><li>تیسرا نکتہ</li></ul><blockquote>یہ ایک اقتباس ہے جو خبر کی اہمیت کو اجاگر کرتا ہے۔</blockquote><p>مزید تفصیلات کے لیے ویب سائٹ ملاحظہ کرتے رہیں۔</p>`;
}

async function run() {
  console.log('[seed] clearing existing data...');
  // Order matters due to FKs (articles reference categories/users).
  await prisma.article.deleteMany();
  await prisma.category.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.user.deleteMany();

  // Admin user
  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@narangmandi.com').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin12345';
  const admin = await prisma.user.create({
    data: {
      name: process.env.SEED_ADMIN_NAME || 'Admin',
      email: adminEmail,
      role: 'admin',
      passwordHash: await hashPassword(adminPassword),
    },
  });
  console.log(`[seed] admin: ${admin.email} / ${adminPassword}`);

  // Categories
  const cats = [];
  for (const c of CATEGORIES) {
    cats.push(await prisma.category.create({ data: c }));
  }

  // Articles — 2 per category
  let created = 0;
  for (const cat of cats) {
    for (let i = 0; i < 2; i++) {
      const title = TITLES[cat.slug][i % 2];
      const slug = await uniqueSlug(prisma.article, title);
      await prisma.article.create({
        data: {
          title,
          slug,
          excerpt:
            'یہ ایک نمونہ خبر ہے جو ویب سائٹ کے ڈیزائن اور اردو متن کی درست رینڈرنگ دکھانے کے لیے شامل کی گئی ہے۔',
          content: contentFor(title),
          coverImage: IMG(`${cat.slug}-${i}`),
          categoryId: cat.id,
          authorId: admin.id,
          status: 'published',
          isCarousel: created % 3 === 0,
          tags: [cat.name],
          views: Math.floor((created + 1) * 37.5),
          publishedAt: new Date(Date.now() - created * 3600_000),
        },
      });
      created++;
    }
  }
  console.log(`[seed] created ${cats.length} categories and ${created} articles`);

  // Settings
  await prisma.settings.create({
    data: {
      key: 'site',
      siteName: 'نارنگ منڈی نیوز',
      tagline: 'آپ کے شہر کی تازہ ترین خبریں',
      contactEmail: 'info@narangmandi.com',
      socialLinks: {
        facebook: 'https://facebook.com',
        youtube: 'https://youtube.com',
        twitter: 'https://twitter.com',
        whatsapp: 'https://wa.me/0000000000',
      },
      breakingTicker: ['نارنگ منڈی نیوز پر خوش آمدید — تازہ ترین خبروں کے لیے ساتھ رہیں'],
    },
  });

  console.log('[seed] done ✓');
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
