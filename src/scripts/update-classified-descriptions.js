import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { LISTINGS } from './seed-classified-listings.js';

// Non-destructive: matches existing classifieds by title and rewrites only the
// `description` and `location`. Slugs, sale codes, images, status and IDs are
// left untouched, so existing listing URLs keep working.
async function run() {
  let updated = 0;
  let missing = 0;

  for (const item of LISTINGS) {
    const result = await prisma.classified.updateMany({
      where: { title: item.title },
      data: { description: item.description, location: item.location },
    });
    if (result.count > 0) {
      updated += result.count;
      console.log(`  ✓ ${item.title.slice(0, 44)} (${result.count})`);
    } else {
      missing += 1;
      console.log(`  – not found: ${item.title.slice(0, 44)}`);
    }
  }

  console.log(`\n[update-classified-descriptions] updated ${updated} row(s), ${missing} title(s) not found`);
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[update-classified-descriptions] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
