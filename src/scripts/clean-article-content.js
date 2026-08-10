import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prisma from '../lib/prisma.js';
import { transformArticle, wordCount } from './lib/articleText.js';

// Repairs the article bodies damaged by pasting from Word into ReactQuill:
// nbsp between every word, the headline repeated as the first paragraph, the
// opening paragraph copied into the excerpt field, and three articles whose body
// and excerpt were filed the wrong way round.
//
//   npm run clean:articles                                  # dry run (default)
//   npm run clean:articles -- --verbose                     # dry run, full text
//   npm run clean:articles -- --apply --confirm-db=<host>   # writes
//
// Writing requires BOTH --apply and a --confirm-db that matches the host in
// DATABASE_URL. The default is dry-run because there is no revision history in
// this schema: an update overwrites in place and the only way back is the JSON
// snapshot this script takes first.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.resolve(__dirname, '../../../db_backup/articles');
const EXCERPTS_DEFAULT = path.join(__dirname, 'data/article-excerpts.json');
const REWRITES_DEFAULT = path.join(__dirname, 'data/article-rewrites.json');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const APPLY = flag('apply');
const VERBOSE = flag('verbose');
const ALL_STATUSES = flag('all-statuses');
const CONFIRM_DB = value('confirm-db');
const ONLY = value('only') ? new Set(value('only').split(',').map((s) => s.trim())) : null;
const SLUGS = value('slugs')?.split(',').map((s) => s.trim()).filter(Boolean);
const EXCERPTS_PATH = value('excerpts') || EXCERPTS_DEFAULT;
const REWRITES_PATH = value('rewrites') || REWRITES_DEFAULT;

// Host only — never print credentials from the connection string.
function dbHost() {
  try {
    return new URL(process.env.DATABASE_URL).host;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

function loadJson(file, label) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`could not parse ${label} (${file}): ${err.message}`);
  }
}

function writeSnapshot(articles) {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const file = path.join(SNAPSHOT_DIR, `articles-${stamp}.json`);
  if (fs.existsSync(file)) throw new Error(`snapshot ${file} already exists — refusing to overwrite`);
  fs.writeFileSync(file, JSON.stringify(articles, null, 2), 'utf8');
  const bytes = fs.statSync(file).size;
  if (!bytes) throw new Error(`snapshot ${file} is empty — aborting before any write`);
  return { file, bytes };
}

const preview = (s, n = 160) => (s.length <= n ? s : `${s.slice(0, n)}…`);

