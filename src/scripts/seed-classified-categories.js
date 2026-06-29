import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { uniqueSlug } from '../utils/slugify.js';

// Launch categories for the classifieds marketplace. Admin can add more later.
const CATEGORIES = [
  { name: 'خرید و فروخت', nameEn: 'For Sale', slug: 'for-sale', icon: '🛒', order: 1 },
  { name: 'نوکریاں', nameEn: 'Jobs', slug: 'jobs', icon: '💼', order: 2 },
  { name: 'گاڑیاں', nameEn: 'Vehicles', slug: 'vehicles', icon: '🚗', order: 3 },
];

async function run() {
  console.log('[seed-classifieds] clearing existing classified categories...');
  // Listings reference categories (onDelete: SetNull); clearing categories is safe.
  await prisma.classifiedCategory.deleteMany();
  for (const c of CATEGORIES) {
    const slug = await uniqueSlug(prisma.classifiedCategory, c.slug);
    await prisma.classifiedCategory.create({ data: { ...c, slug } });
  }
  console.log(`[seed-classifieds] created ${CATEGORIES.length} categories ✓`);
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[seed-classifieds] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
