import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { uniqueSlug } from '../utils/slugify.js';

// Adds 6 published articles to the سیاست (politics) category.
// Usage: node src/scripts/seed-politics.js
const CATEGORY_SLUG = 'politics';

const TITLES = [
  'ضلعی انتظامیہ کا اہم اجلاس، ترقیاتی منصوبوں کا جائزہ',
  'صوبائی حکومت کا نیا ترقیاتی پیکج منظور، عوام میں خوشی کی لہر',
  'اپوزیشن جماعتوں کا مشترکہ اجلاس، آئندہ حکمت عملی پر غور',
  'بلدیاتی نمائندوں کی شہر میں صفائی مہم کی نگرانی',
  'مقامی سیاسی رہنماؤں کا عوامی مسائل کے فوری حل کا عزم',
  'بلدیاتی انتخابات کی تیاریاں عروج پر، امیدواروں کی سرگرمیاں تیز',
];

const IMG = (seed) => `https://picsum.photos/seed/${seed}/1200/700`;

function contentFor(title) {
  return `<h2>${title}</h2><p>یہ ایک <strong>نمونہ سیاسی خبر</strong> ہے جو ویب سائٹ پر مواد کی نمائش کے لیے شامل کی گئی ہے۔</p><ul><li>پہلا نکتہ</li><li>دوسرا نکتہ</li><li>تیسرا نکتہ</li></ul><blockquote>یہ ایک اقتباس ہے جو خبر کی اہمیت کو اجاگر کرتا ہے۔</blockquote><p>مزید تفصیلات کے لیے ویب سائٹ ملاحظہ کرتے رہیں۔</p>`;
}

async function run() {
  const category = await prisma.category.findUnique({ where: { slug: CATEGORY_SLUG } });
  if (!category) {
    throw new Error(`Category "${CATEGORY_SLUG}" (سیاست) not found. Aborting — nothing created.`);
  }

  // Prefer an admin as the author; fall back to any existing user.
  const author =
    (await prisma.user.findFirst({ where: { role: 'admin' } })) ||
    (await prisma.user.findFirst());
  if (!author) {
    throw new Error('No users exist to set as author. Create a user first.');
  }

  let created = 0;
  for (let i = 0; i < TITLES.length; i++) {
    const title = TITLES[i];
    const slug = await uniqueSlug(prisma.article, title);
    await prisma.article.create({
      data: {
        title,
        slug,
        excerpt:
          'یہ ایک نمونہ سیاسی خبر ہے جو ویب سائٹ کے ڈیزائن اور اردو متن کی درست رینڈرنگ دکھانے کے لیے شامل کی گئی ہے۔',
        content: contentFor(title),
        coverImage: IMG(`politics-extra-${i}`),
        categoryId: category.id,
        authorId: author.id,
        status: 'published',
        tags: [category.name],
        publishedAt: new Date(Date.now() - i * 3600_000),
      },
    });
    created++;
  }

  console.log(
    `Created ${created} article(s) in "${category.name}" (${category.slug}), author: ${author.name} <${author.email}>.`
  );
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Error:', err.message);
    await prisma.$disconnect();
    process.exit(1);
  });
