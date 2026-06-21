import 'dotenv/config';
import prisma from '../lib/prisma.js';
import { uniqueShortSlug } from '../utils/slugify.js';

// One-off: replace every article's (long, title-derived) slug with a short
// random ASCII slug. Already-short slugs are skipped so it is safe to re-run.
const ALREADY_SHORT = /^[a-z0-9]{6,10}$/;

async function main() {
  const articles = await prisma.article.findMany({ select: { id: true, slug: true } });
  let changed = 0;
  for (const a of articles) {
    if (ALREADY_SHORT.test(a.slug)) continue;
    // eslint-disable-next-line no-await-in-loop
    const slug = await uniqueShortSlug(prisma.article);
    // eslint-disable-next-line no-await-in-loop
    await prisma.article.update({ where: { id: a.id }, data: { slug } });
    changed += 1;
    console.log(`  ${a.slug.slice(0, 24)}…  ->  ${slug}`);
  }
  console.log(`[shorten-slugs] updated ${changed}/${articles.length} articles`);
}

main()
  .catch((err) => {
    console.error('[shorten-slugs] FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
