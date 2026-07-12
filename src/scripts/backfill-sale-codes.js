import 'dotenv/config';
import prisma from '../lib/prisma.js';

async function generateSaleCode() {
  for (let attempt = 0; attempt < 25; attempt++) {
    const saleCode = String(Math.floor(10000000 + Math.random() * 90000000));
    const exists = await prisma.classified.findUnique({ where: { saleCode } });
    if (!exists) return saleCode;
  }
  throw new Error('Could not generate sale code');
}

async function run() {
  const missing = await prisma.classified.findMany({ where: { saleCode: null } });
  for (const listing of missing) {
    const saleCode = await generateSaleCode();
    await prisma.classified.update({ where: { id: listing.id }, data: { saleCode } });
    console.log(`[backfill] ${listing.title} → ${saleCode}`);
  }
  console.log(`[backfill] done (${missing.length} updated)`);
}

run()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[backfill] failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
