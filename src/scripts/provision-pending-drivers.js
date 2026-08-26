/**
 * Turns driver leads into driver logins.
 *
 * The "register as a driver" banner has been filling `Registration` with names,
 * phones and vehicle numbers since launch. This walks the unprovisioned ones,
 * creates a `User{role:'driver'}` + `Driver` for each, and writes the Urdu
 * WhatsApp welcome message plus a click-to-send wa.me link for each one.
 *
 * Mirrors the shopkeeper flow in `provision-pending-shops.js`: the operator
 * opens the generated markdown and clicks one link per driver rather than
 * copying credentials by hand into WhatsApp.
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

const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://www.narangmandi.com';
const PANEL_URL = `${SITE_URL}/driver/login`;
const GUIDE_URL = `${SITE_URL}/driver/guide`;
const APP_URL =
  'https://play.google.com/store/apps/details?id=com.narangmandi';

const WELCOME_TEMPLATE = (email, password) => `السلام علیکم!

نارنگ منڈی ٹیکسی سروس میں آپ کو خوش آمدید۔ آپ کا ڈرائیور اکاؤنٹ تیار ہو گیا ہے۔

ای میل:
${email}

پاس ورڈ:
${password}

ڈرائیور پینل:
${PANEL_URL}

موبائل ایپ ڈاؤن لوڈ کریں:
${APP_URL}

تصویروں کے ساتھ مکمل گائیڈ:
${GUIDE_URL}

ہدایات:

1۔ اوپر دیئے گئے ڈرائیور پینل کے لنک پر کلک کریں۔
2۔ اپنے ای میل اور پاس ورڈ کے ذریعے لاگ اِن کریں۔
3۔ لاگ اِن کے بعد آپ کو نئی سواریوں کی درخواستیں نظر آئیں گی — سواری کہاں سے کہاں تک ہے اور کس وقت۔
4۔ جو سواری آپ کو مناسب لگے، اس پر اپنا کرایہ بھیج دیں۔
5۔ گاہک تمام کرایوں میں سے خود ڈرائیور منتخب کرے گا۔ آپ کا کرایہ منظور ہوتے ہی آپ کو اطلاع مل جائے گی اور گاہک کا نمبر آپ کو دکھائی دے گا۔
6۔ گاہک سے رابطہ کر کے سواری مکمل کریں۔

نوٹ: نئی سواری کی اطلاع صرف ایپ پر آتی ہے۔ اس لیے ایپ ضرور انسٹال کریں اور نوٹیفیکیشن آن رکھیں۔

مزید معلومات کے لیے اسی پیغام کا جواب دیں۔ ہماری ٹیم آپ کی مدد کے لیے حاضر ہے۔

شکریہ!
نارنگ منڈی ڈیجیٹل ہب`;

/// wa.me wants E.164 without the +; drivers write their number as 03xxxxxxxxx.
function waPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  return digits.length === 10 ? `92${digits}` : digits;
}

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
  const domain = 'narangdriver.com';
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

    const whatsappMessage = WELCOME_TEMPLATE(email, password);
    created.push({
      name: lead.name,
      phone: dialable,
      email,
      password,
      vehicleNumber: lead.businessName || '',
      hasLicense: lead.hasLicense,
      panel: PANEL_URL,
      app: APP_URL,
      whatsappMessage,
      waLink: `https://wa.me/${waPhone(dialable)}?text=${encodeURIComponent(whatsappMessage)}`,
    });

    console.log(`\n--- ${lead.name} (${phone})`);
    console.log(whatsappMessage);
  }

  if (APPLY && created.length) {
    // Written outside server/ and client/ deliberately: the repo root is not a
    // git repository, so plaintext passwords cannot be committed by accident.
    const root = path.resolve(process.cwd(), '..');
    const out = path.resolve(root, 'driver-accounts.json');
    fs.writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), drivers: created }, null, 2));

    // A clickable list is the whole point: WhatsApp opens with the credentials
    // and the guide already typed, so nobody re-keys a password by hand.
    const waMd = path.resolve(root, 'whatsapp-links-drivers.md');
    const lines = [
      '# WhatsApp Welcome Links — New Drivers',
      '',
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      `Total: ${created.length}`,
      '',
      'Click a link to open WhatsApp with the welcome message pre-filled (email + password included).',
      '',
      '---',
      '',
    ];
    created.forEach((c, i) => {
      lines.push(`${i + 1}. **${c.name}** (${c.phone}) — [${c.vehicleNumber || 'ڈرائیور'}](${c.waLink})`);
    });
    lines.push('');
    fs.writeFileSync(waMd, lines.join('\n'), 'utf8');

    console.log(`\n${created.length} accounts written to ${out}`);
    console.log(`WhatsApp links written to ${waMd}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
