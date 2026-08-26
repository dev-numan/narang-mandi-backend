/**
 * Gives every real driver a short, speakable login: a first-name email and a
 * password built from that same name.
 *
 * The old emails came out of the provisioning script's generic rules — full
 * names joined by dots (`tayyab.rafique.khokhar@…`), or the phone digits when
 * the name was Urdu script (`driver.3124473482@…`). Both are unusable over a
 * phone call, which is how these credentials actually get delivered.
 *
 * Urdu names are mapped by hand below rather than transliterated: there is no
 * correct automatic answer, and a wrong guess becomes someone's login.
 *
 * Test and store-review accounts are skipped — they are not people.
 *
 *   node src/scripts/rebrand-driver-logins.js            # show the table
 *   node src/scripts/rebrand-driver-logins.js --apply
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const DOMAIN = 'narangdriver.com';

/// Keyed by phone, which is stable; the name field is not.
const URDU_NAMES = {
  '03124473482': 'shahid', // شاھد
  '03134000971': 'waqar', //  رانا محمد وقار — رانا is a clan title, not the given name
  '03017028904': 'irfaz', //  محمد عرفاز
  '03164368253': 'awais', //  اویس رسول
  '03169610313': 'hassan', // حسن
};

/// Seeded and Play-Store-review logins. Real drivers only.
const SKIP_PHONES = new Set(['03001111111', '+920000000000', '+923009876543']);

/// Honorifics and near-universal prefixes carry no identifying information —
/// half the town would end up as `muhammad`.
const PREFIXES = new Set(['muhammad', 'mohammad', 'md', 'mr', 'rana', 'mian', 'ch', 'chaudhry']);

function firstName(name, phone) {
  if (URDU_NAMES[phone]) return URDU_NAMES[phone];
  const tokens = String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const meaningful = tokens.filter((t) => !PREFIXES.has(t));
  return (meaningful[0] || tokens[0] || '').slice(0, 14);
}

/// 2–9 only: 0/1 are misread as O/l when a password is read out loud.
function digits(n) {
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += String((bytes[i] % 8) + 2);
  return out;
}

/// Name first so the driver recognises it as theirs, then four digits to make
/// it guess-resistant. All lowercase, no symbols: a driver typing this on a
/// phone keyboard should never have to think about the shift key, and a
/// capital letter is the most common reason a correct password is rejected.
function makePassword(local) {
  return local + digits(4);
}

async function main() {
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
    select: {
      phone: true,
      whatsapp: true,
      vehicleType: true,
      vehicleNumber: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  const targets = drivers.filter((d) => !SKIP_PHONES.has(d.phone));

  // Every email in the table has to be unique, and a name that already belongs
  // to a different driver has to yield: `awais`, then `awais2`.
  const used = new Set();
  const plan = [];
  for (const d of targets) {
    const base = firstName(d.user.name, d.phone);
    if (!base) {
      console.log(`  SKIP  ${d.user.name} (${d.phone}) — no usable first name`);
      continue;
    }
    let local = base;
    for (let n = 2; used.has(local); n++) local = `${base}${n}`;
    used.add(local);

    // Built from the bare name, not the deduped local part: `Awais29884` reads
    // as an ambiguous run of digits when dictated over the phone.
    const password = makePassword(base);
    plan.push({
      userId: d.user.id,
      name: d.user.name,
      phone: d.whatsapp || d.phone,
      vehicle: [d.vehicleType, d.vehicleNumber].filter(Boolean).join(' ') || '',
      oldEmail: d.user.email,
      email: `${local}@${DOMAIN}`,
      password,
    });
  }

  console.log(`${drivers.length} active drivers, ${targets.length} real, ${plan.length} to update.`);
  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN — pass --apply to write.\n');
  for (const r of plan) {
    console.log(
      `${String(r.name).padEnd(24)} ${r.phone.padEnd(13)} ${r.oldEmail.replace(`@${DOMAIN}`, '').padEnd(26)} → ${r.email.replace(`@${DOMAIN}`, '').padEnd(10)} ${r.password}`
    );
  }

  if (!APPLY) {
    await prisma.$disconnect();
    return;
  }

  // A collision with an email outside this batch would abort mid-way and leave
  // half the drivers on new credentials and half on old, so check up front.
  const clashes = await prisma.user.findMany({
    where: { email: { in: plan.map((r) => r.email) }, NOT: { id: { in: plan.map((r) => r.userId) } } },
    select: { email: true },
  });
  if (clashes.length) {
    console.error(`\nAborting — these emails already belong to other users: ${clashes.map((c) => c.email).join(', ')}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  for (const r of plan) {
    await prisma.user.update({
      where: { id: r.userId },
      data: { email: r.email, passwordHash: await hashPassword(r.password) },
    });
  }

  const root = path.resolve(process.cwd(), '..');
  const out = path.resolve(root, 'driver-accounts.json');
  // Keep the previous file: it is the only record of the credentials that were
  // already sent out, and this run invalidates every one of them.
  if (fs.existsSync(out)) {
    fs.copyFileSync(out, path.resolve(root, `driver-accounts.${Date.now()}.json`));
  }
  fs.writeFileSync(
    out,
    JSON.stringify({ createdAt: new Date().toISOString(), drivers: plan.map(({ userId, ...r }) => r) }, null, 2)
  );

  console.log(`\n${plan.length} logins updated. Credentials written to ${out}`);
  console.log('Next: node src/scripts/driver-whatsapp-links.js');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
