import 'dotenv/config';
import prisma from '../lib/prisma.js';
import {
  normText,
  normalizeNbsp,
  tokenizeBlocks,
  classifyLeadBlock,
  stripLeadingHeadline,
  isExcerptDuplicated,
  wordCount,
  SWAPPED_SLUGS,
} from './lib/articleText.js';

// Read-only. Counts every defect the cleanup targets, so the same numbers can be
// captured before and after the migration and compared by construction.
//
//   npm run audit:articles
//   npm run audit:articles -- --json
//   npm run audit:articles -- --all-statuses

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const allStatuses = argv.includes('--all-statuses');

const NBSP_COUNT_RE = /&nbsp;|&#160;|&#xa0;| | /gi;

async function main() {
  const articles = await prisma.article.findMany({
    where: allStatuses ? {} : { status: 'published' },
    select: { id: true, slug: true, title: true, excerpt: true, content: true, status: true },
    orderBy: { publishedAt: 'asc' },
  });

  const rows = articles.map((a) => {
    const nbsp = ((a.content || '') + (a.excerpt || '')).match(NBSP_COUNT_RE)?.length || 0;
    const tokens = tokenizeBlocks(a.content);
    const lead = tokens?.find((t) => t.type === 'block' && normText(t.raw));
    const verdict = lead ? classifyLeadBlock(lead.raw, a.title) : { bucket: 0, auto: false };
    // Measured on nbsp-normalised content because that is the order the cleanup
    // runs in (nbsp before headline) — otherwise this under-reports what the
    // migration will actually fix.
    // Catches both shapes: the headline as its own block, and the far more common
    // case of it fused into the start of the opening paragraph.
    const normalised = normalizeNbsp(a.content);
    const stripped = stripLeadingHeadline(normalised, a.title);
    return {
      slug: a.slug,
      status: a.status,
      nbsp,
      excerptDuplicated: isExcerptDuplicated(a.excerpt, a.content, a.title),
      headlineRepeated: stripped.html !== normalised,
      leadBucket: verdict.bucket,
      leadAuto: verdict.auto,
      tokenizeFailed: tokens === null,
      excerptWords: wordCount(a.excerpt),
      bodyWords: wordCount(a.content),
      swapped: wordCount(a.excerpt) > wordCount(a.content) && SWAPPED_SLUGS.includes(a.slug),
    };
  });

  const totals = {
    articles: rows.length,
    nbspOccurrences: rows.reduce((n, r) => n + r.nbsp, 0),
    articlesWithNbsp: rows.filter((r) => r.nbsp > 0).length,
    excerptDuplicated: rows.filter((r) => r.excerptDuplicated).length,
    headlineRepeated: rows.filter((r) => r.headlineRepeated).length,
    headlineAutoRemovable: rows.filter((r) => r.leadAuto).length,
    headlineNeedsReview: rows.filter((r) => r.leadBucket === 4).length,
    excerptLongerThanBody: rows.filter((r) => r.excerptWords > r.bodyWords).length,
    tokenizeFailures: rows.filter((r) => r.tokenizeFailed).length,
  };

  const words = rows.map((r) => r.bodyWords).sort((x, y) => x - y);
  const median = words.length ? words[Math.floor(words.length / 2)] : 0;

  if (asJson) {
    console.log(JSON.stringify({ totals, median, under350: words.filter((w) => w < 350).length, rows }, null, 2));
    return;
  }

  console.log(`\n[audit] ${totals.articles} article(s)${allStatuses ? '' : ' (published only)'}\n`);
  const fmt = (label, value, target) =>
    console.log(`  ${label.padEnd(34)} ${String(value).padStart(6)}   target ${target}`);
  fmt('nbsp-family occurrences', totals.nbspOccurrences, '0');
  fmt('articles containing nbsp', totals.articlesWithNbsp, '0');
  fmt('excerpt duplicated in body', totals.excerptDuplicated, '0');
  fmt('headline repeated in body', totals.headlineRepeated, '0');
  fmt('  ...of which its own block', totals.headlineAutoRemovable, '0');
  fmt('headline repeated (needs a human)', totals.headlineNeedsReview, 'human call');
  fmt('excerpt longer than body', totals.excerptLongerThanBody, '0');
  fmt('block-tokenize failures', totals.tokenizeFailures, '0');

  console.log(`\n  body words: median ${median}, under 350: ${words.filter((w) => w < 350).length}/${rows.length}`);
  console.log('  (length is tracked, not gated — it is an editorial task, not a code one)\n');

  const flagged = rows.filter(
    (r) =>
      r.nbsp || r.excerptDuplicated || r.headlineRepeated || r.tokenizeFailed || r.excerptWords > r.bodyWords
  );
  if (flagged.length) {
    console.log('  slug        nbsp  dupExc  lead  exWords  bodyWords');
    for (const r of flagged) {
      console.log(
        `  ${r.slug.padEnd(11)}${String(r.nbsp).padStart(4)}` +
          `${(r.excerptDuplicated ? 'yes' : '-').padStart(8)}` +
          `${(r.leadBucket ? `b${r.leadBucket}${r.leadAuto ? '' : '?'}` : '-').padStart(6)}` +
          `${String(r.excerptWords).padStart(9)}${String(r.bodyWords).padStart(11)}` +
          (r.tokenizeFailed ? '  TOKENIZE-FAIL' : '')
      );
    }
    console.log('');
  }
}

main()
  .catch((err) => {
    console.error('[audit] FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
