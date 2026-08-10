import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../lib/prisma.js';
import { stripTags, wordCount, normalizeNbsp, tokenizeBlocks, normText } from './lib/articleText.js';

// Renders one markdown brief per article for the editorial expansion pass.
//
//   npm run briefs:articles
//
// Read-only against the database. The gaps and sources come from the reviewed
// data file next door; this script only merges them with live word counts and
// the article's own opening text. Nothing here is ever written to the database —
// article length is a reporting problem, not something a script can fix.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data/reporting-briefs.json');
const OUT_DIR = path.resolve(__dirname, '../../../docs/editorial/reporting-briefs');
const SITE = process.env.PUBLIC_SITE_URL || 'https://narangmandi.com';
const TARGET_WORDS = 450;

const BANNER =
  '> **کچھ من گھڑت نہ لکھیں۔** نیچے درج ہر بات اسی خبر کے موجودہ متن سے لی گئی ہے۔\n' +
  '> جہاں **GAP** لکھا ہے وہ معلومات رپورٹ کر کے حاصل کرنی ہیں — اندازے سے نہیں لکھنی۔\n' +
  '> کسی نام، عدد، اقتباس یا سرکاری بیان کو تصدیق کے بغیر شامل نہ کریں.';

const esc = (s) => String(s || '').replace(/\|/g, '\\|');