async function main() {
  const host = dbHost();
  console.log(`\n[clean] database host: ${host}`);
  console.log(`[clean] mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}`);

  if (APPLY) {
    if (!CONFIRM_DB) {
      throw new Error(`--apply requires --confirm-db=<substring of "${host}">`);
    }
    if (!host.includes(CONFIRM_DB)) {
      throw new Error(`--confirm-db="${CONFIRM_DB}" does not match database host "${host}" — aborting`);
    }
  }

  const replacementExcerpts = loadJson(EXCERPTS_PATH, 'excerpts');
  const rewrites = loadJson(REWRITES_PATH, 'rewrites');
  const replacementCount = Object.keys(replacementExcerpts).filter((k) => !k.startsWith('_')).length;
  console.log(
    `[clean] replacement excerpts: ${replacementCount} from ${
      fs.existsSync(EXCERPTS_PATH) ? path.relative(process.cwd(), EXCERPTS_PATH) : '(none on disk)'
    }`
  );
  console.log(
    `[clean] reviewed rewrites  : ${Object.keys(rewrites).filter((k) => !k.startsWith('_')).length} from ${
      fs.existsSync(REWRITES_PATH) ? path.relative(process.cwd(), REWRITES_PATH) : '(none on disk)'
    }`
  );
  if (ONLY) console.log(`[clean] phases: ${[...ONLY].join(', ')}`);

  const articles = await prisma.article.findMany({
    where: {
      ...(ALL_STATUSES ? {} : { status: 'published' }),
      ...(SLUGS?.length ? { slug: { in: SLUGS } } : {}),
    },
    select: {
      id: true, slug: true, title: true, excerpt: true, content: true,
      status: true, publishedAt: true, updatedAt: true,
    },
    orderBy: { publishedAt: 'asc' },
  });
  console.log(`[clean] target set: ${articles.length} article(s)\n`);
  if (!articles.length) return;

  // Snapshot first, in dry-run too: the file is the only undo path that exists.
  const snap = writeSnapshot(articles);
  console.log(`[clean] snapshot: ${path.relative(process.cwd(), snap.file)} (${snap.bytes} bytes)\n`);

  const planned = [];
  const review = [];
  const flagged = [];

  for (const a of articles) {
    const next = transformArticle(a, { replacementExcerpts, rewrites, only: ONLY });

    // Fixed-point self-check: a transform that does not converge would make the
    // script non-idempotent, so skip that article rather than write it.
    const again = transformArticle({ ...a, ...next }, { replacementExcerpts, rewrites, only: ONLY });
    if (again.content !== next.content || again.excerpt !== next.excerpt) {
      console.log(`  ${a.slug}  !! transform did not converge — SKIPPED`);
      review.push({ slug: a.slug, notes: ['transform did not reach a fixed point'] });
      continue;
    }

    const changed = next.content !== a.content || next.excerpt !== a.excerpt;
    const notes = next.notes.filter(Boolean);
    // REVIEW/FAILED = the transform declined to act, a human must decide.
    // FLAG = the change was made, but the editor still has follow-up work.
    const blocking = notes.filter((n) => /^REVIEW:|FAILED/.test(n));
    const followUp = notes.filter((n) => n.startsWith('FLAG:'));
    if (blocking.length) review.push({ slug: a.slug, notes: blocking });
    if (followUp.length) flagged.push({ slug: a.slug, notes: followUp });

    if (!changed) {
      if (VERBOSE) console.log(`  ${a.slug}  (no change)`);
      continue;
    }

    planned.push({ id: a.id, slug: a.slug, data: { excerpt: next.excerpt, content: next.content } });

    console.log(`  ${a.slug}  ${wordCount(a.content)}w -> ${wordCount(next.content)}w`);
    for (const n of notes) console.log(`      · ${n}`);
    if (VERBOSE) {
      console.log(`      BEFORE excerpt: ${preview(a.excerpt || '(empty)')}`);
      console.log(`      AFTER  excerpt: ${preview(next.excerpt || '(empty)')}`);
      console.log(`      BEFORE body   : ${preview(a.content)}`);
      console.log(`      AFTER  body   : ${preview(next.content)}`);
    }
  }

  console.log(`\n[clean] ${planned.length}/${articles.length} article(s) would change`);

  if (review.length) {
    console.log(`\n[clean] ${review.length} article(s) the transform DECLINED to change — a human must decide:`);
    for (const r of review) {
      console.log(`  ${r.slug}`);
      for (const n of r.notes) console.log(`      · ${n}`);
    }
  }

  if (flagged.length) {
    console.log(`\n[clean] ${flagged.length} article(s) WERE changed but need editor follow-up:`);
    for (const r of flagged) {
      console.log(`  ${r.slug}`);
      for (const n of r.notes) console.log(`      · ${n}`);
    }
  }

  if (!APPLY) {
    console.log('\n[clean] dry run — nothing written. Re-run with --apply --confirm-db=<host> to write.\n');
    return;
  }

  let written = 0;
  for (const p of planned) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.article.update({ where: { id: p.id }, data: p.data });
    written += 1;
  }
  console.log(`\n[clean] updated ${written}/${articles.length} article(s)`);
  console.log(`[clean] undo: npm run restore:articles -- ${path.relative(process.cwd(), snap.file)}\n`);
}

main()
  .catch((err) => {
    console.error('\n[clean] FAILED:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
