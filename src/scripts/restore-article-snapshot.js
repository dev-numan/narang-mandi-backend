import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import prisma from '../lib/prisma.js';

// Undo for clean-article-content.js. This schema has no revision history and no
// soft delete, so the JSON snapshot written before a cleanup run is the only way
// back — this script replays it.
//
//   npm run restore:articles -- db_backup/articles/articles-20260803-120000.json
//   npm run restore:articles -- <file> --apply --confirm-db=<host>
//
// Restores title, excerpt and content only. Never touches slug, status,
// publishedAt or media, matching what the cleanup was allowed to write.

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const file = argv.find((a) => !a.startsWith('--'));

const APPLY = flag('apply');
const CONFIRM_DB = value('confirm-db');

function dbHost() {
  try {
    return new URL(process.env.DATABASE_URL).host;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function main() {
  if (!file) throw new Error('usage: npm run restore:articles -- <snapshot.json> [--apply --confirm-db=<host>]');
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw new Error(`snapshot not found: ${resolved}`);

  const snapshot = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (!Array.isArray(snapshot) || !snapshot.length) throw new Error('snapshot is empty or not an array');

  const host = dbHost();
  console.log(`\n[restore] database host: ${host}`);
  console.log(`[restore] snapshot: ${path.relative(process.cwd(), resolved)} (${snapshot.length} article(s))`);
  console.log(`[restore] mode: ${APPLY ? 'APPLY (writes)' : 'DRY RUN (no writes)'}\n`);

  if (APPLY) {
    if (!CONFIRM_DB) throw new Error(`--apply requires --confirm-db=<substring of "${host}">`);
    if (!host.includes(CONFIRM_DB)) {
      throw new Error(`--confirm-db="${CONFIRM_DB}" does not match database host "${host}" — aborting`);
    }
  }

  const current = await prisma.article.findMany({
    where: { id: { in: snapshot.map((s) => s.id) } },
    select: { id: true, slug: true, title: true, excerpt: true, content: true },
  });
  const byId = new Map(current.map((c) => [c.id, c]));

  const planned = [];
  for (const s of snapshot) {
    const now = byId.get(s.id);
    if (!now) {
      console.log(`  ${s.slug}  !! no longer in the database — skipped`);
      continue;
    }
    if (now.title === s.title && now.excerpt === s.excerpt && now.content === s.content) continue;
    planned.push(s);
    console.log(`  ${s.slug}  would revert title/excerpt/content`);
  }

  console.log(`\n[restore] ${planned.length}/${snapshot.length} article(s) differ from the snapshot`);

  if (!APPLY) {
    console.log('[restore] dry run — nothing written. Re-run with --apply --confirm-db=<host>.\n');
    return;
  }

  let written = 0;
  for (const s of planned) {
    // eslint-disable-next-line no-await-in-loop
    await prisma.article.update({
      where: { id: s.id },
      data: { title: s.title, excerpt: s.excerpt, content: s.content },
    });
    written += 1;
  }
  console.log(`[restore] reverted ${written} article(s)\n`);
}

main()
  .catch((err) => {
    console.error('\n[restore] FAILED:', err.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
