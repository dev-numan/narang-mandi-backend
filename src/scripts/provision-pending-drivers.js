/**
 * Turns driver leads into driver logins.
 *
 * The "register as a driver" banner has been filling `Registration` with names,
 * phones and vehicle numbers since launch. This walks the unprovisioned ones,
 * creates a `User{role:'driver'}` + `Driver` for each, and prints the Urdu
 * WhatsApp message to send them with their credentials.
 *
 * Deliberately dry by default — pass `--apply` to write.
 *
 *   node src/scripts/provision-pending-drivers.js            # show what would happen
 *   node src/scripts/provision-pending-drivers.js --apply
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../lib/password.js';
import { normalizePhone } from '../utils/phone.js';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

const PANEL_URL = `${process.env.PUBLIC_SITE_URL || 'https://www.narangmandi.com'}/driver`;

const WELCOME_TEMPLATE = (email, password) => `السلام علیکم!

نارنگ منڈی ٹیکسی میں آپ کا اکاؤنٹ بن گیا ہے۔

پینل: ${PANEL_URL}
ای میل: ${email}
پاس ورڈ: ${password}

سواری کی درخواستیں پینل پر آئیں گی۔ اپنی قیمت بھیجیں — گاہک خود ڈرائیور منتخب کرے گا۔

نارنگ منڈی ڈیجیٹل ہب`;

/// Ambiguity-free alphabet: no O/0, no l/1 — these get read down a phone line.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function genPassword() {
  let out = 'Nm';
  for (let i = 0; i < 8; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

/// Urdu names cannot be an email local-part; fall back to the phone digits.
function asciiLocal(name, phone) {
  const ascii = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  if (ascii.length >= 3) return ascii.slice(0, 24);
  const digits = normalizePhone(phone);
  return digits ? `driver.${digits}` : '';
}

async function nextEmail(base, used) {
  const domain = 'driver.narangmandi.com';
  for (let n = 0; n < 200; n++) {
    const candidate = `${base}${n ? n + 1 : ''}@${domain}`;
    if (used.has(candidate)) continue;
    if (!(await prisma.user.findUnique({ where: { email: candidate } }))) {
      used.add(candidate);
      return candidate;
    }
    used.add(candidate);
  }
  throw new Error(`Could not derive an email for ${base}`);
}

async function main() {
  const leads = await prisma.registration.findMany({
    where: { type: 'driver' },
    orderBy: { createdAt: 'asc' },
  });

  // A driver already provisioned is one whose phone matches an existing Driver
  // row; the lead table has no "done" flag and back-filling one would rewrite
  // history that admins read.
  const existing = await prisma.driver.findMany({ select: { phone: true, whatsapp: true } });
  const taken = new Set(
    existing.flatMap((d) => [normalizePhone(d.phone), normalizePhone(d.whatsapp)]).filter(Boolean)
  );

  const seen = new Set();
  const pending = [];
  for (const lead of leads) {
    const phone = normalizePhone(lead.contact);
    if (!phone || taken.has(phone) || seen.has(phone)) continue;
    seen.add(phone);
    pending.push({ lead, phone });
  }

  console.log(`${leads.length} driver leads, ${pending.length} not yet provisioned.`);
  if (!APPLY) console.log('DRY RUN — pass --apply to create accounts.\n');

  const usedEmails = new Set();
  const created = [];
  for (const { lead, phone } of pending) {
    const base = asciiLocal(lead.name, phone);
    if (!base) {
      console.log(`  SKIP  ${lead.name} — no usable email base`);
      continue;
    }
    const email = await nextEmail(base, usedEmails);
    const password = genPassword();

    if (!APPLY) {
      console.log(`  WOULD CREATE  ${lead.name} <${email}>  vehicle=${lead.businessName || '—'}`);
      continue;
    }

    // Store the number as the driver wrote it, not the normalized comparison
    // form: a tel: link built from the last-10-digits version is missing the
    // leading 0 and will not dial.
    const dialable = String(lead.contact || '').trim();

    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: lead.name, email, role: 'driver', passwordHash, phone: dialable },
      });
      await tx.driver.create({
        data: {
          userId: user.id,
          phone: dialable,
          whatsapp: dialable,
          vehicleNumber: lead.businessName || '',
          photo: lead.image || '',
          isVerified: lead.hasLicense,
        },
      });
    });

    created.push({
      name: lead.name,
      phone: dialable,
      email,
      password,
      vehicleNumber: lead.businessName || '',
      hasLicense: lead.hasLicense,
      panel: PANEL_URL,
      whatsappMessage: WELCOME_TEMPLATE(email, password),
    });

    console.log(`\n--- ${lead.name} (${phone})`);
    console.log(WELCOME_TEMPLATE(email, password));
  }

  if (APPLY && created.length) {
    // Written outside server/ and client/ deliberately: the repo root is not a
    // git repository, so plaintext passwords cannot be committed by accident.
    const out = path.resolve(process.cwd(), '..', 'driver-accounts.json');
    fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), drivers: created }, null, 2));
    console.log(`\n${created.length} accounts written to ${out}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
