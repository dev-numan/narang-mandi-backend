import 'dotenv/config';
import prisma from '../lib/prisma.js';

// Reassigns the 6 articles created by seed-politics.js to a specific user.
const TARGET_EMAIL = 'sahib@narangmandi.com';
const TITLES = [
  'ضلعی انتظامیہ کا اہم اجلاس، ترقیاتی منصوبوں کا جائزہ',
  'صوبائی حکومت کا نیا ترقیاتی پیکج منظور، عوام میں خوشی کی لہر',
  'اپوزیشن جماعتوں کا مشترکہ اجلاس، آئندہ حکمت عملی پر غور',
  'بلدیاتی نمائندوں کی شہر میں صفائی مہم کی نگرانی',
  'مقامی سیاسی رہنماؤں کا عوامی مسائل کے فوری حل کا عزم',
  'بلدیاتی انتخابات کی تیاریاں عروج پر، امیدواروں کی سرگرمیاں تیز',
];

async function run() {
  const user = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!user) {
    throw new Error(`No user found with email "${TARGET_EMAIL}". Aborting — no articles changed.`);
  }

  const result = await prisma.article.updateMany({
    where: { title: { in: TITLES } },
    data: { authorId: user.id },
  });

  console.log(`Assigned ${result.count} seeded article(s) to ${user.name} <${user.email}>.`);
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