async function main() {
  const briefs = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const articles = await prisma.article.findMany({
    where: { status: 'published' },
    select: { slug: true, title: true, excerpt: true, content: true, publishedAt: true, category: { select: { name: true } } },
    orderBy: { publishedAt: 'asc' },
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const index = [];

  for (const a of articles) {
    const data = briefs[a.slug];
    if (!data) continue;

    const words = wordCount(a.content) || wordCount(a.excerpt);
    const paras = (tokenizeBlocks(a.content) || []).filter((t) => t.type === 'block' && normText(t.raw)).length;
    const sentences = (a.content.match(/[۔؟!]/g) || []).length;
    const titleWords = wordCount(a.title);
    const text = stripTags(normalizeNbsp(a.content)) || stripTags(a.excerpt);
    const opening = text.split(/(?<=۔)\s+/).slice(0, 3).join(' ').slice(0, 700);

    const md = [
      `# ${a.title}`,
      '',
      BANNER,
      '',
      '## خبر کی تفصیل',
      '',
      '| | |',
      '|---|---|',
      `| سلگ | \`${a.slug}\` |`,
      `| لنک | ${SITE}/article/${a.slug} |`,
      `| زمرہ | ${esc(a.category?.name || '—')} |`,
      `| اشاعت | ${a.publishedAt ? new Date(a.publishedAt).toISOString().slice(0, 10) : '—'} |`,
      `| موجودہ طوالت | **${words} الفاظ** |`,
      `| پیراگراف | ${paras} |`,
      `| جملے (۔ ؟ !) | ${sentences} |`,
      `| سرخی کی لمبائی | ${titleWords} الفاظ |`,
      `| ہدف | ${TARGET_WORDS}+ الفاظ |`,
      '',
      ...(titleWords > 20
        ? [
            '## ⚠️ سرخی بہت لمبی ہے',
            '',
            `اس خبر کی سرخی **${titleWords} الفاظ** پر مشتمل ہے۔ خبری سرخی عام طور پر 8 سے 14 الفاظ کی ہوتی ہے۔`,
            'اتنی لمبی سرخی خود ہی پورا لیڈ بن جاتی ہے، اس لیے خبر کا پہلا پیراگراف لامحالہ سرخی کو دہراتا ہے۔',
            'سرخی مختصر کریں — تب ہی لیڈ اپنا کام کر سکے گا اور صفحے پر ایک ہی جملہ دو بار نہیں چھپے گا۔',
            '',
          ]
        : []),
      ...(sentences < 3
        ? [
            '## ⚠️ رموزِ اوقاف',
            '',
            `یہ پوری خبر تقریباً **${sentences || 'ایک بھی نہیں'} جملے** پر مشتمل ہے — ${words} الفاظ بغیر مکمل وقف کے۔`,
            'اسی وجہ سے اسے خودکار طریقے سے پیراگراف میں تقسیم نہیں کیا جا سکا۔',
            'ہر جملے کے آخر میں **۔** لگائیں؛ جملہ چھ سے سات الفاظ سے زیادہ لمبا نہ رکھیں۔',
            'یہ قاری اور سرچ انجن دونوں کے لیے سب سے نمایاں مسئلہ ہے۔',
            '',
          ]
        : []),
      '## خبر اس وقت کیا بتاتی ہے',
      '',
      '> ' + opening.replace(/\n/g, ' '),
      '',
      '## GAP — یہ معلومات ابھی موجود نہیں',
      '',
      ...data.gaps.map((g) => `- [ ] ${g}`),
      '',
      '## کن سے رابطہ کرنا ہے',
      '',
      ...data.sources.map((s) => `- ${s}`),
      '',
      ...(data.note ? ['## ادارتی نوٹ', '', `⚠️ ${data.note}`, ''] : []),
      '## تجویز کردہ ساخت',
      '',
      '1. **سرخی** — موجودہ سرخی استعمال کریں (متن میں دہرائی نہ جائے)۔',
      '2. **خلاصہ** — دو سطریں، excerpt کے خانے میں؛ متن سے نقل نہ کریں۔',
      '3. **لیڈ** — کیا، کہاں، کب، کون۔',
      '4. **تفصیل** — GAP کے جوابات یہاں شامل کریں۔',
      '5. **مؤقف** — متعلقہ ادارے یا فریق کا بیان۔',
      '6. **پس منظر** — پہلے کیا ہوا تھا، اعداد و شمار۔',
      '7. **آگے کیا** — تفتیش، سماعت یا اگلا مرحلہ۔',
      '',
    ].join('\n');

    fs.writeFileSync(path.join(OUT_DIR, `${a.slug}.md`), md, 'utf8');
    index.push({ slug: a.slug, title: a.title, words, paras, sentences, titleWords, note: Boolean(data.note) });
  }

  index.sort((x, y) => x.words - y.words);
  const readme = [
    '# ادارتی بریفس — خبروں کی توسیع',
    '',
    'ہر فائل ایک خبر کے لیے ہے۔ اس میں وہ سوالات درج ہیں جن کے جواب رپورٹ کر کے حاصل کرنے ہیں۔',
    '**کوئی بھی تفصیل اندازے سے نہ لکھیں۔** یہ فائلیں صرف اس ریپو میں ہیں، ویب سائٹ پر شائع نہیں ہوتیں۔',
    '',
    `تیار کردہ: \`npm run briefs:articles\` — ${index.length} خبریں، ہدف ${TARGET_WORDS}+ الفاظ فی خبر۔`,
    '',
    '| # | خبر | الفاظ | پیراگراف | جملے | سرخی | نوٹ | ہو گیا |',
    '|---|---|---|---|---|---|---|---|',
    ...index.map(
      (r, i) =>
        `| ${i + 1} | [${esc(r.title.slice(0, 60))}](${r.slug}.md) | ${r.words} | ${r.paras} | ${
          r.sentences < 3 ? `**${r.sentences}** ⚠️` : r.sentences
        } | ${r.titleWords > 20 ? `**${r.titleWords}** ⚠️` : r.titleWords} | ${r.note ? '⚠️' : ''} | ☐ |`
    ),
    '',
    '⚠️ نوٹ کے خانے میں = ادارتی یا قانونی نوٹ موجود ہے، پہلے وہ پڑھیں۔',
    '',
    `⚠️ جملوں کے خانے میں = پوری خبر میں تین سے کم مکمل وقف (۔) ہیں — ${
      index.filter((r) => r.sentences < 3).length
    } خبریں۔`,
    '',
    `⚠️ سرخی کے خانے میں = سرخی 20 الفاظ سے لمبی ہے اور خود ہی لیڈ بن گئی ہے — ${
      index.filter((r) => r.titleWords > 20).length
    } خبریں۔ سرخیاں مختصر کرنا سب سے زیادہ فرق ڈالے گا۔`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme, 'utf8');

  console.log(`[briefs] wrote ${index.length} brief(s) + README to ${path.relative(process.cwd(), OUT_DIR)}`);
  const short = index.filter((r) => r.words < TARGET_WORDS).length;
  console.log(`[briefs] ${short}/${index.length} article(s) are under the ${TARGET_WORDS}-word target`);
}

main()
  .catch((err) => {
    console.error('[briefs] FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
